# Lumora Plugins

Companion plugin apps for [Lumora](https://github.com/disclosurez/Lumora). Each plugin is a
standalone APK that Lumora discovers over a bound `Messenger` service — no shared code, and the
plugin runs in its own process. Lumora only talks to a plugin after you install and enable it in
**Settings → Plugins**.

## Plugins

| Folder | Capability | What it does |
|--------|-----------|--------------|
| `torrentplugin` | `stream_search` | Finds a playable source for a specific title on demand and serves it back to Lumora as a local HTTP URL. |
| `redditscan` | `provider_discovery` | Proposes provider configurations Lumora can add. |

## Protocol

Plugins implement the contract Lumora defines in `PluginContract` (mirrored per-plugin in each
project's `HostProtocol`):

- A plugin exports a `Service` with an intent filter for `com.lumora.action.PLUGIN` and declares
  its id / description / capabilities in the service `meta-data`.
- `provider_discovery` — fire-and-forget: Lumora sends `MSG_START_DISCOVERY`, the plugin streams
  candidates, then a terminal `MSG_FINISHED`/`MSG_ERROR`. Every candidate is validated and only
  added on explicit user confirmation.
- `stream_search` — stateful: Lumora sends `MSG_START_SEARCH`, the plugin streams results, then
  `MSG_RESOLVE_STREAM` for the chosen result returns a playable URL via `MSG_STREAM_READY`. The
  binding stays open for the life of playback; `MSG_STOP_STREAM` tears it down.

## Build

Each folder is an independent Gradle project:

```bash
cd torrentplugin && ./gradlew :app:assembleDebug
cd redditscan   && ./gradlew :app:assembleDebug
```

Create a `local.properties` with your `sdk.dir` (gitignored). Install the resulting APK on the
device, then enable the plugin inside Lumora.
