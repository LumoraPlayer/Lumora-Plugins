package com.redditscan.plugin

/**
 * The host app's plugin protocol, copied here verbatim.
 *
 * A plugin is a separate APK with no code shared with the host, so these constants are
 * duplicated rather than imported - they are the wire format, and both sides must agree on
 * them by value. Keep them in lockstep with the host's PluginContract.
 */
object HostProtocol {

    const val ACTION_PLUGIN_SERVICE = "com.lumora.action.PLUGIN"

    const val META_PLUGIN_ID = "lumora.plugin.id"
    const val META_DESCRIPTION = "lumora.plugin.description"
    const val META_CAPABILITIES = "lumora.plugin.capabilities"

    const val CAPABILITY_PROVIDER_DISCOVERY = "provider_discovery"

    // Host -> plugin
    const val MSG_START_DISCOVERY = 1
    const val MSG_CANCEL = 2

    // Plugin -> host
    const val MSG_PROGRESS = 10
    const val MSG_CANDIDATE = 11
    const val MSG_FINISHED = 12
    const val MSG_ERROR = 13

    // Bundle keys
    const val KEY_REQUEST_ID = "request_id"
    const val KEY_MESSAGE = "message"
    const val KEY_TYPE = "provider_type"
    const val KEY_LABEL = "label"
    const val KEY_URL = "url"
    const val KEY_USERNAME = "username"
    const val KEY_PASSWORD = "password"
    const val KEY_USER_AGENT = "user_agent"
    const val KEY_DETAIL = "detail"
    const val KEY_VERIFIED = "verified"
}
