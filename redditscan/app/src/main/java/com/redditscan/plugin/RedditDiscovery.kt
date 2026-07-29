package com.redditscan.plugin

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import kotlin.coroutines.coroutineContext

/**
 * The whole discovery run: scan the subreddit, fetch and decrypt pastes, parse credentials,
 * live-test them, and hand each confirmed-working one to [onCandidate] as it's found.
 *
 * This is the plugin-side equivalent of the host app's old RedditProviderFinder, minus the
 * bit that wrote straight into the provider store - a plugin can't touch the host's storage,
 * and shouldn't: it only proposes, the host confirms and saves.
 *
 * Cancellation-aware: every loop checks the coroutine is still active, so the host cancelling
 * the job actually stops the network work rather than letting it run to completion unseen.
 */
class RedditDiscovery(
    private val onProgress: (String) -> Unit,
    private val onCandidate: (DiscoveredCandidate) -> Unit
) {

    private val scanner = RedditScanner()
    private val decryptor = PasteShDecryptor()
    private val parser = CredentialParser()
    private val tester = CredentialTester()

    /** How many working providers to surface before stopping - enough to be useful, not a flood. */
    private val targetWorking = 5

    suspend fun run(): String = withContext(Dispatchers.IO) {
        onProgress("Scanning Reddit for paste links…")
        val scan = try {
            scanner.scan()
        } catch (_: Exception) {
            return@withContext "Reddit scan failed"
        }
        coroutineContext.ensureActive()
        if (scan.pasteUrls.isEmpty()) return@withContext "No paste links found"
        onProgress("Found ${scan.posts.size} posts, ${scan.pasteUrls.size} paste links")

        val contents = mutableListOf<String>()
        var done = 0
        for (url in scan.pasteUrls) {
            coroutineContext.ensureActive()
            onProgress("Fetching paste ${++done}/${scan.pasteUrls.size}…")
            val content = try {
                if (url.contains("paste.sh/") && url.contains("#")) decryptor.decrypt(url) else fetchPaste(url)
            } catch (_: Exception) { null }
            content?.let { contents.add(it) }
        }

        onProgress("Parsing credentials…")
        val parsed = mutableListOf<CredentialParser.ParsedCredential>()
        for (content in contents) parsed.addAll(parser.parse(content))
        for (post in scan.posts) parsed.addAll(parser.parse("${post.title} ${post.selftext}"))
        val unique = parsed.distinctBy { "${it.type}:${it.url}:${it.username}:${it.macAddress}" }
        if (unique.isEmpty()) return@withContext "No credentials found in pastes"
        onProgress("Testing ${unique.size} credential(s)…")

        var workingCount = 0
        val seenDomains = mutableSetOf<String>()
        val remaining = unique.toMutableList()
        while (remaining.isNotEmpty() && workingCount < targetWorking) {
            coroutineContext.ensureActive()
            remaining.removeAll { domainOf(it.url) in seenDomains }
            if (remaining.isEmpty()) break
            val batch = remaining.take(20)
            remaining.subList(0, batch.size).clear()

            val results = coroutineScope {
                batch.map { cred -> async(Dispatchers.IO) { tester.test(cred) } }.awaitAll()
            }
            for (result in results) {
                if (!result.online) continue
                val domain = domainOf(result.credential.url)
                if (!seenDomains.add(domain)) continue
                onCandidate(toCandidate(result))
                workingCount++
                onProgress("Found $workingCount working provider(s)…")
                if (workingCount >= targetWorking) break
            }
        }

        if (workingCount == 0) "Tested ${unique.size}, none responded" else "Found $workingCount working provider(s)"
    }

    private fun toCandidate(result: CredentialTester.TestResult): DiscoveredCandidate {
        val cred = result.credential
        val domain = domainOf(cred.url)
        val typeLabel = when (cred.type) { "xtream" -> "Xtream"; "stalker" -> "Stalker"; else -> "M3U" }
        val detail = listOfNotNull(
            typeLabel,
            cred.expiryDate?.let { "expires $it" },
            cred.maxConnections?.let { "$it connections" },
            result.responseCode.takeIf { it > 0 }?.let { "HTTP $it" }
        ).joinToString(" · ")
        return DiscoveredCandidate(
            type = cred.type,
            label = "Reddit - $domain",
            url = cred.url,
            username = cred.username,
            password = cred.password,
            // Stalker's MAC rides in the same slot the host reads a Stalker MAC / M3U UA from.
            userAgent = cred.macAddress,
            detail = detail,
            verified = true
        )
    }

    private fun domainOf(url: String): String =
        url.removePrefix("http://").removePrefix("https://").substringBefore("/").trim()

    private fun fetchPaste(url: String): String? {
        return try {
            val actualUrl = when {
                url.contains("pastebin.com/") && !url.contains("/raw/") ->
                    "https://pastebin.com/raw/${pasteId(url)}"
                url.contains("rentry.co/") && !url.contains("/raw") ->
                    "https://rentry.co/${pasteId(url)}/raw"
                url.contains("pastes.dev/") ->
                    "https://api.pastes.dev/${pasteId(url)}"
                else -> url
            }
            val request = Request.Builder().url(actualUrl)
                .header("User-Agent", "Mozilla/5.0")
                .header("Accept", "text/plain,text/html,*/*")
                .build()
            val client = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .followRedirects(true)
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                response.body?.string()
            }
        } catch (_: Exception) { null }
    }

    private fun pasteId(url: String): String =
        url.trimEnd('/').substringAfterLast('/').substringBefore('#')
}

/** One provider the plugin proposes. Mirrors the host's DiscoveredProvider by field. */
data class DiscoveredCandidate(
    val type: String,
    val label: String,
    val url: String,
    val username: String?,
    val password: String?,
    val userAgent: String?,
    val detail: String?,
    val verified: Boolean
)
