package com.lumora.animeplugin

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import android.util.Log
import com.lumora.animeplugin.provider.SenshiProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Bound service implementing Lumora's `stream_search` capability for anime.
 *
 * ## Protocol (see [HostProtocol])
 *
 * **MSG_START_SEARCH** — Host sends an anime title (and optional season/episode).
 *   Plugin queries AniList for matching anime, then checks Senshi for episode
 *   availability per match. Returns one [MSG_RESULT] per sub/dub option.
 *
 * **MSG_RESOLVE_STREAM** — Host picks a result (identified by its token/magnet).
 *   Plugin resolves the specific episode via Senshi and returns the HLS URL.
 *
 * **MSG_STOP_STREAM** — Host is done playing; plugin cleans up.
 *
 * ## Token format
 *   `senshi:{malId}:{audio}` — e.g. `senshi:1535:dub` for FMA:B dub
 */
class StreamService : android.app.Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val messenger = Messenger(IncomingHandler())

    // One search at a time, one resolve at a time — matches host usage.
    @Volatile private var searchJob: Job? = null
    @Volatile private var resolveJob: Job? = null

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .build()

    private val aniList = AniListClient(httpClient)
    private val senshi = SenshiProvider(httpClient)

    override fun onBind(intent: Intent?): IBinder = messenger.binder

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private inner class IncomingHandler : Handler(Looper.getMainLooper()) {
        override fun handleMessage(msg: Message) {
            val data = msg.data ?: Bundle.EMPTY
            val requestId = data.getString(HostProtocol.KEY_REQUEST_ID) ?: return
            val reply = msg.replyTo
            when (msg.what) {
                HostProtocol.MSG_START_SEARCH -> handleSearch(requestId, data, reply)
                HostProtocol.MSG_RESOLVE_STREAM -> handleResolve(requestId, data, reply)
                HostProtocol.MSG_STOP_STREAM -> handleStop()
            }
        }
    }

    // ── Search: title → anime matches ──

    private fun handleSearch(requestId: String, data: Bundle, reply: Messenger?) {
        reply ?: return
        searchJob?.cancel()
        val query = data.getString(HostProtocol.KEY_QUERY)?.trim().orEmpty()
        if (query.isEmpty()) {
            sendError(reply, requestId, "Empty search query")
            return
        }
        val year = data.getInt(HostProtocol.KEY_YEAR, 0).takeIf { it > 0 }
        val season = data.getInt(HostProtocol.KEY_SEASON, 0).takeIf { it > 0 }
        val episode = data.getInt(HostProtocol.KEY_EPISODE, 0).takeIf { it > 0 } ?: 1

        searchJob = scope.launch {
            try {
                sendProgress(reply, requestId, "Searching AniList for \"$query\"")
                Log.i(TAG, "Search: query='$query' year=$year season=$season episode=$episode")

                val matches = try {
                    aniList.search(query)
                } catch (e: Exception) {
                    Log.w(TAG, "AniList search failed", e)
                    sendError(reply, requestId, "AniList search failed: ${e.message}")
                    return@launch
                }

                if (matches.isEmpty()) {
                    sendProgress(reply, requestId, "No anime found on AniList")
                    sendFinished(reply, requestId, "No results")
                    return@launch
                }

                sendProgress(reply, requestId, "Found ${matches.size} anime, checking provider availability")

                var sent = 0
                val epTag = if (season != null && episode != null) " S%02dE%02d".format(season, episode) else ""

                for (match in matches) {
                    if (!isActive) break
                    if (sent >= MAX_RESULTS) break

                    val title = aniList.displayTitle(match)
                    val yearTag = match.seasonYear?.let { " ($it)" }.orEmpty()
                    val info = listOfNotNull(
                        match.format?.takeIf { it != "TV" },
                        match.episodes?.let { "${it}ep" }
                    ).joinToString(" ")

                    val malId = match.malId
                    if (malId == null || malId <= 0) {
                        // No MAL ID means Senshi can't resolve — skip
                        continue
                    }

                    // Probe episode availability (first episode) to check sub/dub
                    val available = try {
                        senshi.checkAvailability(malId)
                    } catch (e: Exception) {
                        Log.i(TAG, "Senshi unavailable for malId=$malId: ${e.message}")
                        null
                    }

                    val episodeToCheck = episode.coerceAtMost(match.episodes ?: episode)

                    // Sub result
                    if (available != null && episodeToCheck in available.sub) {
                        val subToken = "senshi:$malId:sub"
                        sendResult(
                            reply = reply,
                            requestId = requestId,
                            label = "$title${epTag} [Sub]$yearTag",
                            token = subToken,
                            quality = "Sub",
                            source = "Senshi",
                            detail = info
                        )
                        sent++
                    }

                    // Dub result
                    if (available != null && episodeToCheck in available.dub) {
                        val dubToken = "senshi:$malId:dub"
                        sendResult(
                            reply = reply,
                            requestId = requestId,
                            label = "$title${epTag} [Dub]$yearTag",
                            token = dubToken,
                            quality = "Dub",
                            source = "Senshi",
                            detail = info
                        )
                        sent++
                    }

                    // Fallback: if Senshi returned nothing, still show the match with 'any' audio
                    if (available == null) {
                        val anyToken = "senshi:$malId:sub"
                        sendResult(
                            reply = reply,
                            requestId = requestId,
                            label = "$title$yearTag",
                            token = anyToken,
                            quality = null,
                            source = "Senshi",
                            detail = info
                        )
                        sent++
                    }
                }

                val summary = if (sent == 0) "No playable anime found" else "$sent result${if (sent == 1) "" else "s"}"
                sendFinished(reply, requestId, summary)

            } catch (e: Exception) {
                Log.w(TAG, "Search failed", e)
                sendError(reply, requestId, e.message ?: "Search failed")
            }
        }
    }

    // ── Resolve: token → playable URL ──

    private fun handleResolve(requestId: String, data: Bundle, reply: Messenger?) {
        reply ?: return
        val token = data.getString(HostProtocol.KEY_MAGNET)?.takeIf { it.isNotBlank() }
            ?: run { sendError(reply, requestId, "No token to resolve"); return }
        val episode = data.getInt(HostProtocol.KEY_EPISODE, 0).takeIf { it > 0 } ?: 1

        resolveJob?.cancel()
        resolveJob = scope.launch {
            try {
                Log.i(TAG, "Resolve: token='$token' episode=$episode")

                // Parse token: "senshi:malId:audio"
                val parts = token.split(":")
                if (parts.size < 3 || parts[0] != "senshi") {
                    sendError(reply, requestId, "Unknown provider in token")
                    return@launch
                }
                val malId = parts[1].toIntOrNull()
                    ?: run { sendError(reply, requestId, "Invalid token format"); return@launch }
                val audio = parts[2]

                sendProgress(reply, requestId, "Resolving episode $episode $audio via Senshi")

                val resolution = senshi.resolveStream(malId, episode, audio)

                sendProgress(reply, requestId, "Stream ready")
                sendStreamReady(reply, requestId, resolution.url)
            } catch (e: Exception) {
                Log.w(TAG, "Resolve failed", e)
                sendError(reply, requestId, e.message ?: "Could not resolve stream")
            }
        }
    }

    // ── Stop ──

    private fun handleStop() {
        Log.i(TAG, "Stop requested")
        resolveJob?.cancel()
        resolveJob = null
    }

    // ── Outgoing messages ──

    private fun sendProgress(reply: Messenger, requestId: String, line: String) =
        send(reply, HostProtocol.MSG_PROGRESS, requestId) { it.putString(HostProtocol.KEY_MESSAGE, line) }

    private fun sendResult(
        reply: Messenger,
        requestId: String,
        label: String,
        token: String,
        quality: String?,
        source: String,
        detail: String
    ) = send(reply, HostProtocol.MSG_RESULT, requestId) {
        it.putString(HostProtocol.KEY_LABEL, label)
        it.putString(HostProtocol.KEY_MAGNET, token)
        quality?.let { q -> it.putString(HostProtocol.KEY_QUALITY, q) }
        it.putString(HostProtocol.KEY_SOURCE, source)
        it.putString(HostProtocol.KEY_SIZE, detail)
        it.putInt(HostProtocol.KEY_SEEDERS, 0)
    }

    private fun sendFinished(reply: Messenger, requestId: String, summary: String) =
        send(reply, HostProtocol.MSG_FINISHED, requestId) { it.putString(HostProtocol.KEY_MESSAGE, summary) }

    private fun sendStreamReady(reply: Messenger, requestId: String, url: String) =
        send(reply, HostProtocol.MSG_STREAM_READY, requestId) { it.putString(HostProtocol.KEY_STREAM_URL, url) }

    private fun sendError(reply: Messenger, requestId: String, message: String) =
        send(reply, HostProtocol.MSG_ERROR, requestId) { it.putString(HostProtocol.KEY_MESSAGE, message) }

    private inline fun send(reply: Messenger, what: Int, requestId: String, fill: (Bundle) -> Unit) {
        val bundle = Bundle().apply {
            putString(HostProtocol.KEY_REQUEST_ID, requestId)
            fill(this)
        }
        val msg = Message.obtain(null, what).apply { data = bundle }
        try { reply.send(msg) } catch (_: RemoteException) { /* host went away */ }
    }

    companion object {
        private const val TAG = "AnimeStreamService"
        private const val MAX_RESULTS = 50
    }
}
