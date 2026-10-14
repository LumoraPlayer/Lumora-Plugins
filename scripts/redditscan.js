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
var MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
// The /new listing is newest-first; pages are chained via its `after` cursor only until a
// non-stickied post outside the 14-day window shows up. MAX_PAGES is the hard ceiling for a
// subreddit busy enough that the window alone wouldn't stop the walk (100 posts per page).
var MAX_PAGES = 10;
// Testing every login of every domain is thousands of requests and hours of wall time (a scan
// regularly parses ~10k credentials across ~60 domains), so the probe loop is deliberately
// bounded: at most MAX_ROUNDS logins per domain, and each probe gets PROBE_TIMEOUT_MS via the
// host's per-request timeoutMs instead of the client's 30s connect / 60s read defaults. A dead
// host must not hold the whole run open - the app kills discovery at 5 minutes.
var MAX_ROUNDS = 5;
var PROBE_TIMEOUT_MS = 15000;
// How many channel URLs one candidate may probe before it is written off as non-streaming. One
// dead row - or a dead CDN behind the first row - says nothing about the rest of the panel.
var MAX_STREAM_PROBES = 3;
// Every request in the scan and paste phases carries a per-request deadline (the host's
// timeoutMs): the shared client's 30s connect / 60s read defaults are far too long when a run
// makes hundreds of calls - a couple of stalled responses used to burn minutes of the app's
// 5-minute discovery budget on their own.
var REDDIT_TIMEOUT_MS = 12000;
var PASTE_TIMEOUT_MS = 15000;
// host.httpGetAll fans out at most 8 requests at once; comment trees and paste bodies are
// hundreds of KB each, so chunks stay one pool-wave deep to bound a batch's aggregate memory.
var BATCH_SIZE = 8;
// Request-count bounds for the scan phase. The /new walk is newest-first and the freshest posts
// carry the credentials most likely to still work, and testing only ever tries MAX_ROUNDS logins
// per domain - nothing is gained from comment-fetching (or paste-fetching) a thousand posts,
// while every request saved is time back. Count matters as much as latency here: reddit's OAuth
// budget is ~100 requests/minute per client ID, so the phase is request-bound near that ceiling.
var MAX_COMMENT_FETCHES = 150;
var MAX_PASTE_URLS = 60;
// A post whose selftext already yielded paste links had them harvested without a request; the
// comment tree under it is usually reactions, so its fetch is skipped. Flip to false for
// completeness over speed.
var SKIP_COMMENTS_WHEN_SELFTEXT_HAS_PASTES = true;
// Comment fetching is abandoned after this many 429s - reddit is rate-limiting the client, and
// continuing would only spend budget on responses that carry nothing.
var MAX_COMMENT_429 = 10;
// Wall-clock caps for the scan and paste phases, leaving at least half of the 5-minute discovery
// budget for the provider testing that actually produces candidates. Checked between network
// batches, never mid-request; whatever was collected when a cap is hit is still used.
var SCAN_BUDGET_MS = 90000;
var PASTE_BUDGET_MS = 60000;

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
            }, REDDIT_TIMEOUT_MS);
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

/** A reddit API GET, bounded by REDDIT_TIMEOUT_MS - a stalled listing or comment response must
 *  not hold a scan open for the client's 60s read timeout. */
