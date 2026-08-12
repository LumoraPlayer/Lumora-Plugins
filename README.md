# Lumora Plugins

JS plugin scripts for [Lumora](https://github.com/disclosurez/Lumora). A plugin is a single `.js`
text file evaluated in-process by Lumora's embedded QuickJS engine — no separate app to install,
no IPC. Lumora ships the scripts in `scripts/` bundled into its own APK (`assets/plugins/`); users
can add more later from Settings → Plugins without installing anything, either one at a time
(paste text or fetch a `.js` URL) or by browsing this repo's catalog (`scripts/index.json`) as a
**plugin store** — Lumora adds it as the default store and users can add others (a fork, a
community repo, ...) the same way.

This repo used to hold three standalone companion APKs (`animeplugin`, `redditscan`,
`torrentplugin`) that Lumora talked to over a bound `Messenger` service. That protocol is gone;
see Lumora's `com.lumora.plugin.js` package for the current one.

## Store catalog

`scripts/index.json` is what makes this repo a plugin store - a small JSON file listing every
script here, resolved by Lumora's `PluginStoreManager`:

```json
{
  "name": "Lumora Plugins",
  "scripts": [
    {
      "id": "anime.senshi",
      "label": "Anime (Senshi)",
      "description": "...",
      "capabilities": ["stream_search"],
      "file": "anime-senshi.js"
    }
  ]
}
```

`file` is resolved relative to `index.json`'s own URL (the common case - a store is usually just
this file sitting next to its scripts) or can be an absolute `http(s)://` URL if a store's scripts
live elsewhere. Add an entry here whenever a script is added to `scripts/`, or a community store
can just point at a different `index.json` with its own list. Lumora refuses to install a script
whose `id` collides with one of its own bundled scripts, so pick an id that won't clash with
`anime.senshi` / `reddit.iptvscan` / `torrent.search`.

## Scripts

| File | Capability | What it does |
|------|-----------|---------------|
| `scripts/anime-senshi.js` | `stream_search` | Searches AniList for anime, resolves streams from senshi.live. |
| `scripts/redditscan.js` | `provider_discovery` | Scans r/IPTV_ZONENEW for public IPTV credential pastes and proposes working ones. |
| `scripts/scraper-sites.js` | `scraper_sites` | Data only: which of Lumora's built-in scraper sites are live, and where the repointable ones point. |
| `scripts/torrent-search.js` | `stream_search` (`resolvesNatively`) | Searches public torrent indexers (ThePirateBay, Knaben) for a title; actual torrent streaming is handled by Lumora's built-in native `com.lumora.torrent.TorrentEngine`, not this script. |

## Scraper site list

`scripts/scraper-sites.js` carries data rather than behaviour. It is the data half of Lumora's
built-in scraper engine (`com.lumora.scraper`), which is compiled into the app: the per-site
parsers, the extractors and the Cloudflare bypass all ship in the APK, because none of them can
be expressed as data.

What *can* be expressed as data is which of those sites are still up, and which domain the few
repointable ones are on — and that is the half that rots. Editing this file takes a dead site out
of rotation for everyone on the next daily refresh, with no app release.

- `enabled: false` is a kill switch. It cannot switch a site back *on* for a user who turned it
  off in Settings; their choice wins.
- `domain` only does anything on an entry that also has `domainKey` — those are the sites that
  read their host at runtime. Anywhere else it would be silently ignored, so it is left off.
- A `name` the installed app does not recognise is skipped, and a site the app has but this file
  omits stays enabled, so this file and the app can be updated independently in either order.

It declares the `scraper_sites` capability and implements `function sites(host)`, returning the
list as a JSON string - one deterministic trip across the QuickJS bridge, rather than a nested
array of objects, which is the one shape that bridge does not round-trip reliably.

Installing it is the same as any other script. Until it is installed the app uses an equivalent
list bundled in its assets, so a fresh install still skips the sites already known to be dead.

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
