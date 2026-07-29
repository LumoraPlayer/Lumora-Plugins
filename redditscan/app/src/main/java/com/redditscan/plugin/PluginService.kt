package com.redditscan.plugin

import android.app.Service
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The plugin's entry point: a bound Messenger service that answers the host's
 * [HostProtocol.ACTION_PLUGIN_SERVICE] and runs a Reddit discovery job on request.
 *
 * Contract (host side is PluginClient):
 *  - Host sends [HostProtocol.MSG_START_DISCOVERY] with `replyTo` and a request id.
 *  - This service streams [HostProtocol.MSG_PROGRESS]/[HostProtocol.MSG_CANDIDATE] back, all
 *    tagged with that request id, then exactly one [HostProtocol.MSG_FINISHED] or
 *    [HostProtocol.MSG_ERROR].
 *  - Host may send [HostProtocol.MSG_CANCEL]; the running job is cancelled and no further
 *    messages for it are sent.
 *
 * One job at a time - a second start supersedes the first. Replies are posted from the job's
 * coroutine to the host's Messenger, which marshals them across the process boundary.
 */
class PluginService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var currentJob: Job? = null
    private var currentRequestId: String = ""

    private val incoming = Messenger(Handler(Looper.getMainLooper()) { msg ->
        when (msg.what) {
            HostProtocol.MSG_START_DISCOVERY -> {
                startDiscovery(msg.data?.getString(HostProtocol.KEY_REQUEST_ID) ?: "", msg.replyTo)
                true
            }
            HostProtocol.MSG_CANCEL -> {
                if ((msg.data?.getString(HostProtocol.KEY_REQUEST_ID) ?: "") == currentRequestId) {
                    currentJob?.cancel()
                    currentJob = null
                }
                true
            }
            else -> false
        }
    })

    override fun onBind(intent: Intent?): IBinder = incoming.binder

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun startDiscovery(requestId: String, replyTo: Messenger?) {
        if (replyTo == null || requestId.isBlank()) return
        // A fresh start supersedes anything still running - the results stream is one-per-job.
        currentJob?.cancel()
        currentRequestId = requestId

        currentJob = scope.launch {
            val discovery = RedditDiscovery(
                onProgress = { line -> send(replyTo, HostProtocol.MSG_PROGRESS, requestId) {
                    putString(HostProtocol.KEY_MESSAGE, line)
                } },
                onCandidate = { candidate -> send(replyTo, HostProtocol.MSG_CANDIDATE, requestId) {
                    putString(HostProtocol.KEY_TYPE, candidate.type)
                    putString(HostProtocol.KEY_LABEL, candidate.label)
                    putString(HostProtocol.KEY_URL, candidate.url)
                    candidate.username?.let { putString(HostProtocol.KEY_USERNAME, it) }
                    candidate.password?.let { putString(HostProtocol.KEY_PASSWORD, it) }
                    candidate.userAgent?.let { putString(HostProtocol.KEY_USER_AGENT, it) }
                    candidate.detail?.let { putString(HostProtocol.KEY_DETAIL, it) }
                    putBoolean(HostProtocol.KEY_VERIFIED, candidate.verified)
                } }
            )
            val summary = try {
                withContext(Dispatchers.IO) { discovery.run() }
            } catch (e: kotlinx.coroutines.CancellationException) {
                // Host cancelled - it's already torn the binding down, no terminal message wanted.
                throw e
            } catch (e: Exception) {
                send(replyTo, HostProtocol.MSG_ERROR, requestId) {
                    putString(HostProtocol.KEY_MESSAGE, e.message?.take(200) ?: "Discovery failed")
                }
                return@launch
            }
            send(replyTo, HostProtocol.MSG_FINISHED, requestId) {
                putString(HostProtocol.KEY_MESSAGE, summary)
            }
        }
    }

    /** Send one message to the host, ignoring a dead binding (host gone = job irrelevant). */
    private fun send(replyTo: Messenger, what: Int, requestId: String, fill: Bundle.() -> Unit) {
        val message = Message.obtain(null, what).apply {
            data = Bundle().apply {
                putString(HostProtocol.KEY_REQUEST_ID, requestId)
                fill()
            }
        }
        try {
            replyTo.send(message)
        } catch (_: RemoteException) {
            currentJob?.cancel()
        }
    }
}
