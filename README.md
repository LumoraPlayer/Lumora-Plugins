# Lumora Plugins

JS plugin scripts for [Lumora](https://github.com/disclosurez/Lumora). A plugin is a single `.js`
text file evaluated in-process by Lumora's embedded QuickJS engine — no separate app to install,
no IPC. Lumora ships the scripts in `scripts/` bundled into its own APK (`assets/plugins/`); users
can add more later from Settings → Plugins (paste text or fetch a URL) without installing anything.

This repo used to hold three standalone companion APKs (`animeplugin`, `redditscan`,
`torrentplugin`) that Lumora talked to over a bound `Messenger` service. That protocol is gone;
see Lumora's `com.lumora.plugin.js` package for the current one.

## Scripts

| File | Capability | What it does |
|------|-----------|---------------|
| `scripts/anime-senshi.js` | `stream_search` | Searches AniList for anime, resolves streams from senshi.live. |
| `scripts/redditscan.js` | `provider_discovery` | Scans r/IPTV_ZONENEW for public IPTV credential pastes and proposes working ones. |
| `scripts/torrent-search.js` | `stream_search` (`resolvesNatively`) | Searches public torrent indexers (ThePirateBay, Knaben) for a title; actual torrent streaming is handled by Lumora's built-in native `com.lumora.torrent.TorrentEngine`, not this script. |

## Protocol

A script assigns a top-level `PLUGIN` manifest object and implements the entry points its
declared capabilities need:

```js
PLUGIN = { id: "my.plugin", label: "My Plugin", description: "...", capabilities: ["provider_discovery"] };

function discover(host) {
    host.reportProgress("Scanning…");
    host.reportCandidate({ type: "m3u", label: "...", url: "https://..." });
}
```

- `provider_discovery` — implement `discover(host)`. Call `host.reportProgress(message)` and
  `host.reportCandidate({type, label, url, username, password, userAgent, detail, verified})` as
  you go; return (or throw) when done. Every candidate is validated host-side and only added to
  Lumora on an explicit user confirmation - nothing here is trusted.
- `stream_search` — implement `search(host, query, year, season, episode)` (call
  `host.reportProgress`/`host.reportResult({title, token, seeders, size, quality, source})`,
  return an optional summary string) and `resolve(host, token, season, episode)` (return a
  playable http(s) URL). Set `PLUGIN.resolvesNatively = true` and skip `resolve()` entirely if
  results need a native engine instead (see torrent-search.js) - a script can't run a persistent
  local server or hold a torrent session open the way a companion process used to.

`host` also exposes `httpGet`/`httpPost` (synchronous; network failures come back as
`{status: 0, body: ""}`, not a throw - see Lumora's `JsPluginContract.kt`), JSON via the normal
`JSON.parse`/`stringify`, crypto primitives (`aesCbcDecrypt`, `hmacSha512`, `md5Bytes`, base64),
and Jsoup-backed HTML selectors (`selectAll`, `selectText`, `selectAttr`, ...) for scraping.

## Testing

These scripts are exercised by JVM tests in Lumora itself
(`app/src/test/java/com/lumora/plugin/js/*ScriptTest.kt`), which read the bundled copy from
`app/src/main/assets/plugins/` and run it against mocked HTTP fixtures. Keep the copy in this
repo's `scripts/` and Lumora's `assets/plugins/` in sync when editing.
