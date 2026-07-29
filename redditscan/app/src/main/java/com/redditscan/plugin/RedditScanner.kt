package com.redditscan.plugin

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Scans a public subreddit for paste URLs that may contain IPTV credentials, using an
 * anonymous OAuth2 "installed_client" grant so no user login is needed.
 */
class RedditScanner {

    companion object {
        private val PASTE_DOMAINS = listOf(
            "paste.sh", "pastebin.com", "rentry.co", "justpaste.it",
            "controlc.com", "pastes.dev", "text.is"
        )
        private val PASTE_URL_REGEX = Regex(
            "https?://(?:${PASTE_DOMAINS.joinToString("|") { it.replace(".", "\\.") }})/[A-Za-z0-9#_=\\-]+"
        )
        private val BASE64_REGEX = Regex("aHR0c[A-Za-z0-9+/=]{10,}")
        private const val MAX_AGE_MS = 24L * 60 * 60 * 1000
        private const val SUBREDDIT = "IPTV_ZONENEW"
        private val CLIENT_IDS = listOf("ohXpoqrZYub1kg", "NOe2iKrPPzwscA")
        private const val OAUTH_UA = "RedditScanPlugin/1.0"
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    data class RedditPost(
        val id: String, val title: String, val selftext: String,
        val permalink: String, val timestamp: Long
    )

    data class ScanResult(val posts: List<RedditPost>, val pasteUrls: List<String>)

    suspend fun scan(): ScanResult = withContext(Dispatchers.IO) {
        val posts = mutableListOf<RedditPost>()
        val allPasteUrls = mutableSetOf<String>()
        try {
            val token = getOAuthToken()
            if (token != null) fetchPostsOAuth(token, posts, allPasteUrls)
        } catch (_: Exception) {}
        ScanResult(posts, allPasteUrls.toList())
    }

    private fun getOAuthToken(): String? {
        for (clientId in CLIENT_IDS) {
            try {
                val auth = Base64.encodeToString("$clientId:".toByteArray(), Base64.NO_WRAP)
                val body = "grant_type=https%3A%2F%2Foauth.reddit.com%2Fgrants%2Finstalled_client&device_id=DO_NOT_TRACK_THIS_DEVICE"
                val request = Request.Builder()
                    .url("https://www.reddit.com/api/v1/access_token")
                    .header("User-Agent", OAUTH_UA)
                    .header("Authorization", "Basic $auth")
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .post(okhttp3.RequestBody.create(null, body))
                    .build()
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@use
                    val str = response.body?.string() ?: return@use
                    val token = JSONObject(str).optString("access_token", null)
                    if (token != null) return token
                }
            } catch (_: Exception) {}
        }
        return null
    }

    private fun fetchPostsOAuth(
        token: String,
        posts: MutableList<RedditPost>,
        urls: MutableSet<String>
    ) {
        val pageUrl = "https://oauth.reddit.com/r/$SUBREDDIT/new?limit=100&sort=new&raw_json=1"
        val jsonStr = fetchOAuth(pageUrl, token) ?: return
        val data = JSONObject(jsonStr).optJSONObject("data") ?: return
        val children = data.optJSONArray("children") ?: return

        for (i in 0 until children.length()) {
            val postData = children.optJSONObject(i)?.optJSONObject("data") ?: continue
            val created = postData.optLong("created_utc", 0) * 1000
            if (created == 0L) continue
            if (System.currentTimeMillis() - created > MAX_AGE_MS) continue

            val id = postData.optString("id", "")
            val title = postData.optString("title", "")
            val selftext = postData.optString("selftext", "")
            val permalink = postData.optString("permalink", "")
            if (id.isEmpty() || permalink.isEmpty()) continue

            val fullPermalink = "https://www.reddit.com$permalink"
            posts.add(RedditPost(id, title, selftext, fullPermalink, created))

            val combinedBody = "$title $selftext"
            for (m in PASTE_URL_REGEX.findAll(combinedBody)) urls.add(m.value)
            for (m in BASE64_REGEX.findAll(combinedBody)) {
                try {
                    val decoded = String(Base64.decode(m.value, Base64.DEFAULT), Charsets.UTF_8)
                    if (PASTE_DOMAINS.any { decoded.contains(it) }) urls.add(decoded)
                } catch (_: Exception) {}
            }

            try {
                val cJson = fetchOAuth("$fullPermalink.json?raw_json=1", token) ?: continue
                val cArray = JSONArray(cJson)
                if (cArray.length() > 1) {
                    val cChildren = cArray.optJSONObject(1)?.optJSONObject("data")?.optJSONArray("children")
                    if (cChildren != null) scrapeComments(cChildren, urls)
                }
            } catch (_: Exception) {}
        }
    }

    private fun scrapeComments(children: JSONArray, urls: MutableSet<String>) {
        for (i in 0 until children.length()) {
            val data = children.optJSONObject(i)?.optJSONObject("data") ?: continue
            val body = data.optString("body", "")
            for (m in PASTE_URL_REGEX.findAll(body)) urls.add(m.value)
            for (m in BASE64_REGEX.findAll(body)) {
                try {
                    val decoded = String(Base64.decode(m.value, Base64.DEFAULT), Charsets.UTF_8)
                    if (PASTE_DOMAINS.any { decoded.contains(it) }) urls.add(decoded)
                } catch (_: Exception) {}
            }
            val replies = data.optJSONObject("replies")?.optJSONObject("data")?.optJSONArray("children")
            if (replies != null) scrapeComments(replies, urls)
        }
    }

    private fun fetchOAuth(url: String, token: String): String? {
        return try {
            val request = Request.Builder().url(url)
                .header("User-Agent", OAUTH_UA)
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                response.body?.string()
            }
        } catch (_: Exception) { null }
    }
}