function fetchOAuth(url, token) {
    try {
        var resp = host.httpGet(url, {
            "User-Agent": OAUTH_UA,
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
        }, REDDIT_TIMEOUT_MS);
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

/** Harvests paste URLs out of [text] into [urlSet]. Returns how many matches were seen (not how
 *  many were new) - discover() uses the count to tell whether a post's own selftext already
 *  carried paste links, so its comment tree can be skipped. */
function findPasteUrls(text, urlSet) {
    var m;
    var found = 0;
    PASTE_URL_REGEX.lastIndex = 0;
    while ((m = PASTE_URL_REGEX.exec(text)) !== null) {
        urlSet[m[0]] = true;
        found++;
    }
    BASE64_URL_REGEX.lastIndex = 0;
    while ((m = BASE64_URL_REGEX.exec(text)) !== null) {
        try {
            var decoded = host.base64Decode(m[0]);
            for (var i = 0; i < PASTE_DOMAINS.length; i++) {
                if (decoded.indexOf(PASTE_DOMAINS[i]) !== -1) {
                    urlSet[decoded] = true;
                    found++;
                    break;
                }
            }
        } catch (e) {
            // not valid base64 / not utf-8 - skip
        }
    }
    return found;
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

/** Parses one already-fetched comment-tree response and harvests paste links from it. A parse
 *  failure loses only this post's comments - the post itself was already scanned. */
function scrapeCommentTree(jsonStr, urlSet) {
    try {
        var cArray = JSON.parse(jsonStr);
        if (Array.isArray(cArray) && cArray.length > 1) {
            var cChildren = cArray[1] && cArray[1].data && cArray[1].data.children;
            if (cChildren) scrapeComments(cChildren, urlSet);
        }
    } catch (e) {
        // comment tree parse failed - the post itself was already scanned
    }
}

/** Walks the subreddit's /new listing (newest-first, `after`-chained) and harvests paste links
 *  from post selftexts and comment trees.
 *
 *  Comment trees are fetched in BATCH_SIZE batches via host.httpGetAll instead of one blocking
 *  GET per post - the old serial loop was the scan's dominant cost - and every request carries
 *  REDDIT_TIMEOUT_MS so a stalled tree costs 12s, not the client's 60s read timeout.
 *
 *  Three bounds keep the phase inside `deadline` (the app kills discovery at 5 minutes):
 *  MAX_COMMENT_FETCHES fetches overall (newest first - fresh posts carry pastes that still
 *  work), SKIP_COMMENTS_WHEN_SELFTEXT_HAS_PASTES (one request not spent on reactions per
 *  paste-bearing post), and MAX_COMMENT_429 (reddit rate-limiting the client means the rest
 *  would come back empty too). */
function fetchPostsOAuth(token, posts, urlSet, deadline) {
    var baseUrl = "https://oauth.reddit.com/r/" + SUBREDDIT + "/new?limit=100&sort=new&raw_json=1";
    var pageUrl = baseUrl;
    var now = Date.now();
    var kept = 0, ignored = 0, pages = 0, stoppedAtEdge = false;
    var commentsIssued = 0, commentBatches = 0, comment429 = 0, commentsOff = false, budgetHit = false;
    while (pageUrl && pages < MAX_PAGES) {
        if (Date.now() >= deadline) { budgetHit = true; break; }
        pages++;
        var jsonStr = fetchOAuth(pageUrl, token);
        if (!jsonStr) {
            host.log("reddit: fetchPostsOAuth - no response body (page " + pages + ")");
            break;
        }
        var root = JSON.parse(jsonStr);
        var listing = root && root.data;
        var children = listing && listing.children;
        if (!children) {
            host.log("reddit: fetchPostsOAuth - no children in response, keys=" + Object.keys(root || {}).join(","));
            break;
        }
        host.log("reddit: fetchPostsOAuth page " + pages + " - " + children.length + " children");

        var commentPermalinks = [];
        for (var i = 0; i < children.length; i++) {
            var postData = children[i] && children[i].data;
            if (!postData) continue;
            var created = (postData.created_utc || 0) * 1000;
            if (!created) continue;
            if (now - created > MAX_AGE_MS) {
                // Newest-first, so the first post outside the window means the ones after it are
                // too - don't fetch another page. Stickies are pinned regardless of age, so they
                // don't count as the edge.
                ignored++;
                if (!postData.stickied) stoppedAtEdge = true;
                continue;
            }

            var id = postData.id || "";
            var permalink = postData.permalink || "";
            if (!id || !permalink) continue;
            var title = postData.title || "";
            var selftext = postData.selftext || "";
            var fullPermalink = "https://www.reddit.com" + permalink;
            posts.push({ id: id, title: title, selftext: selftext, permalink: fullPermalink });
            kept++;

            var selftextPastes = findPasteUrls(title + " " + selftext, urlSet);

            if (!commentsOff && !(SKIP_COMMENTS_WHEN_SELFTEXT_HAS_PASTES && selftextPastes > 0)) {
                commentPermalinks.push(permalink);
            }
        }

        // Comments must be fetched through oauth.reddit.com, not www.reddit.com - the OAuth
        // bearer token is only accepted on the API host, so this 403s on every single post
        // otherwise (verified against real device logs: every comment fetch failed, silently,
        // while everything else in the run succeeded). Batched here: one httpGetAll pays roughly
        // one request's latency for BATCH_SIZE posts instead of one latency per post.
        for (var s = 0; s < commentPermalinks.length; s += BATCH_SIZE) {
            if (commentsOff) break;
            if (Date.now() >= deadline) { budgetHit = true; break; }
            var count = Math.min(BATCH_SIZE, commentPermalinks.length - s, MAX_COMMENT_FETCHES - commentsIssued);
            if (count <= 0) { commentsOff = true; break; }
            var reqs = [];
            for (var t = 0; t < count; t++) {
                reqs.push({
                    url: "https://oauth.reddit.com" + commentPermalinks[s + t] + ".json?raw_json=1",
                    headers: { "User-Agent": OAUTH_UA, "Authorization": "Bearer " + token, "Accept": "application/json" },
                    timeoutMs: REDDIT_TIMEOUT_MS,
                });
            }
            commentsIssued += count;
            commentBatches++;
            var responses = host.httpGetAll(reqs);
            var ok = 0, fail = 0;
            for (var r = 0; r < responses.length; r++) {
                var resp = responses[r] || { status: 0, body: "" };
                if (resp.status >= 200 && resp.status < 300) {
                    ok++;
                    scrapeCommentTree(resp.body, urlSet);
                } else {
                    fail++;
                    if (resp.status === 429) comment429++;
                }
            }
            if (fail > 0) {
                host.log("reddit: comment batch " + commentBatches + " - ok=" + ok + " fail=" + fail + " (429s so far: " + comment429 + ")");
            }
            if (comment429 >= MAX_COMMENT_429) {
                commentsOff = true;
                host.log("reddit: comment fetching abandoned - " + comment429 + " throttled (429) responses");
            }
        }
        if (stoppedAtEdge || budgetHit) break;
        pageUrl = listing.after ? baseUrl + "&after=" + encodeURIComponent(listing.after) : null;
    }
    host.log("reddit: fetchPostsOAuth - pages=" + pages + " kept=" + kept + " ignored=" + ignored
        + " comments=" + commentsIssued + " batches=" + commentBatches + " throttled=" + comment429
        + (stoppedAtEdge ? " (stopped at window edge)" : "")
        + (budgetHit ? " (scan budget reached)" : "")
        + (commentsOff ? " (comments off)" : "")
        + " urlsSoFar=" + Object.keys(urlSet).length);
}

function redditScan() {
    var posts = [];
    var urlSet = {};
    try {
        // Measured from before the token fetch: the whole scan phase (OAuth, listings, comment
        // batches) shares one wall-clock budget so the provider testing always gets the rest.
        var deadline = Date.now() + SCAN_BUDGET_MS;
        var token = getOAuthToken();
        if (token) fetchPostsOAuth(token, posts, urlSet, deadline);
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

/** The fetch half of a paste.sh paste: the .txt URL plus what the decrypt half needs, or null
 *  when the URL carries no key. Split from decryption so the fetch can ride discover()'s batched
 *  pass - the old one-blocking-GET-per-paste loop was one of the scan's two serial bottlenecks. */
function pasteShPlan(pasteUrl) {
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
    return { url: baseUrl + ".txt", clientKey: clientKey, pasteId: pasteId };
}

/** The decrypt half of a paste.sh paste; [body] is what [pasteShPlan]'s URL returned. Log lines
 *  keep the "pasteShDecrypt" prefix so existing device logs stay greppable. */
function pasteShDecryptBody(plan, body) {
    var pasteId = plan.pasteId;
    var clientKey = plan.clientKey;
    try {
        var lines = body.split("\n");
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
                if (!decrypted) {
                    host.log("reddit: pasteShDecrypt v3 decrypt returned null for " + pasteId);
                    return null;
                }
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
                if (!decrypted) throw new Error("aesCbcDecrypt returned null");
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
        host.log("reddit: pasteShDecrypt threw: " + (e.message || e) + " for " + pasteId);
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

/** Where a paste URL's raw text actually lives - pastebin/rentry need their raw path, pastes.dev
 *  its API host. The fetch itself happens in discover()'s batched pass, not here. */
function resolvePasteFetchUrl(url) {
    if (url.indexOf("pastebin.com/") !== -1 && url.indexOf("/raw") === -1) {
        return "https://pastebin.com/raw/" + pasteId(url);
    }
    if (url.indexOf("rentry.co/") !== -1 && url.indexOf("/raw") === -1) {
        return "https://rentry.co/" + pasteId(url) + "/raw";
    }
    if (url.indexOf("pastes.dev/") !== -1) {
        return "https://api.pastes.dev/" + pasteId(url);
    }
    return url;
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

var M3U_RANGE = "bytes=0-5242879"; // big enough to reach Sky Sports rows in an m3u_plus

// The request a credential's live test needs, as { url, headers, timeoutMs } for host.httpGetAll.
// Splitting "build the request" from "evaluate the response" is what lets the discover loop fire a
// whole batch of provider tests concurrently instead of one blocking GET at a time. The short
// timeoutMs is what keeps a round full of dead hosts from taking minutes.
function buildTestRequest(cred) {
    if (cred.type === "stalker") {
        return {
            url: cred.url.replace(/\/+$/, ""),
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "*/*", "Range": "bytes=0-8191" },
            timeoutMs: PROBE_TIMEOUT_MS,
        };
    }
    return {
        url: buildM3uUrl(cred),
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "*/*",
            "Connection": "close",
            "Range": M3U_RANGE,
        },
        timeoutMs: PROBE_TIMEOUT_MS,
    };
}

// Evaluate a pre-fetched response (from host.httpGetAll) for a credential.
function evalResponse(cred, resp) {
    resp = resp || { status: 0, body: "" };
    var body = resp.body || "";
    var ok = resp.status >= 200 && resp.status < 300;
    if (cred.type === "stalker") {
        var valid = ok && body.length > 50;
        // Stalker portals aren't M3U, so the Sky content check doesn't apply - reachable = accepted.
        return { credential: cred, online: valid, reachable: valid, hasSky: true, responseCode: resp.status, error: valid ? null : "Portal not responding" };
    }
    var isM3u = body.indexOf("#EXTM3U") === 0 || body.indexOf("#EXTINF") === 0 || body.indexOf("#KODIPROP") !== -1;
    // reachable = credentials work and the server returned a real playlist, whether or not it
    // carries the required content. hasSky is the separate content requirement.
    var reachable = ok && (isM3u || body.length > 100);
    var hasSky = /sky\s*sports/i.test(body);
    var error = null;
    if (ok && !isM3u && body.length < 100) error = "Not a valid M3U response";
    else if (reachable && !hasSky) error = "No Sky Sports channels";
    return {
        credential: cred,
        online: reachable && hasSky,
        reachable: reachable,
        hasSky: hasSky,
        responseCode: resp.status,
        error: error,
    };
}

// ── Live stream confirmation ──
//
// A playlist that lists Sky Sports is not the same as a panel that serves it: credentials can
// be expired mid-playlist (the endpoint answers, the streams 401), the connection limit can be
// reached, or the channel rows can point at a dead CDN. The old evaluator accepted any of those.
// These helpers pull up to MAX_STREAM_PROBES real channel URLs out of the already-fetched
// playlist and send one small Range request at each, so "accepted" means bytes for a live
// channel actually arrived - and a provider is only rejected once every probed channel failed.

/** Up to `max` live channel URLs from a fetched m3u_plus body, Sky Sports rows first (then the
 *  rest in playlist order, deduplicated) so a dead Sky row can fall back to another channel.
 *  Only absolute http(s) (and //host) URLs - a relative path can't be probed without resolving
 *  it against the panel. */
function findLiveStreamUrls(body, max) {
    var lines = body.split(/\r?\n/);
    var sky = [], other = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf("#EXTINF") !== 0) continue;
        var next = (lines[i + 1] || "").trim();
        if (!next || next.charAt(0) === "#") continue;
        if (next.indexOf("//") === 0) next = "http:" + next;
        if (next.indexOf("http://") !== 0 && next.indexOf("https://") !== 0) continue;
        if (/sky\s*sports/i.test(line)) {
            if (sky.length < max && sky.indexOf(next) === -1) sky.push(next);
        } else {
            if (other.length < max && other.indexOf(next) === -1) other.push(next);
        }
    }
    return sky.concat(other).slice(0, max);
}

/** The follow-up request that proves the candidate actually serves the channel it advertises. */
function buildStreamProbeRequest(url) {
    return {
        url: url,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "*/*",
            "Connection": "close",
            // One segment's worth is plenty - the point is that bytes for this channel arrive.
            "Range": "bytes=0-131071",
        },
        timeoutMs: PROBE_TIMEOUT_MS,
    };
}

/** A 2xx with either an HLS manifest (panel resolves the channel) or bytes (direct .ts feed). */
function evalStreamProbe(resp) {
    resp = resp || { status: 0, body: "" };
    var ok = resp.status >= 200 && resp.status < 300;
    var body = resp.body || "";
    return ok && (body.indexOf("#EXTM3U") === 0 || body.length > 0);
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
    // Says the acceptance test went past the playlist and pulled bytes from a real live channel.
    if (result.streamChecked) detailParts.push("live channel OK");
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

    // Fetch paste bodies in BATCH_SIZE batches (host.httpGetAll) - the old one-blocking-GET-per-
    // paste loop was the scan's other serial bottleneck, and every request carries
    // PASTE_TIMEOUT_MS so a dead paste host costs 15s, not the client's 60s read timeout. The
    // paste.sh decrypt half (pasteShDecryptBody) reuses the body fetched here. Fetch order is the
    // scan's own (newest posts first), so the MAX_PASTE_URLS cap keeps the freshest pastes; the
    // rest are never fetched. The whole phase shares PASTE_BUDGET_MS.
    var jobs = [];
    for (var i = 0; i < scan.pasteUrls.length; i++) {
        if (jobs.length >= MAX_PASTE_URLS) break;
        var url = scan.pasteUrls[i];
        if (url.indexOf("paste.sh/") !== -1 && url.indexOf("#") !== -1) {
            var plan = pasteShPlan(url);
            if (plan) jobs.push({ plan: plan, fetchUrl: plan.url, source: url });
        } else {
            jobs.push({ plan: null, fetchUrl: resolvePasteFetchUrl(url), source: url });
        }
    }
    if (scan.pasteUrls.length > jobs.length) {
        host.log("reddit: paste cap - skipping " + (scan.pasteUrls.length - jobs.length) + " paste(s) past " + MAX_PASTE_URLS);
    }

    var contents = [];
    var pasteDeadline = Date.now() + PASTE_BUDGET_MS;
    for (var s = 0; s < jobs.length; s += BATCH_SIZE) {
        if (Date.now() >= pasteDeadline) {
            host.log("reddit: paste budget reached - fetched " + s + "/" + jobs.length + ", moving on");
            break;
        }
        var count = Math.min(BATCH_SIZE, jobs.length - s);
        host.reportProgress("Fetching pastes " + (s + 1) + "-" + (s + count) + "/" + jobs.length + "…");
        var reqs = [];
        for (var t = 0; t < count; t++) {
            reqs.push({
                url: jobs[s + t].fetchUrl,
                headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/plain,text/html,*/*" },
                timeoutMs: PASTE_TIMEOUT_MS,
            });
        }
        var responses = host.httpGetAll(reqs);
        var ok = 0, fail = 0;
        for (var r = 0; r < count; r++) {
            var resp = responses[r] || { status: 0, body: "" };
            if (resp.status < 200 || resp.status >= 300) {
                fail++;
                host.log("reddit: paste fetch status=" + resp.status + " url=" + jobs[s + r].fetchUrl.substring(0, 80));
                continue;
            }
            ok++;
            var content = jobs[s + r].plan ? pasteShDecryptBody(jobs[s + r].plan, resp.body) : resp.body;
            if (content) contents.push(content);
        }
        if (fail > 0) host.log("reddit: paste batch ok=" + ok + " fail=" + fail);
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

    // Test providers in parallel, in rounds. Each domain keeps its own ordered list of logins.
    // A round takes the next untried login from every still-unresolved domain and fires them all
    // at once via host.httpGetAll (the host fans the network I/O across a thread pool), so a scan
    // pays roughly one request's latency per round instead of per provider. A domain is settled
    // the moment one of its logins reaches the server: accepted if the playlist has Sky Sports
    // AND one of up to MAX_STREAM_PROBES live channel URLs pulled from that playlist streams
    // (a second probe batch per round), else skipped. Only a dead login leaves the domain open
    // for its next login in the following round - one bad credential shouldn't write off a whole
    // provider.
    //
    // Bounded at MAX_ROUNDS (see its comment): a domain with a hundred pasted logins would
    // otherwise keep the loop running for hours, and the app aborts discovery at 5 minutes. What
    // was found by then is reported; stoppedEarly changes the final message to say it stopped.
    var byDomain = {};
    var domainOrder = [];
    for (var i = 0; i < unique.length; i++) {
        var d0 = domainOf(unique[i].url);
        if (!byDomain[d0]) { byDomain[d0] = []; domainOrder.push(d0); }
        byDomain[d0].push(unique[i]);
    }
    var resolvedDomains = {}; // domain -> "accepted" | "nosky"
    var cursor = {};          // domain -> index of its next untried login
    var workingCount = 0, noSkyCount = 0, skyFailCount = 0, deadCount = 0, testedCount = 0, round = 0, stoppedEarly = false;
    host.reportProgress("Testing " + domainOrder.length + " domain(s)…");

    function hasPendingWork() {
        for (var i = 0; i < domainOrder.length; i++) {
            var d = domainOrder[i];
            if (!resolvedDomains[d] && (cursor[d] || 0) < byDomain[d].length) return true;
        }
        return false;
    }

    while (hasPendingWork()) {
        if (round >= MAX_ROUNDS) {
            stoppedEarly = true;
            break;
        }
        // Assemble this round: one next-untried login per unresolved domain.
        var roundDomains = [], roundCreds = [], roundReqs = [];
        for (var i = 0; i < domainOrder.length; i++) {
            var d = domainOrder[i];
            if (resolvedDomains[d]) continue;
            var idx = cursor[d] || 0;
            if (idx >= byDomain[d].length) continue; // exhausted, stays unresolved (dead)
            cursor[d] = idx + 1;
            var cred = byDomain[d][idx];
            roundDomains.push(d); roundCreds.push(cred); roundReqs.push(buildTestRequest(cred));
        }
        if (roundReqs.length === 0) break;
        round++;
        host.reportProgress("Round " + round + "/" + MAX_ROUNDS + ": testing " + roundReqs.length + " domain(s) in parallel…");
        var responses = host.httpGetAll(roundReqs);

        // First pass: content checks. Anything that passes gets up to MAX_STREAM_PROBES follow-up
        // probes - small Range requests at real channel URLs from its playlist - and is accepted
        // if ANY of them streams: a playlist that lists Sky Sports can serve nothing, but one
        // dead channel row (or the CDN behind it) says nothing about the rest of the panel.
        var results = [];
        var probeReqs = [], probeOwner = [], probeUrls = [];
        for (var j = 0; j < roundCreds.length; j++) {
            var result = evalResponse(roundCreds[j], responses[j]);
            results.push(result);
            if (result.online && roundCreds[j].type !== "stalker") {
                // Stalker has no playlist here, so there is no channel URL to probe without a
                // full handshake - it keeps its portal-reachable acceptance.
                var streamUrls = findLiveStreamUrls((responses[j] || {}).body || "", MAX_STREAM_PROBES);
                if (streamUrls.length > 0) {
                    for (var v = 0; v < streamUrls.length; v++) {
                        probeReqs.push(buildStreamProbeRequest(streamUrls[v]));
                        probeOwner.push(j);
                        probeUrls.push(streamUrls[v]);
                    }
                } else {
                    result.online = false;
                    result.error = "No playable live channel in playlist";
                }
            }
        }
        if (probeReqs.length > 0) {
            var probeOwners = [], seenOwner = {};
            for (var o = 0; o < probeOwner.length; o++) {
                if (!seenOwner[probeOwner[o]]) { seenOwner[probeOwner[o]] = true; probeOwners.push(probeOwner[o]); }
            }
            host.reportProgress("Round " + round + "/" + MAX_ROUNDS + ": confirming " + probeOwners.length + " provider(s) (up to " + MAX_STREAM_PROBES + " live channel(s) each)…");
            var probeResponses = host.httpGetAll(probeReqs);
            var probePassed = {}, probeFirstFail = {}, probeTried = {};
            for (var p = 0; p < probeReqs.length; p++) {
                var owner = probeOwner[p];
                probeTried[owner] = (probeTried[owner] || 0) + 1;
                if (probePassed[owner]) continue; // an earlier channel for this provider already streamed
                if (evalStreamProbe(probeResponses[p])) {
                    probePassed[owner] = true;
                    results[owner].streamChecked = true;
                } else if (!probeFirstFail[owner]) {
                    probeFirstFail[owner] = { status: ((probeResponses[p] || {}).status) || 0, url: probeUrls[p] };
                }
            }
            for (var q = 0; q < probeOwners.length; q++) {
                var ownerIdx = probeOwners[q];
                if (probePassed[ownerIdx]) continue;
                var fail = probeFirstFail[ownerIdx] || { status: 0, url: "" };
                results[ownerIdx].online = false;
                results[ownerIdx].error = "Live stream probe failed (HTTP " + fail.status + ", " + (probeTried[ownerIdx] || 0) + " channel(s) tried)";
                host.log("reddit: stream probes FAILED domain=" + roundDomains[ownerIdx] + " code=" + fail.status + " tried=" + (probeTried[ownerIdx] || 0) + " firstUrl=" + (fail.url || "").substring(0, 100));
            }
        }

        for (var j = 0; j < roundCreds.length; j++) {
            var cred = roundCreds[j], domain = roundDomains[j];
            var result = results[j];
            testedCount++;
            host.log("reddit: test[" + testedCount + "] type=" + cred.type + " url=" + domain + " online=" + result.online + " reachable=" + result.reachable + " sky=" + result.hasSky + " streamChecked=" + (!!result.streamChecked) + " code=" + result.responseCode + " len=" + ((((responses[j] || {}).body) || "").length) + " error=" + (result.error || "none"));
            if (result.online) {
                host.reportCandidate(toCandidate(result));
                workingCount++;
                resolvedDomains[domain] = "accepted";
                host.reportProgress("✓ " + domain + " accepted — live channel plays (" + workingCount + " working)");
            } else if (result.reachable) {
                if (result.hasSky) skyFailCount++; else noSkyCount++;
                resolvedDomains[domain] = "nosky";
                host.reportProgress("✗ " + domain + " skipped — " + (result.error || "no Sky Sports"));
            } else {
                // Dead login - the domain was left open for its next login in the following
                // round, but never reached one by the end of the run.
                deadCount++;
            }
        }
    }
    var domainCount = Object.keys(resolvedDomains).length;
    host.log("reddit: rounds=" + round + " tested=" + testedCount + " working=" + workingCount + " noSky=" + noSkyCount + " skyFail=" + skyFailCount + " dead=" + deadCount + " resolvedDomains=" + domainCount + " stoppedEarly=" + stoppedEarly);
    var suffix = stoppedEarly ? " (stopped after " + MAX_ROUNDS + " rounds)" : "";
    return workingCount === 0
        ? "No working providers: " + testedCount + " tested — " + noSkyCount + " no Sky, " + skyFailCount + " Sky but no live stream, " + deadCount + " dead/unreachable" + suffix
        : "Found " + workingCount + " working provider(s)" + suffix;
}
