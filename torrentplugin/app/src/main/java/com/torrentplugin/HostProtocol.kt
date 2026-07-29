package com.torrentplugin

/**
 * The host app's plugin protocol, copied here by value. A plugin is a separate APK with no code
 * shared with the host, so these must match the host's PluginContract exactly. This plugin
 * declares the `stream_search` capability.
 */
object HostProtocol {

    const val ACTION_PLUGIN_SERVICE = "com.lumora.action.PLUGIN"

    const val META_PLUGIN_ID = "lumora.plugin.id"
    const val META_DESCRIPTION = "lumora.plugin.description"
    const val META_CAPABILITIES = "lumora.plugin.capabilities"

    const val CAPABILITY_STREAM_SEARCH = "stream_search"

    // Host -> plugin
    const val MSG_START_SEARCH = 3
    const val MSG_RESOLVE_STREAM = 4
    const val MSG_STOP_STREAM = 5

    // Plugin -> host
    const val MSG_PROGRESS = 10
    const val MSG_FINISHED = 12
    const val MSG_ERROR = 13
    const val MSG_RESULT = 14
    const val MSG_STREAM_READY = 15

    // Bundle keys
    const val KEY_REQUEST_ID = "request_id"
    const val KEY_MESSAGE = "message"
    const val KEY_LABEL = "label"
    const val KEY_QUERY = "query"
    const val KEY_YEAR = "year"
    const val KEY_SEASON = "season"
    const val KEY_EPISODE = "episode"
    const val KEY_MAGNET = "magnet"
    const val KEY_SEEDERS = "seeders"
    const val KEY_SIZE = "size"
    const val KEY_QUALITY = "quality"
    const val KEY_SOURCE = "source"
    const val KEY_STREAM_URL = "stream_url"
}
