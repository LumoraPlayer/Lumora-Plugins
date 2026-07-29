package com.redditscan.plugin

import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** Live-checks a parsed credential by hitting its stream/portal endpoint. */
class CredentialTester {

    companion object {
        private const val MAX_READ_BYTES = 8192
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    data class TestResult(
        val credential: CredentialParser.ParsedCredential,
        val online: Boolean,
        val responseCode: Int = 0,
        val responseSize: Long = 0,
        val error: String? = null
    )

    fun test(credential: CredentialParser.ParsedCredential): TestResult {
        return try {
            when (credential.type) {
                "m3u", "xtream" -> testXtreamM3u(credential)
                "stalker" -> testStalker(credential)
                else -> TestResult(credential, false, error = "Unknown type: ${credential.type}")
            }
        } catch (e: Exception) {
            TestResult(credential, false, error = e.message)
        }
    }

    private fun testXtreamM3u(credential: CredentialParser.ParsedCredential): TestResult {
        val request = Request.Builder().url(buildM3uUrl(credential))
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .header("Accept", "*/*")
            .header("Connection", "close")
            .build()
        return try {
            client.newCall(request).execute().use { response ->
                val body = response.body
                val headBytes = readHeadBytes(body?.byteStream())
                val headStr = String(headBytes, Charsets.UTF_8)
                val isM3u = headStr.startsWith("#EXTM3U") || headStr.startsWith("#EXTINF") || headStr.contains("#KODIPROP")
                TestResult(
                    credential = credential,
                    online = response.isSuccessful && (isM3u || headBytes.size > 100),
                    responseCode = response.code,
                    responseSize = body?.contentLength() ?: headBytes.size.toLong(),
                    error = if (response.isSuccessful && !isM3u && headBytes.size < 100) "Not a valid M3U response" else null
                )
            }
        } catch (e: Exception) {
            TestResult(credential, false, error = e.message)
        }
    }

    private fun testStalker(credential: CredentialParser.ParsedCredential): TestResult {
        val request = Request.Builder().url(credential.url.trimEnd('/'))
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            .header("Accept", "*/*")
            .build()
        return try {
            client.newCall(request).execute().use { response ->
                val headBytes = readHeadBytes(response.body?.byteStream())
                val headStr = String(headBytes, Charsets.UTF_8)
                val isValid = response.isSuccessful && headStr.length > 50
                TestResult(
                    credential, online = isValid, responseCode = response.code,
                    responseSize = response.body?.contentLength() ?: headStr.length.toLong(),
                    error = if (!isValid) "Portal not responding" else null
                )
            }
        } catch (e: Exception) {
            TestResult(credential, false, error = e.message)
        }
    }

    private fun readHeadBytes(stream: java.io.InputStream?): ByteArray {
        if (stream == null) return ByteArray(0)
        return try {
            val buf = ByteArray(MAX_READ_BYTES)
            val len = stream.read(buf)
            stream.close()
            if (len > 0) buf.copyOf(len) else ByteArray(0)
        } catch (_: Exception) { ByteArray(0) }
    }

    private fun buildM3uUrl(credential: CredentialParser.ParsedCredential): String {
        return if (credential.username != null && credential.password != null) {
            "${credential.url}/get.php?username=${credential.username}&password=${credential.password}&type=m3u_plus&output=m3u8"
        } else {
            credential.url
        }
    }
}
