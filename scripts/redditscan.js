// provider_discovery plugin: scans r/IPTV_ZONENEW for paste links, decrypts/fetches them,
// parses Xtream/Stalker/M3U credentials out of the text, and live-tests each one.
// Ported from the old redditscan APK (RedditScanner.kt + PasteShDecryptor.kt +
// CredentialParser.kt + CredentialTester.kt + RedditDiscovery.kt) onto Lumora's in-process JS
// plugin host API - see JsPluginContract.kt.

PLUGIN = {
    id: "reddit.iptvscan",
    label: "Reddit IPTV Scanner",
    description: "Scans r/IPTV_ZONENEW for public IPTV credential pastes and proposes working ones.",
    capabilities: ["provider_discovery"],
};

var SUBREDDIT = "IPTV_ZONENEW";
var CLIENT_IDS = ["ohXpoqrZYub1kg", "NOe2iKrPPzwscA"];
var OAUTH_UA = "RedditScanPlugin/1.0";
var MAX_AGE_MS = 24 * 60 * 60 * 1000;
var TARGET_WORKING = 5;

var PASTE_DOMAINS = ["paste.sh", "pastebin.com", "rentry.co", "justpaste.it", "controlc.com", "pastes.dev", "text.is"];
var PASTE_URL_REGEX = new RegExp(
    "https?://(?:" + PASTE_DOMAINS.map(function (d) { return d.replace(/\./g, "\\."); }).join("|") + ")/[A-Za-z0-9#_=\\-]+",
    "g"
);
var BASE64_URL_REGEX = /aHR0c[A-Za-z0-9+/=]{10,}/g;

