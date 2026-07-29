package com.torrentplugin

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import com.torrentplugin.scrapers.ScraperAggregator
import com.torrentplugin.scrapers.TorrentFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The bound service the host talks to over [Messenger], implementing the host's `stream_search`
 * capability (see [HostProtocol]). Search runs the scrapers and streams one [MSG_RESULT] per
 * torrent; resolve hands the chosen magnet to [TorrentStreamer] and returns a local URL; stop
 * tears the stream down. One search and one active stream at a time, which is all the host asks.
 */
class StreamService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val messenger = Messenger(IncomingHandler())
    private val aggregator = ScraperAggregator()

    @Volatile private var searchJob: Job? = null
    @Volatile private var resolveJob: Job? = null
    @Volatile private var streamer: TorrentStreamer? = null
    @Volatile private var foreground = false

    override fun onBind(intent: Intent?): IBinder = messenger.binder

    override fun onDestroy() {
        teardownStream()
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
                HostProtocol.MSG_STOP_STREAM -> teardownStream()
            }
        }
    }

    private fun handleSearch(requestId: String, data: Bundle, reply: Messenger?) {
        reply ?: return
        searchJob?.cancel()
        val query = cleanTitle(data.getString(HostProtocol.KEY_QUERY)?.trim().orEmpty())
        if (query.isEmpty()) {
            sendError(reply, requestId, "Empty search query")
            return
        }
        val year = data.getInt(HostProtocol.KEY_YEAR, 0).takeIf { it > 0 }
        val season = data.getInt(HostProtocol.KEY_SEASON, 0).takeIf { it > 0 }
        val episode = data.getInt(HostProtocol.KEY_EPISODE, 0).takeIf { it > 0 }
        val epTag = if (season != null && episode != null)
            String.format(java.util.Locale.ROOT, "S%02dE%02d", season, episode) else null
        // For an episode search append SxxEyy (and drop the year, which rarely appears in episode
        // release names); otherwise a movie search keeps the year to disambiguate remakes.
        val searchQuery = when {
            epTag != null -> "$query $epTag"
            year != null -> "$query $year"
            else -> query
        }
        searchJob = scope.launch {
            try {
                progress(reply, requestId, "Searching torrent sites")
                android.util.Log.i("TorrentScraper", "Search request: query='$query' searchQuery='$searchQuery' epTag=$epTag")
                val raw = aggregator.searchAll(searchQuery)
                val results = raw.filter {
                    TorrentFilter.matchesMovie(it.name, query) &&
                        TorrentFilter.withinSizeLimit(it.size) &&
                        (epTag == null || TorrentFilter.matchesEpisode(it.name, season!!, episode!!))
                }
                android.util.Log.i("TorrentScraper", "Search '$searchQuery': ${raw.size} raw, ${results.size} after title+size filter")
                var sent = 0
                for (t in results) {
                    if (sent >= MAX_RESULTS) break
                    val quality = TorrentFilter.qualityOf(t.name)
                    sendResult(reply, requestId, t.name, t.magnet, t.seeders, t.size, quality, t.source)
                    sent++
                }
                val summary = if (sent == 0) "No torrents found" else "$sent result${if (sent == 1) "" else "s"}"
                sendFinished(reply, requestId, summary)
            } catch (e: Exception) {
                sendError(reply, requestId, e.message ?: "Search failed")
            }
        }
    }

    private fun handleResolve(requestId: String, data: Bundle, reply: Messenger?) {
        reply ?: return
        val magnet = data.getString(HostProtocol.KEY_MAGNET)?.takeIf { it.isNotBlank() }
        if (magnet == null) {
            sendError(reply, requestId, "No magnet to resolve")
            return
        }
        val season = data.getInt(HostProtocol.KEY_SEASON, 0).takeIf { it > 0 }
        val episode = data.getInt(HostProtocol.KEY_EPISODE, 0).takeIf { it > 0 }
        resolveJob?.cancel()
        teardownStream()
        resolveJob = scope.launch {
            try {
                android.util.Log.i("TorrentStreamer", "Resolve start: ${magnet.take(60)}")
                enterForeground()
                val s = TorrentStreamer(cacheDir)
                streamer = s
                val url = withContext(Dispatchers.IO) {
                    s.start(magnet, season, episode) { line -> progress(reply, requestId, line) }
                }
                android.util.Log.i("TorrentStreamer", "Resolve ready: $url")
                sendStreamReady(reply, requestId, url)
            } catch (e: Exception) {
                android.util.Log.w("TorrentStreamer", "Resolve failed: ${e.message}", e)
                teardownStream()
                sendError(reply, requestId, e.message ?: "Could not resolve stream")
            }
        }
    }

    /**
     * Strips catalog cruft that would never appear in a release name: a short provider/category
     * tag prefix like "4K-D+ - " or "D+ - ", and a bracketed year (the year is sent separately).
     * Kept conservative so real dashed titles ("Mission: Impossible - ...") survive.
     */
    private fun cleanTitle(raw: String): String =
        raw
            .replace(Regex("^[\\w+\\-]{1,6}\\s-\\s"), "")   // leading "4K-D+ - " / "D+ - "
            .replace(Regex("\\(\\d{4}\\)"), " ")             // "(2026)"
            .replace(Regex("\\s+"), " ")
            .trim()

    private fun teardownStream() {
        resolveJob?.cancel()
        resolveJob = null
        streamer?.let { s -> scope.launch(Dispatchers.IO) { runCatching { s.stop() } } }
        streamer = null
        exitForeground()
    }

    // ── Foreground (required while streaming on modern Android) ──

    private fun enterForeground() {
        if (foreground) return
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Streaming", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notification: Notification =
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle(getString(R.string.app_name))
                .setContentText("Streaming torrent")
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, notification)
        }
        foreground = true
    }

    private fun exitForeground() {
        if (!foreground) return
        @Suppress("DEPRECATION")
        stopForeground(true)
        foreground = false
    }

    // ── Outgoing messages ──

    private fun progress(reply: Messenger, requestId: String, line: String) =
        send(reply, HostProtocol.MSG_PROGRESS, requestId) { it.putString(HostProtocol.KEY_MESSAGE, line) }

    private fun sendResult(
        reply: Messenger, requestId: String, label: String, magnet: String,
        seeders: String, size: String, quality: String?, source: String
    ) = send(reply, HostProtocol.MSG_RESULT, requestId) {
        it.putString(HostProtocol.KEY_LABEL, label)
        it.putString(HostProtocol.KEY_MAGNET, magnet)
        it.putInt(HostProtocol.KEY_SEEDERS, seeders.replace(",", "").trim().toIntOrNull() ?: 0)
        it.putString(HostProtocol.KEY_SIZE, size)
        quality?.let { q -> it.putString(HostProtocol.KEY_QUALITY, q) }
        it.putString(HostProtocol.KEY_SOURCE, source)
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
        try { reply.send(msg) } catch (_: RemoteException) { /* host went away; nothing to do */ }
    }

    companion object {
        private const val CHANNEL_ID = "torrent_stream"
        private const val NOTIF_ID = 42
        private const val MAX_RESULTS = 200
    }
}
