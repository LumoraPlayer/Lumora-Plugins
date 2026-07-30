package com.lumora.animeplugin

import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * AniList GraphQL client for anime search and metadata lookup.
 *
 * Uses the public AniList API (no auth required for basic queries). Rate-limited to 90 req/min
 * per IP; our usage pattern (one search per user interaction) stays well under that.
 */
class AniListClient(private val client: OkHttpClient) {

    /**
     * Represents one anime result from an AniList search.
     */
    data class AnimeMatch(
        val id: Int,
        val malId: Int?,
        val titleRomaji: String,
        val titleEnglish: String?,
        val titleNative: String?,
        val episodes: Int?,
        val status: String?,
        val format: String?,
        val seasonYear: Int?,
        val coverImage: String?,
        val studio: String?
    )

    /**
     * Searches AniList for anime matching [query]. Returns up to [limit] results.
     */
    fun search(query: String, limit: Int = 8): List<AnimeMatch> {
        val bodyJson = JSONObject()
            .put("query", SEARCH_QUERY)
            .put("variables", JSONObject().put("search", query))

        val request = Request.Builder()
            .url("https://graphql.anilist.co")
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .post(bodyJson.toString().toRequestBody("application/json".toMediaType()))
            .build()

        val response = client.newCall(request).execute()
        val responseBody = response.body?.string() ?: error("AniList returned empty body")
        if (!response.isSuccessful) {
            Log.w(TAG, "AniList HTTP ${response.code}: $responseBody")
            error("AniList API error ${response.code}")
        }

        val root = JSONObject(responseBody)
        val mediaArray = root.optJSONObject("data")
            ?.optJSONObject("Page")
            ?.optJSONArray("media")
            ?: return emptyList()

        val results = mutableListOf<AnimeMatch>()
        for (i in 0 until mediaArray.length().coerceAtMost(limit)) {
            val media = mediaArray.optJSONObject(i) ?: continue
            val title = media.optJSONObject("title") ?: continue

            val studios = media.optJSONObject("studios")?.optJSONArray("nodes")
            val studioName = if (studios != null && studios.length() > 0)
                studios.optJSONObject(0)?.optString("name", null) else null

            val coverImage = media.optJSONObject("coverImage")?.optString("large", null)

            results.add(AnimeMatch(
                id = media.getInt("id"),
                malId = if (media.has("idMal") && !media.isNull("idMal")) media.getInt("idMal") else null,
                titleRomaji = title.optString("romaji", ""),
                titleEnglish = title.optString("english", null)?.takeIf { it.isNotBlank() },
                titleNative = title.optString("native", null)?.takeIf { it.isNotBlank() },
                episodes = if (media.has("episodes") && !media.isNull("episodes")) media.getInt("episodes") else null,
                status = media.optString("status", null)?.takeIf { it.isNotBlank() },
                format = media.optString("format", null)?.takeIf { it.isNotBlank() },
                seasonYear = if (media.has("seasonYear") && !media.isNull("seasonYear")) media.getInt("seasonYear") else null,
                coverImage = coverImage?.takeIf { it.isNotBlank() },
                studio = studioName?.takeIf { it.isNotBlank() }
            ))
        }
        return results
    }

    /**
     * Returns display-friendly titles for an anime match.
     */
    fun displayTitle(match: AnimeMatch): String {
        val eng = match.titleEnglish?.takeIf { it.isNotBlank() }
        val rom = match.titleRomaji.takeIf { it.isNotBlank() }
        return eng ?: rom ?: "Unknown"
    }

    companion object {
        private const val TAG = "AniListClient"

        private val SEARCH_QUERY = """
            query (\$search: String) {
              Page(page: 1, perPage: 10) {
                media(search: \$search, type: ANIME) {
                  id
                  idMal
                  title { romaji english native }
                  episodes
                  status
                  format
                  seasonYear
                  coverImage { large }
                  studios(isMain: true) { nodes { name } }
                }
              }
            }
        """.trimIndent()
    }
}