var URL_PARAM_REGEX = /(https?:\/\/[^?\s"'<]+)\?(?:[^\s"'<]*?&)?(?:username|user)=([^&\s"'<]+)\s*&(?:password|pass)=([^&\s"'<]+)/gi;
var LABEL_REGEX = /(?:Portal|Host(?:\s*URL)?|Panel|Real|URL|🔗|🌍|🌐)\W*?(https?:\/\/[^<\s"']+)[\s\S]{1,500}?(?:Username|Usu[áa]rio|Usuario|User|👤)\W*?([^\s|<"'\n]+)[\s\S]{1,200}?(?:Password|Senha|Contrase[ñn]a|Pass|🔑)\W*?([^\s|<"'\n]+)/gi;
var STALKER_REGEX = /Portal:\s*(https?:\/\/[^\s"'<>]+)/gi;
var MAC_REGEX = /MAC:\s*([0-9A-Fa-f:]{17})/;
var EXPIRY_REGEX = /Expiry:\s*([^|\n]+)/i;
var MAX_ONLINE_REGEX = /MaxOnline:\s*(\d+)/i;

// ── Reddit scanning ──

function getOAuthToken() {
    for (var i = 0; i < CLIENT_IDS.length; i++) {
        try {
            var auth = host.base64Encode(CLIENT_IDS[i] + ":");
            var body = "grant_type=https%3A%2F%2Foauth.reddit.com%2Fgrants%2Finstalled_client&device_id=DO_NOT_TRACK_THIS_DEVICE";
            var resp = host.httpPost("https://www.reddit.com/api/v1/access_token", body, {
                "User-Agent": OAUTH_UA,
                "Authorization": "Basic " + auth,
                "Content-Type": "application/x-www-form-urlencoded",
            });
            host.log("reddit: oauth[" + i + "] status=" + resp.status + " len=" + (resp.body||"").length);
            if (resp.status >= 200 && resp.status < 300) {
                var json = JSON.parse(resp.body);
                if (json.access_token) {
                    host.log("reddit: oauth[" + i + "] TOKEN_OK");
                    return json.access_token;
                }
                host.log("reddit: oauth response had no access_token: " + resp.body.substring(0,200));
            }
        } catch (e) {
            host.log("reddit: oauth[" + i + "] threw: " + (e.message || e));
        }
    }
    host.log("reddit: oauth ALL FAILED");
    return null;
}

function fetchOAuth(url, token) {
    try {
        var resp = host.httpGet(url, {
            "User-Agent": OAUTH_UA,
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
        });
        if (resp.status < 200 || resp.status >= 300) {
            host.log("reddit: fetchOAuth status=" + resp.status + " url=" + url.substring(0,120));
            return null;
        }
        return resp.body;
    } catch (e) {
        host.log("reddit: fetchOAuth threw: " + (e.message || e) + " url=" + url.substring(0,120));
        return null;
    }
}

function findPasteUrls(text, urlSet) {
    var m;
    PASTE_URL_REGEX.lastIndex = 0;
    while ((m = PASTE_URL_REGEX.exec(text)) !== null) {
        urlSet[m[0]] = true;
    }
    BASE64_URL_REGEX.lastIndex = 0;
    while ((m = BASE64_URL_REGEX.exec(text)) !== null) {
        try {
            var decoded = host.base64Decode(m[0]);
            for (var i = 0; i < PASTE_DOMAINS.length; i++) {
                if (decoded.indexOf(PASTE_DOMAINS[i]) !== -1) {
                    urlSet[decoded] = true;
                    break;
                }
            }
        } catch (e) {
            // not valid base64 / not utf-8 - skip
        }
    }
}

function scrapeComments(children, urlSet) {
    for (var i = 0; i < children.length; i++) {
        var data = children[i] && children[i].data;
        if (!data) continue;
        findPasteUrls(data.body || "", urlSet);
        var replies = data.replies && data.replies.data && data.replies.data.children;
        if (replies) scrapeComments(replies, urlSet);
    }
}

function fetchPostsOAuth(token, posts, urlSet) {
    var pageUrl = "https://oauth.reddit.com/r/" + SUBREDDIT + "/new?limit=100&sort=new&raw_json=1";
    var jsonStr = fetchOAuth(pageUrl, token);
    if (!jsonStr) {
        host.log("reddit: fetchPostsOAuth - no response body");
        return;
    }
    var root = JSON.parse(jsonStr);
    var children = root && root.data && root.data.children;
    if (!children) {
        host.log("reddit: fetchPostsOAuth - no children in response, keys=" + Object.keys(root || {}).join(","));
        return;
    }
    host.log("reddit: fetchPostsOAuth - " + children.length + " children");

    var now = Date.now();
    var kept = 0;
    for (var i = 0; i < children.length; i++) {
        var postData = children[i] && children[i].data;
        if (!postData) continue;
        var created = (postData.created_utc || 0) * 1000;
        if (!created || now - created > MAX_AGE_MS) continue;

        var id = postData.id || "";
        var permalink = postData.permalink || "";
        if (!id || !permalink) continue;
        var title = postData.title || "";
        var selftext = postData.selftext || "";
        var fullPermalink = "https://www.reddit.com" + permalink;
        posts.push({ id: id, title: title, selftext: selftext, permalink: fullPermalink });
        kept++;

        findPasteUrls(title + " " + selftext, urlSet);

        try {
            // Comments must be fetched through oauth.reddit.com, not www.reddit.com - the
            // OAuth bearer token is only accepted on the API host, so this 403s on every
            // single post otherwise (verified against real device logs: every comment fetch
            // failed, silently, while everything else in the run succeeded).
            var cJson = fetchOAuth("https://oauth.reddit.com" + permalink + ".json?raw_json=1", token);
            if (cJson) {
                var cArray = JSON.parse(cJson);
                if (Array.isArray(cArray) && cArray.length > 1) {
                    var cChildren = cArray[1] && cArray[1].data && cArray[1].data.children;
                    if (cChildren) scrapeComments(cChildren, urlSet);
                }
            }
        } catch (e) {
            // comment tree fetch/parse failed - the post itself was already scanned
        }
    }
    host.log("reddit: fetchPostsOAuth - kept=" + kept + " urlsSoFar=" + Object.keys(urlSet).length + " ignored=" + (children.length - kept) + " (older than 24h)");
}

function redditScan() {
    var posts = [];
    var urlSet = {};
    try {
        var token = getOAuthToken();
        if (token) fetchPostsOAuth(token, posts, urlSet);
    } catch (e) {
        // fall through with whatever was collected before the failure
    }
    return { posts: posts, pasteUrls: Object.keys(urlSet) };
}

// ── paste.sh decryption ──
//
// key||iv = HMAC-SHA512(key = pasteId+serverKey+clientKey+"https://paste.sh", message = salt || 0x00000001)[0:48]
// (this is exactly one round of standard PBKDF2-HMAC-SHA512 - paste.sh always uses 1 round and
// a 48-byte derived key, which never needs a second block), with an OpenSSL EVP_BytesToKey
// (iterated MD5) fallback for older pastes. All intermediate values stay base64-encoded end to
// end - see JsHostImpl's binary-safe primitives - since JS strings can't hold arbitrary bytes.

var ONE_AS_INT32BE_B64 = "AAAAAQ=="; // base64 of the 4 bytes [0,0,0,1]

function pasteShDecrypt(pasteUrl) {
    try {
        var hashIdx = pasteUrl.indexOf("#");
        if (hashIdx <= 0) {
            host.log("reddit: pasteShDecrypt no hash in url=" + pasteUrl.substring(0, 80));
            return null;
        }
        var baseUrl = pasteUrl.substring(0, hashIdx);
        var clientKey = pasteUrl.substring(hashIdx + 1);
        var pasteId = baseUrl.substring(baseUrl.lastIndexOf("/") + 1);
        if (!pasteId) {
            host.log("reddit: pasteShDecrypt no pasteId from " + pasteUrl.substring(0, 80));
            return null;
        }

        var resp = host.httpGet(baseUrl + ".txt", { "User-Agent": "Mozilla/5.0", "Accept": "text/plain,*/*" });
        if (resp.status < 200 || resp.status >= 300) {
            host.log("reddit: pasteShDecrypt fetch status=" + resp.status + " for " + pasteId);
            return null;
        }
        var lines = resp.body.split("\n");
        var firstLine = (lines[0] || "").trim();
        var b64Ciphertext, passwordB64;

        if (firstLine.length === 0) {
            // paste.sh v3 format: leading \n, no server key.
            // Key derivation: HMAC-SHA512(password, salt || 0x00000001) -> first 48 bytes
            // (matches the original PasteShDecryptor.kt approach, unlike PBKDF2 PBEKeySpec
            // which uses platform-dependent char encoding).
            host.log("reddit: pasteShDecrypt v3 format for " + pasteId);
            b64Ciphertext = lines.slice(1).join("").trim();
            if (!b64Ciphertext) {
                host.log("reddit: pasteShDecrypt no ciphertext for " + pasteId);
                return null;
            }
            var saltB64 = host.base64Slice(b64Ciphertext, 8, 16);
            var ctB64 = host.base64Slice(b64Ciphertext, 16, null);
            try {
                var passwordB64 = host.base64Encode(pasteId + clientKey + "https://paste.sh");
                var message = host.base64Concat(saltB64, ONE_AS_INT32BE_B64);
                var keyIvB64 = host.hmacSha512(passwordB64, message);
                var keyB64 = host.base64Slice(keyIvB64, 0, 32);
                var ivB64 = host.base64Slice(keyIvB64, 32, 48);
                var decrypted = host.aesCbcDecrypt(ctB64, keyB64, ivB64);
                host.log("reddit: pasteShDecrypt v3 OK len=" + decrypted.length + " for " + pasteId);
                return decrypted;
            } catch (e) {
                host.log("reddit: pasteShDecrypt v3 HMAC failed for " + pasteId + ": " + (e.message || e));
                return null;
            }
        } else {
            // Legacy format: first line is server key, HMAC-SHA512 key derivation.
            var serverKey = firstLine;
            b64Ciphertext = lines.slice(1).join("").trim();
            if (!b64Ciphertext) {
                host.log("reddit: pasteShDecrypt no ciphertext for " + pasteId);
                return null;
            }
            passwordB64 = host.base64Encode(pasteId + serverKey + clientKey + "https://paste.sh");
            var saltB64 = host.base64Slice(b64Ciphertext, 8, 16);
            var ctB64 = host.base64Slice(b64Ciphertext, 16, null);

            try {
                var message = host.base64Concat(saltB64, ONE_AS_INT32BE_B64);
                var keyIvB64 = host.hmacSha512(passwordB64, message);
                var keyB64 = host.base64Slice(keyIvB64, 0, 32);
                var ivB64 = host.base64Slice(keyIvB64, 32, 48);
                var decrypted = host.aesCbcDecrypt(ctB64, keyB64, ivB64);
                host.log("reddit: pasteShDecrypt legacy OK len=" + decrypted.length + " for " + pasteId);
                return decrypted;
            } catch (e) {
                host.log("reddit: pasteShDecrypt legacy HMAC failed for " + pasteId + ", trying EVP fallback: " + (e.message || e));
                var fallback = evpBytesToKeyDecrypt(passwordB64, saltB64, ctB64);
                if (fallback) host.log("reddit: pasteShDecrypt EVP fallback OK len=" + fallback.length + " for " + pasteId);
                else host.log("reddit: pasteShDecrypt EVP fallback also failed for " + pasteId);
                return fallback;
            }
        }
    } catch (e) {
        host.log("reddit: pasteShDecrypt threw: " + (e.message || e) + " for " + pasteUrl.substring(0, 60));
        return null;
    }
}

function evpBytesToKeyDecrypt(passwordB64, saltB64, ctB64) {
    var prevB64 = "";
    var keyIvB64 = "";
    var producedBytes = 0;
    while (producedBytes < 48) {
        var input = host.base64Concat(host.base64Concat(prevB64, passwordB64), saltB64);
        prevB64 = host.md5Bytes(input);
        keyIvB64 = host.base64Concat(keyIvB64, prevB64);
        producedBytes += 16; // MD5 digest is always 16 bytes
    }
    var keyB64 = host.base64Slice(keyIvB64, 0, 32);
    var ivB64 = host.base64Slice(keyIvB64, 32, 48);
    return host.aesCbcDecrypt(ctB64, keyB64, ivB64);
}

function pasteId(url) {
    var u = url.replace(/\/+$/, "");
    u = u.substring(u.lastIndexOf("/") + 1);
    var hashIdx = u.indexOf("#");
    return hashIdx !== -1 ? u.substring(0, hashIdx) : u;
}

function fetchPaste(url) {
    try {
        var actualUrl = url;
        if (url.indexOf("pastebin.com/") !== -1 && url.indexOf("/raw") === -1) {
            actualUrl = "https://pastebin.com/raw/" + pasteId(url);
        } else if (url.indexOf("rentry.co/") !== -1 && url.indexOf("/raw") === -1) {
            actualUrl = "https://rentry.co/" + pasteId(url) + "/raw";
        } else if (url.indexOf("pastes.dev/") !== -1) {
            actualUrl = "https://api.pastes.dev/" + pasteId(url);
        }
        var resp = host.httpGet(actualUrl, { "User-Agent": "Mozilla/5.0", "Accept": "text/plain,text/html,*/*" });
        if (resp.status < 200 || resp.status >= 300) {
            host.log("reddit: fetchPaste status=" + resp.status + " url=" + actualUrl.substring(0, 100));
            return null;
        }
        host.log("reddit: fetchPaste OK status=" + resp.status + " len=" + (resp.body || "").length + " url=" + actualUrl.substring(0, 80));
        return resp.body;
    } catch (e) {
        host.log("reddit: fetchPaste threw: " + (e.message || e) + " url=" + url.substring(0, 80));
        return null;
    }
}

// ── Credential parsing ──

function parseBaseUrl(rawUrl) {
    var m = /^(https?):\/\/([^\/:?#]+)(?::(\d+))?/i.exec(rawUrl);
    if (!m) return null;
    return m[1] + "://" + m[2] + (m[3] ? ":" + m[3] : "");
}

function cleanCred(raw) {
    var s = raw.trim();
    while (s.charAt(0) === "=") s = s.substring(1);
    var parts = s.split(/[ \n&?]/);
    return (parts[0] || "").trim();
}

function cleanPortalUrl(raw) {
    var c = raw.replace(/\s+/g, "");
    var q = c.indexOf("?");
    if (q >= 0) c = c.substring(0, q);
    if (c.indexOf("@") !== -1) c = "http://" + c.substring(c.lastIndexOf("@") + 1);
    c = c.replace(/\/+(?:get|live|portal|c|index|playlist|player_api|xmltv)\.php$/i, "");
    c = c.replace(/\/+index\.php$/, "");
    while (c.length > 0 && c.charAt(c.length - 1) === "/") c = c.substring(0, c.length - 1);
    if (c.indexOf("http://") !== 0 && c.indexOf("https://") !== 0) c = "http://" + c;
    return c;
}

function parseUrlParams(content) {
    var results = [];
    var cleaned = content.replace(/&amp;/g, "&");
    URL_PARAM_REGEX.lastIndex = 0;
    var m;
    while ((m = URL_PARAM_REGEX.exec(cleaned)) !== null) {
        try {
            var user = cleanCred(m[2]);
            var pass = cleanCred(m[3]);
            if (user.length < 3 || pass.length < 3) continue;
            if (user.indexOf("http") !== -1 || pass.indexOf("http") !== -1) continue;
            var baseUrl = parseBaseUrl(m[1]);
            if (!baseUrl) continue;
            results.push({ type: "xtream", url: baseUrl, username: user, password: pass, macAddress: null, expiryDate: null, maxConnections: null });
        } catch (e) {
            // malformed match - skip it
        }
    }
    return results;
}

function parseLabelBased(content) {
    var results = [];
    LABEL_REGEX.lastIndex = 0;
    var m;
    while ((m = LABEL_REGEX.exec(content)) !== null) {
        try {
            var rawUrl = cleanPortalUrl(m[1]);
            var user = cleanCred(m[2]);
            var pass = cleanCred(m[3]);
            if (user.length >= 3 && pass.length >= 3 && user.indexOf("http") === -1 && pass.indexOf("http") === -1) {
                results.push({ type: "xtream", url: rawUrl, username: user, password: pass, macAddress: null, expiryDate: null, maxConnections: null });
            }
        } catch (e) {
            // malformed match - skip it
        }
        if (m[0].length === 0) LABEL_REGEX.lastIndex++;
    }
    return results;
}

function parseStalker(content) {
    var matches = [];
    STALKER_REGEX.lastIndex = 0;
    var m;
    while ((m = STALKER_REGEX.exec(content)) !== null) {
        matches.push({ index: m.index, end: m.index + m[0].length, portalUrl: m[1] });
        if (m[0].length === 0) STALKER_REGEX.lastIndex++;
    }
    var results = [];
    for (var i = 0; i < matches.length; i++) {
        var portalUrl = matches[i].portalUrl.replace(/\/+$/, "");
        if (portalUrl.indexOf("/c") === -1 && portalUrl.indexOf("/stalker_portal") === -1) continue;
        var searchEnd = i + 1 < matches.length ? matches[i + 1].index : content.length;
        var afterPortal = content.substring(matches[i].end, searchEnd);
        var macM = MAC_REGEX.exec(afterPortal);
        var expiryM = EXPIRY_REGEX.exec(afterPortal);
        var maxM = MAX_ONLINE_REGEX.exec(afterPortal);
        results.push({
            type: "stalker",
            url: portalUrl,
            username: null,
            password: null,
            macAddress: macM ? macM[1].toUpperCase() : null,
            expiryDate: expiryM ? expiryM[1].trim() : null,
            maxConnections: maxM ? parseInt(maxM[1], 10) : null,
        });
    }
    return results;
}

function parseStructuredLines(content) {
    var results = [];
    var blocks = content.split(/={10,}|(?=HIT \d+)|(?=\n\n)/);
    for (var b = 0; b < blocks.length; b++) {
        var block = blocks[b];
        try {
            var hostPortM = /(?:DOMAIN|Host|IP|🌐Host|🌍)\s*:?\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(:\d+)?)/i.exec(block);
            if (!hostPortM) continue;
            var hostPortStr = hostPortM[1];
            var colonIdx = hostPortStr.indexOf(":");
            var hostPart = colonIdx !== -1 ? hostPortStr.substring(0, colonIdx) : hostPortStr;
            var port = colonIdx !== -1 ? hostPortStr.substring(colonIdx + 1) : "80";
            var fullHost = port === "80" ? hostPart : hostPart + ":" + port;

            var userM = /(?:User(?:name)?|👤User)\s*:?\s*(\S+)/i.exec(block);
            if (!userM) continue;
            var user = userM[1].trim();
            if (user.length < 3) continue;

            var passM = /(?:Password|Pass|🔑Password)\s*:?\s*(\S+)/i.exec(block);
            if (!passM) continue;
            var pass = passM[1].trim();
            if (pass.length < 3) continue;

            results.push({ type: "xtream", url: "http://" + fullHost, username: user, password: pass, macAddress: null, expiryDate: null, maxConnections: null });
        } catch (e) {
            // malformed block - skip it
        }
    }
    return results;
}

function credentialKey(c) {
    return c.type + ":" + c.url + ":" + c.username + ":" + c.macAddress;
}

function parseCredentials(content) {
    var all = [].concat(parseUrlParams(content), parseLabelBased(content), parseStalker(content), parseStructuredLines(content));
    var seen = {};
    var unique = [];
    for (var i = 0; i < all.length; i++) {
        var key = credentialKey(all[i]);
        if (!seen[key]) {
            seen[key] = true;
            unique.push(all[i]);
        }
    }
    return unique;
}

// ── Credential testing ──

function buildM3uUrl(cred) {
    if (cred.username && cred.password) {
        return cred.url + "/get.php?username=" + cred.username + "&password=" + cred.password + "&type=m3u_plus&output=m3u8";
    }
    return cred.url;
}

function testXtreamM3u(cred) {
    try {
        var testUrl = buildM3uUrl(cred);
        var resp = host.httpGet(testUrl, {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "*/*",
            "Connection": "close",
            "Range": "bytes=0-8191",
        });
        var head = (resp.body || "").substring(0, 8192);
        var ok = resp.status >= 200 && resp.status < 300;
        var isM3u = head.indexOf("#EXTM3U") === 0 || head.indexOf("#EXTINF") === 0 || head.indexOf("#KODIPROP") !== -1;
        var online = ok && (isM3u || head.length > 100);
        host.log("reddit: testXtreamM3u status=" + resp.status + " len=" + head.length + " isM3u=" + isM3u + " online=" + online + " url=" + testUrl.substring(0, 100));
        return {
            credential: cred,
            online: online,
            responseCode: resp.status,
            error: ok && !isM3u && head.length < 100 ? "Not a valid M3U response" : null,
        };
    } catch (e) {
        host.log("reddit: testXtreamM3u threw: " + (e.message || e) + " url=" + (cred.url || "").substring(0, 60));
        return { credential: cred, online: false, responseCode: 0, error: e.message };
    }
}

function testStalker(cred) {
    try {
        var resp = host.httpGet(cred.url.replace(/\/+$/, ""), {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept": "*/*",
            "Range": "bytes=0-8191",
        });
        var head = (resp.body || "").substring(0, 8192);
        var ok = resp.status >= 200 && resp.status < 300;
        var valid = ok && head.length > 50;
        host.log("reddit: testStalker status=" + resp.status + " len=" + head.length + " valid=" + valid + " url=" + cred.url);
        return { credential: cred, online: valid, responseCode: resp.status, error: valid ? null : "Portal not responding" };
    } catch (e) {
        host.log("reddit: testStalker threw: " + (e.message || e) + " url=" + cred.url);
        return { credential: cred, online: false, responseCode: 0, error: e.message };
    }
}

function testCredential(cred) {
    if (cred.type === "m3u" || cred.type === "xtream") return testXtreamM3u(cred);
    if (cred.type === "stalker") return testStalker(cred);
    return { credential: cred, online: false, responseCode: 0, error: "Unknown type: " + cred.type };
}

function domainOf(url) {
    return url.replace(/^https?:\/\//, "").split("/")[0].trim();
}

function toCandidate(result) {
    var cred = result.credential;
    var typeLabel = cred.type === "xtream" ? "Xtream" : cred.type === "stalker" ? "Stalker" : "M3U";
    var detailParts = [typeLabel];
    if (cred.expiryDate) detailParts.push("expires " + cred.expiryDate);
    if (cred.maxConnections) detailParts.push(cred.maxConnections + " connections");
    if (result.responseCode) detailParts.push("HTTP " + result.responseCode);
    return {
        type: cred.type,
        label: "Reddit - " + domainOf(cred.url),
        url: cred.url,
        username: cred.username,
        password: cred.password,
        userAgent: cred.macAddress, // Stalker's MAC rides in the same slot the host reads a Stalker MAC / M3U UA from.
        detail: detailParts.join(" · "),
        verified: true,
    };
}

// ── provider_discovery entry point ──

function discover(host) {
    host.reportProgress("Scanning Reddit for paste links…");
    var scan;
    try {
        scan = redditScan();
        host.log("redditscan: posts=" + scan.posts.length + " urls=" + scan.pasteUrls.length);
    } catch (e) {
        host.log("redditscan: scan threw: " + (e.message || e));
        return "Reddit scan failed";
    }
    if (scan.pasteUrls.length === 0) return "No paste links found";
    host.reportProgress("Found " + scan.posts.length + " posts, " + scan.pasteUrls.length + " paste links");

    // Log paste URL breakdown by domain
    var domainCounts = {};
    for (var i = 0; i < scan.pasteUrls.length; i++) {
        var d = domainOf(scan.pasteUrls[i]);
        domainCounts[d] = (domainCounts[d] || 0) + 1;
    }
    var domainSummary = "";
    for (var d in domainCounts) domainSummary += d + "=" + domainCounts[d] + " ";
    host.log("reddit: pasteDomains " + domainSummary);

    var contents = [];
    for (var i = 0; i < scan.pasteUrls.length; i++) {
        var url = scan.pasteUrls[i];
        host.reportProgress("Fetching paste " + (i + 1) + "/" + scan.pasteUrls.length + "…");
        var content = null;
        try {
            content = url.indexOf("paste.sh/") !== -1 && url.indexOf("#") !== -1 ? pasteShDecrypt(url) : fetchPaste(url);
        } catch (e) {
            // this paste failed to fetch/decrypt - keep going with the rest
        }
        if (content) contents.push(content);
    }

    host.reportProgress("Parsing credentials…");
    var parsed = [];
    var pasteCreds = 0;
    for (var i = 0; i < contents.length; i++) {
        var c = parseCredentials(contents[i]);
        parsed = parsed.concat(c);
        pasteCreds += c.length;
    }
    var postCreds = 0;
    for (var i = 0; i < scan.posts.length; i++) {
        var c = parseCredentials(scan.posts[i].title + " " + scan.posts[i].selftext);
        parsed = parsed.concat(c);
        postCreds += c.length;
    }
    host.log("reddit: parsed pasteCount=" + contents.length + " pasteCreds=" + pasteCreds + " postCreds=" + postCreds + " total=" + parsed.length);

    var seen = {};
    var unique = [];
    for (var i = 0; i < parsed.length; i++) {
        var key = credentialKey(parsed[i]);
        if (!seen[key]) {
            seen[key] = true;
            unique.push(parsed[i]);
        }
    }
    host.log("reddit: deduped from " + parsed.length + " to " + unique.length + " unique credentials");
    if (unique.length === 0) return "No credentials found in pastes";
    host.reportProgress("Testing " + unique.length + " credential(s)…");

    var workingCount = 0;
    var seenDomains = {};
    var testedCount = 0;
    var remaining = unique.slice();
    while (remaining.length > 0 && workingCount < TARGET_WORKING) {
        remaining = remaining.filter(function (c) { return !seenDomains[domainOf(c.url)]; });
        if (remaining.length === 0) break;
        var batch = remaining.splice(0, 20);
        for (var i = 0; i < batch.length; i++) {
            testedCount++;
            var cred = batch[i];
            var result = testCredential(cred);
            host.log("reddit: test[" + testedCount + "] type=" + cred.type + " url=" + domainOf(cred.url) + " user=" + (cred.username || "").substring(0, 12) + " online=" + result.online + " code=" + result.responseCode);
            if (!result.online) continue;
            var domain = domainOf(result.credential.url);
            if (seenDomains[domain]) {
                host.log("reddit: test[" + testedCount + "] duplicate domain=" + domain + " - skipping");
                continue;
            }
            seenDomains[domain] = true;
            host.reportCandidate(toCandidate(result));
            workingCount++;
            host.log("reddit: test[" + testedCount + "] ACCEPTED working=" + workingCount + " domain=" + domain);
            host.reportProgress("Found " + workingCount + " working provider(s)…");
            if (workingCount >= TARGET_WORKING) break;
        }
    }
    host.log("reddit: tested=" + testedCount + " working=" + workingCount + " seenDomains=" + Object.keys(seenDomains).length);

    return workingCount === 0 ? "Tested " + unique.length + ", none responded" : "Found " + workingCount + " working provider(s)";
}
