package com.lumora.animeplugin.provider

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.util.concurrent.ConcurrentHashMap

/**
 * Senshi (senshi.live) anime provider — pure JSON API keyed by MyAnimeList ID.
 *
 * No Cloudflare, no WebView needed. Returns direct HLS URLs + subtitle sidecar info.
 * Ported approach from Anilili's SenshiProvider.
 *
 * Endpoints:
 *   GET /episodes/{malId}          → episode catalog
 *   GET /episode-embeds/{malId}/{ep} → stream sources per audio type
 */
class SenshiProvider(private val client: OkHttpClient) {

    private val catalogs = ConcurrentHashMap<Int, Map<Int, SenshiParser.EpisodeMeta>>()

    companion object {
        private const val TAG = "SenshiProvider"
        private const val BASE = "https://senshi.live"
        private const val USER_AGENT = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36"
    }

    /**
     * Checks episode availability for an anime. Returns sub/dub episode sets.
     */
    fun checkAvailability(malId: Int): EpisodeAvailability {
        val catalog = fetchCatalog(malId)
        if (catalog.isEmpty()) {
            Log.w(TAG, "Senshi returned empty catalog for malId=$malId")
            return EpisodeAvailability(emptySet(), emptySet())
        }
        // Dub coverage is not in the catalog list; probe the first episode's embeds.
        val firstEp = catalog.keys.min()
        val hasDub = try {
            fetchEmbeds(malId, firstEp).any(SenshiParser::isDub)
        } catch (_: Exception) { false }
        return EpisodeAvailability(
            sub = catalog.keys,
            dub = if (hasDub) catalog.keys else emptySet()
        )
    }

    /**
     * Resolves a playable stream URL for a specific episode.
     *
     * @param malId MyAnimeList ID
     * @param episode Episode number
     * @param audio "sub" or "dub"
     * @return Resolved stream URL (HLS direct URL, or embed URL as fallback)
     */
    fun resolveStream(malId: Int, episode: Int, audio: String): StreamResolution {
        val embeds = fetchEmbeds(malId, episode)
        val match = embeds.firstOrNull { source ->
            if (audio == "dub") SenshiParser.isDub(source) else !SenshiParser.isDub(source)
        } ?: throw IllegalStateException("Senshi episode $episode has no $audio source")

        val hlsUrl = match.url?.takeIf { it.isNotBlank() }
        val fallbackUrl = match.server2?.takeIf { it.isNotBlank() }
            ?: match.serverFM?.takeIf { it.isNotBlank() }

        val streamUrl = hlsUrl ?: fallbackUrl
            ?: throw IllegalStateException("Senshi episode $episode has no playable sources")

        // Check for sidecar subtitles
        val subtitleUrl = match.maskedBaseUrl?.trimEnd('/')
            ?.let { base -> fetchSubtitles("$base/${audio}_filemoon.json", base)
                ?: fetchSubtitles("$base/${audio}_artplayer.json", base) }

        return StreamResolution(
            url = streamUrl,
            isHls = hlsUrl != null,
            subtitleUrl = subtitleUrl,
            referer = "$BASE/"
        )
    }

    /**
     * Episode metadata from the catalog (titles, filler flags, skip times).
     */
    fun episodeMeta(malId: Int): Map<Int, SenshiParser.EpisodeMeta> =
        catalogs[malId].orEmpty()

    // ── Private ──

    private fun fetchCatalog(malId: Int): Map<Int, SenshiParser.EpisodeMeta> {
        catalogs[malId]?.let { return it }
        val text = get("$BASE/episodes/$malId")
        val parsed = SenshiParser.parseCatalog(text)
        if (parsed.isNotEmpty()) catalogs[malId] = parsed
        return parsed
    }

    private fun fetchEmbeds(malId: Int, episode: Int): List<SenshiParser.EpisodeSource> {
        val text = get("$BASE/episode-embeds/$malId/$episode")
        return SenshiParser.parseEmbeds(text)
    }

    private fun fetchSubtitles(url: String, base: String): String? = try {
        val text = get(url)
        val array = try { JSONArray(text) } catch (_: Exception) { return null }
        if (array.length() == 0) return null
        val first = array.optJSONObject(0) ?: return null
        val src = first.optString("src", null)
            ?: first.optString("url", null)
            ?: return null
        if (src.isBlank() || src.equals("none", ignoreCase = true)) null
        else if (src.startsWith("http")) src else "$base/$src"
    } catch (_: Exception) { null }

    private fun get(url: String): String {
        val request = Request.Builder().url(url)
            .header("User-Agent", USER_AGENT)
            .header("Referer", "$BASE/")
            .header("Accept", "application/json, */*")
            .get().build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                error("Senshi HTTP ${response.code} for $url")
            }
            return body
        }
    }

    data class EpisodeAvailability(
        val sub: Set<Int>,
        val dub: Set<Int>
    )

    data class StreamResolution(
        val url: String,
        val isHls: Boolean,
        val subtitleUrl: String?,
        val referer: String
    )
}
