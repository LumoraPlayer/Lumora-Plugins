package com.torrentplugin.scrapers

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Runs every active scraper in parallel, flattens and dedupes by infohash, and sorts by
 * seeders. Each scraper gets its own timeout so one slow site can't hold up the rest - a
 * partial result set is still returned.
 */
class ScraperAggregator {

    // UIndex reliably returns HTTP 403 (bot-blocked), so it's left out of the active set.
    private val scrapers = listOf(KnabenScraper(), ThePirateBayScraper())

    suspend fun searchAll(query: String): List<ScrapedTorrent> = coroutineScope {
        val perScraper = scrapers.map { scraper ->
            async(Dispatchers.IO) {
                withTimeoutOrNull(15_000) {
                    try { scraper.search(query) }
                    catch (e: Exception) { Log.w(TAG, "${scraper.source} threw: ${e.message}"); emptyList() }
                } ?: run { Log.w(TAG, "${scraper.source} timed out"); emptyList() }
            }
        }.awaitAll().flatten()
        Log.i(TAG, "Aggregator: '$query' -> ${perScraper.size} raw results before dedupe")

        val byHash = LinkedHashMap<String, ScrapedTorrent>()
        for (t in perScraper) {
            val key = infohashOf(t.magnet) ?: t.magnet
            // Keep whichever copy reports more seeders.
            val existing = byHash[key]
            if (existing == null || seedersInt(t) > seedersInt(existing)) byHash[key] = t
        }
        byHash.values.sortedByDescending { seedersInt(it) }
    }

    companion object {
        private const val TAG = "TorrentScraper"
        private val BTIH = Regex("btih:([A-Fa-f0-9]{40}|[A-Za-z2-7]{32})")
        fun infohashOf(magnet: String): String? =
            BTIH.find(magnet)?.groupValues?.get(1)?.lowercase()
        fun seedersInt(t: ScrapedTorrent): Int = t.seeders.replace(",", "").trim().toIntOrNull() ?: 0
    }
}

/**
 * The title/quality helpers PlayTorrioV2 keeps in its TorrentFilter, reduced to what the
 * movie path needs: a loose title match (so unrelated results are dropped) and a quality tag
 * pulled out of the release name for display/sorting.
 */
object TorrentFilter {

    private val QUALITY_TAGS = listOf(
        "2160p" to "4K", "4k" to "4K", "uhd" to "4K",
        "1080p" to "1080p", "720p" to "720p", "480p" to "480p"
    )

    fun qualityOf(name: String): String? {
        val lower = name.lowercase()
        return QUALITY_TAGS.firstOrNull { lower.contains(it.first) }?.second
    }

    fun qualityRank(quality: String?): Int = when (quality) {
        "4K" -> 400; "1080p" -> 300; "720p" -> 200; "480p" -> 100; else -> 0
    }

    /** Parses a size string like "1.85 GiB" / "700 MB" / "5.2 GB" to bytes, or null if unknown. */
    fun sizeBytes(size: String): Long? {
        val m = Regex("([\\d.,]+)\\s*(TB|TiB|GB|GiB|MB|MiB|KB|KiB|B)", RegexOption.IGNORE_CASE)
            .find(size) ?: return null
        val value = m.groupValues[1].replace(",", "").toDoubleOrNull() ?: return null
        val mult = when (m.groupValues[2].uppercase()) {
            "TB", "TIB" -> 1024.0 * 1024 * 1024 * 1024
            "GB", "GIB" -> 1024.0 * 1024 * 1024
            "MB", "MIB" -> 1024.0 * 1024
            "KB", "KIB" -> 1024.0
            else -> 1.0
        }
        return (value * mult).toLong()
    }

    /** True if the torrent is small enough to stream on a low-storage device (or size unknown). */
    fun withinSizeLimit(size: String): Boolean {
        val bytes = sizeBytes(size) ?: return true // keep unparseable sizes rather than hide them
        return bytes <= MAX_SIZE_BYTES
    }

    /** 8 GB ceiling - larger rips are impractical to stream/cache on the target boxes. */
    private const val MAX_SIZE_BYTES = 8L * 1024 * 1024 * 1024

    /** Normalizes a title for comparison: lowercase, punctuation to spaces, collapse spaces. */
    fun normalize(title: String): String =
        title.lowercase().replace(Regex("[^a-z0-9]+"), " ").trim()

    /** True if the release name looks like the given season/episode (SxxEyy or NxMM forms). */
    fun matchesEpisode(resultName: String, season: Int, episode: Int): Boolean {
        val n = resultName.lowercase()
        val forms = listOf(
            String.format(java.util.Locale.ROOT, "s%02de%02d", season, episode),
            String.format(java.util.Locale.ROOT, "%dx%02d", season, episode),
            "s${season}e${episode}"
        )
        return forms.any { n.contains(it) }
    }

    /** A movie result is kept if its normalized name contains every word of the wanted title. */
    fun matchesMovie(resultName: String, wantedTitle: String): Boolean {
        val hay = normalize(resultName)
        val words = normalize(wantedTitle).split(' ').filter { it.length > 1 }
        if (words.isEmpty()) return true
        return words.all { hay.contains(it) }
    }
}
