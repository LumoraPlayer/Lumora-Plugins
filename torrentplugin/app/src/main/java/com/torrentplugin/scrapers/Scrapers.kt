package com.torrentplugin.scrapers

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.jsoup.Jsoup
import org.jsoup.nodes.Element
import java.util.concurrent.TimeUnit

/** One torrent found by a scraper. `magnet` is the only field the resolver needs; the rest is display. */
data class ScrapedTorrent(
    val name: String,
    val magnet: String,
    val seeders: String,
    val size: String,
    val source: String
)

/**
 * Shared HTTP + parsing for the site scrapers. Ported from PlayTorrioV2's BaseScraper: one
 * hardcoded desktop User-Agent, non-200 throws, failures return empty rather than propagate.
 */
abstract class BaseScraper {
    abstract val source: String
    abstract fun search(query: String): List<ScrapedTorrent>

    protected val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        // Hard ceiling on the whole call - a site whose TLS handshake is silently dropped
        // (ISP SNI blocking) otherwise hangs past the per-scraper coroutine timeout and stalls
        // the search behind the slowest source.
        .callTimeout(12, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    protected fun get(url: String): String {
        val request = Request.Builder().url(url)
            .header("User-Agent", UA)
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .header("Accept-Language", "en-US,en;q=0.9")
            .build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string() ?: ""
            Log.i(TAG, "GET $url -> HTTP ${response.code}, ${body.length} bytes")
            if (!response.isSuccessful) throw RuntimeException("HTTP ${response.code}")
            return body
        }
    }

    companion object {
        const val TAG = "TorrentScraper"
        // Full desktop Chrome UA - a truncated one gets flagged as a bot by Cloudflare fronts.
        const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        fun magnetOf(element: Element): String? =
            element.select("a[href^=magnet:]").firstOrNull()?.attr("href")?.takeIf { it.isNotBlank() }
    }
}

/** ThePirateBay mirror. Paginated table; stops on the first empty page. */
class ThePirateBayScraper : BaseScraper() {
    override val source = "ThePirateBay"
    private val base = "https://1.piratebays.to"
    private val maxPages = 10

    override fun search(query: String): List<ScrapedTorrent> {
        val encoded = java.net.URLEncoder.encode(query, "UTF-8")
        val out = mutableListOf<ScrapedTorrent>()
        for (page in 1..maxPages) {
            val url = if (page == 1) "$base/s/?q=$encoded&video=on&category=0"
            else "$base/s/page/$page/?q=$encoded&video=on&category=0"
            val html = try { get(url) } catch (e: Exception) { Log.w(TAG, "TPB page $page failed: ${e.message}"); break }
            val rows = Jsoup.parse(html).select("table tr")
            var added = 0
            for (row in rows) {
                if (row.select("th").isNotEmpty()) continue
                val nameLink = row.select("a.detLink").firstOrNull() ?: continue
                val magnet = magnetOf(row) ?: continue
                val cells = row.select("td")
                out.add(
                    ScrapedTorrent(
                        name = nameLink.text().trim(),
                        magnet = magnet,
                        size = cells.getOrNull(4)?.text()?.trim() ?: "Unknown",
                        seeders = cells.getOrNull(5)?.text()?.trim() ?: "Unknown",
                        source = source
                    )
                )
                added++
            }
            if (added == 0) break
        }
        Log.i(TAG, "TPB parsed ${out.size} results")
        return out
    }
}

/** Knaben. Single path-style page, pre-sorted by seeders. */
class KnabenScraper : BaseScraper() {
    override val source = "Knaben"
    private val base = "https://knaben.org"

    override fun search(query: String): List<ScrapedTorrent> {
        val encoded = java.net.URLEncoder.encode(query, "UTF-8")
        val html = try { get("$base/search/$encoded/0/1/seeders") } catch (e: Exception) { Log.w(TAG, "Knaben failed: ${e.message}"); return emptyList() }
        val out = mutableListOf<ScrapedTorrent>()
        for (row in Jsoup.parse(html).select("tbody tr")) {
            val titleCell = row.select("td.text-wrap").firstOrNull() ?: continue
            val link = titleCell.select("a[href^=magnet:]").firstOrNull() ?: continue
            val magnet = link.attr("href").takeIf { it.isNotBlank() } ?: continue
            val cells = row.select("td")
            out.add(
                ScrapedTorrent(
                    name = link.attr("title").ifBlank { link.text().trim() },
                    magnet = magnet,
                    size = titleCell.nextElementSibling()?.text()?.trim() ?: "Unknown",
                    seeders = cells.getOrNull(cells.size - 3)?.text()?.trim() ?: "Unknown",
                    source = source
                )
            )
        }
        Log.i(TAG, "Knaben parsed ${out.size} results")
        return out
    }
}

/** UIndex. Single query page, fixed cell positions. */
class UIndexScraper : BaseScraper() {
    override val source = "UIndex"
    private val base = "https://uindex.org"

    override fun search(query: String): List<ScrapedTorrent> {
        val encoded = java.net.URLEncoder.encode(query, "UTF-8")
        val html = try { get("$base/search.php?search=$encoded&c=0") } catch (e: Exception) { Log.w(TAG, "UIndex failed: ${e.message}"); return emptyList() }
        val out = mutableListOf<ScrapedTorrent>()
        for (row in Jsoup.parse(html).select("table tr")) {
            if (row.select("th").isNotEmpty()) continue
            val cells = row.select("td")
            if (cells.size < 5) continue
            val titleCell = cells[1]
            val magnet = titleCell.select("a[href^=magnet:]").firstOrNull()?.attr("href")?.takeIf { it.isNotBlank() } ?: continue
            val name = titleCell.select("a[href*=/details.php]").firstOrNull()?.text()?.trim() ?: continue
            val seedersCell = cells[3]
            val seeders = (seedersCell.select("span.g").firstOrNull()?.text() ?: seedersCell.text())
                .replace(",", "").trim().ifBlank { "Unknown" }
            out.add(
                ScrapedTorrent(
                    name = name,
                    magnet = magnet,
                    size = cells[2].text().trim().ifBlank { "Unknown" },
                    seeders = seeders,
                    source = source
                )
            )
        }
        Log.i(TAG, "UIndex parsed ${out.size} results")
        return out
    }
}
