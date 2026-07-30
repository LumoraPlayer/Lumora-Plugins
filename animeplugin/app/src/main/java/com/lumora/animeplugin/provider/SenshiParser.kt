package com.lumora.animeplugin.provider

import org.json.JSONArray
import org.json.JSONObject

/**
 * Parses Senshi API JSON responses. Ported from Anilili's SenshiParser with the same shape.
 *
 * Senshi API:
 *   GET /episodes/{malId}     → episode list with titles, filler flags, skip times
 *   GET /episode-embeds/{malId}/{ep} → HLS URL + fallback embed URLs per-source
 */
object SenshiParser {

    data class EpisodeMeta(
        val number: Int,
        val title: String?,
        val filler: Boolean,
        val introStart: Double?,
        val introEnd: Double?,
        val outroStart: Double?,
        val outroEnd: Double?
    )

    data class EpisodeSource(
        val url: String?,            // HLS direct URL
        val server2: String?,        // StreamNin embed fallback
        val serverFM: String?,       // FileMoon embed fallback
        val status: String?,         // "Sub" / "Dub" / "SoftSub" / "HardSub"
        val download: String?,       // Optional download URL
        val maskedBaseUrl: String?   // Base URL for sidecar subtitle files
    )

    /**
     * Parses the `/episodes/{malId}` response.
     * Returns map of episode number → metadata.
     */
    fun parseCatalog(json: String): Map<Int, EpisodeMeta> {
        val array = try { JSONArray(json) } catch (_: Exception) { return emptyMap() }
        val map = mutableMapOf<Int, EpisodeMeta>()
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val number = item.optInt("ep_id", -1)
            if (number <= 0) continue
            map[number] = EpisodeMeta(
                number = number,
                title = item.optString("ep_title", null)?.takeIf { it.isNotBlank() },
                filler = item.optBoolean("ep_filler", false),
                introStart = if (item.has("intro_start") && !item.isNull("intro_start"))
                    item.optDouble("intro_start") else null,
                introEnd = if (item.has("intro_end") && !item.isNull("intro_end"))
                    item.optDouble("intro_end") else null,
                outroStart = if (item.has("outro_start") && !item.isNull("outro_start"))
                    item.optDouble("outro_start") else null,
                outroEnd = if (item.has("outro_end") && !item.isNull("outro_end"))
                    item.optDouble("outro_end") else null
            )
        }
        return map
    }

    /**
     * Parses the `/episode-embeds/{malId}/{ep}` response.
     * Returns list of available sources (one per audio type).
     */
    fun parseEmbeds(json: String): List<EpisodeSource> {
        val array = try { JSONArray(json) } catch (_: Exception) { return emptyList() }
        val results = mutableListOf<EpisodeSource>()
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            results.add(EpisodeSource(
                url = item.optString("url", null)?.takeIf { it.isNotBlank() },
                server2 = item.optString("server2", null)?.takeIf { it.isNotBlank() },
                serverFM = item.optString("serverFM", null)?.takeIf { it.isNotBlank() },
                status = item.optString("status", null)?.takeIf { it.isNotBlank() },
                download = item.optString("download", null)?.takeIf { it.isNotBlank() },
                maskedBaseUrl = item.optString("masked_base_url", null)?.takeIf { it.isNotBlank() }
            ))
        }
        return results
    }

    /**
     * Whether an embed entry is a dub source.
     */
    fun isDub(source: EpisodeSource): Boolean =
        source.status.equals("dub", ignoreCase = true)
}
