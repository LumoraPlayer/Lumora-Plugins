package com.redditscan.plugin

import java.net.URI

/** Parses IPTV credentials (Xtream / Stalker / M3U) out of raw paste or post text. */
class CredentialParser {

    data class ParsedCredential(
        val type: String,
        val url: String,
        val username: String? = null,
        val password: String? = null,
        val macAddress: String? = null,
        val expiryDate: String? = null,
        val maxConnections: Int? = null
    )

    private val URL_PARAM_REGEX = Regex(
        """(https?://[^?\s"'<]+)\?(?:[^\s"'<]*?&)?(?:username|user)=([^&\s"'<]+)\s*&(?:password|pass)=([^&\s"'<]+)""",
        RegexOption.IGNORE_CASE
    )

    private val LABEL_REGEX = Regex(
        """(?:Portal|Host(?:\s*URL)?|Panel|Real|URL|🔗|🌍|🌐)\W*?(https?://[^<\s"']+)[\s\S]{1,500}?(?:Username|Usu[áa]rio|Usuario|User|👤)\W*?([^\s|<"'\n]+)[\s\S]{1,200}?(?:Password|Senha|Contrase[ñn]a|Pass|🔑)\W*?([^\s|<"'\n]+)""",
        RegexOption.IGNORE_CASE
    )

    private val STALKER_REGEX = Regex("""Portal:\s*(https?://[^\s"'<>]+)""", RegexOption.IGNORE_CASE)
    private val MAC_REGEX = Regex("""MAC:\s*([0-9A-Fa-f:]{17})""")
    private val EXPIRY_REGEX = Regex("""Expiry:\s*([^|\n]+)""", RegexOption.IGNORE_CASE)
    private val MAX_ONLINE_REGEX = Regex("""MaxOnline:\s*(\d+)""", RegexOption.IGNORE_CASE)

    fun parse(content: String): List<ParsedCredential> {
        val results = mutableListOf<ParsedCredential>()
        results.addAll(parseUrlParams(content))
        results.addAll(parseLabelBased(content))
        results.addAll(parseStalker(content))
        results.addAll(parseStructuredLines(content))
        return results.distinctBy { "${it.type}:${it.url}:${it.username}:${it.macAddress}" }
    }

    private fun parseUrlParams(content: String): List<ParsedCredential> {
        val results = mutableListOf<ParsedCredential>()
        val cleaned = content.replace("&amp;", "&")
        for (m in URL_PARAM_REGEX.findAll(cleaned)) {
            try {
                val rawUrl = m.groupValues[1]
                val user = cleanCred(m.groupValues[2])
                val pass = cleanCred(m.groupValues[3])
                if (user.length < 3 || pass.length < 3) continue
                if (user.contains("http") || pass.contains("http")) continue
                val uri = URI(rawUrl)
                val baseUrl = "${uri.scheme}://${uri.host}${if (uri.port > 0) ":${uri.port}" else ""}"
                results.add(ParsedCredential(type = "xtream", url = baseUrl, username = user, password = pass))
            } catch (_: Exception) {}
        }
        return results
    }

    private fun parseLabelBased(content: String): List<ParsedCredential> {
        val results = mutableListOf<ParsedCredential>()
        for (m in LABEL_REGEX.findAll(content)) {
            try {
                val rawUrl = cleanPortalUrl(m.groupValues[1])
                val user = cleanCred(m.groupValues[2])
                val pass = cleanCred(m.groupValues[3])
                if (user.length < 3 || pass.length < 3) continue
                if (user.contains("http") || pass.contains("http")) continue
                results.add(ParsedCredential(type = "xtream", url = rawUrl, username = user, password = pass))
            } catch (_: Exception) {}
        }
        return results
    }

    private fun parseStalker(content: String): List<ParsedCredential> {
        val results = mutableListOf<ParsedCredential>()
        for (match in STALKER_REGEX.findAll(content)) {
            val portalUrl = match.groupValues[1].trimEnd('/')
            if (!portalUrl.contains("/c") && !portalUrl.contains("/stalker_portal")) continue
            val searchStart = match.range.last + 1
            val nextMatch = STALKER_REGEX.find(content, searchStart)
            val searchEnd = nextMatch?.range?.first ?: content.length
            val afterPortal = content.substring(searchStart, searchEnd)
            results.add(
                ParsedCredential(
                    type = "stalker", url = portalUrl,
                    macAddress = MAC_REGEX.find(afterPortal)?.groupValues?.get(1)?.uppercase(),
                    expiryDate = EXPIRY_REGEX.find(afterPortal)?.groupValues?.get(1)?.trim(),
                    maxConnections = MAX_ONLINE_REGEX.find(afterPortal)?.groupValues?.get(1)?.toIntOrNull()
                )
            )
        }
        return results
    }

    private fun parseStructuredLines(content: String): List<ParsedCredential> {
        val results = mutableListOf<ParsedCredential>()
        val blocks = content.split(Regex("={10,}|(?=HIT \\d+)|(?=\\n\\n)"))
        for (block in blocks) {
            try {
                val hostPortMatch = Regex("""(?:DOMAIN|Host|IP|🌐Host|🌍)\s*:?\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(:\d+)?)""", RegexOption.IGNORE_CASE).find(block)
                val hostPortStr = hostPortMatch?.groupValues?.get(1) ?: continue
                val host = hostPortStr.substringBefore(':')
                val port = hostPortStr.substringAfter(':', "80").takeIf { it != host } ?: run {
                    Regex("""(?:Port|🚪Port)\s*:?\s*(\d+)""", RegexOption.IGNORE_CASE).find(block)?.groupValues?.get(1) ?: "80"
                }
                val fullHost = if (port == "80") host else "$host:$port"
                val user = Regex("""(?:User(?:name)?|👤User)\s*:?\s*(\S+)""", RegexOption.IGNORE_CASE).find(block)?.groupValues?.get(1)?.trim() ?: continue
                if (user.length < 3) continue
                val pass = Regex("""(?:Password|Pass|🔑Password)\s*:?\s*(\S+)""", RegexOption.IGNORE_CASE).find(block)?.groupValues?.get(1)?.trim() ?: continue
                if (pass.length < 3) continue
                results.add(ParsedCredential(type = "xtream", url = "http://$fullHost", username = user, password = pass))
            } catch (_: Exception) {}
        }
        return results
    }

    private fun cleanPortalUrl(raw: String): String {
        var c = raw.replace(Regex("\\s+"), "")
        val q = c.indexOf('?')
        if (q >= 0) c = c.substring(0, q)
        if (c.contains("@")) c = "http://" + c.substringAfterLast("@")
        c = c.replace(Regex("/+(?:get|live|portal|c|index|playlist|player_api|xmltv)\\.php$", RegexOption.IGNORE_CASE), "")
        c = c.replace(Regex("/+index\\.php$"), "")
        while (c.endsWith('/')) c = c.dropLast(1)
        if (!c.startsWith("http://") && !c.startsWith("https://")) c = "http://$c"
        return c
    }

    private fun cleanCred(raw: String): String {
        var s = raw.trim()
        while (s.startsWith("=")) s = s.drop(1)
        return s.split(Regex("[ \n&?]")).firstOrNull()?.trim() ?: ""
    }
}
