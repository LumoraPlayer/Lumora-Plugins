package com.torrentplugin

import android.app.Activity
import android.os.Bundle

/**
 * The plugin has no UI of its own - it works entirely through the host. This screen just tells
 * the user how it's used, so launching the plugin directly isn't a dead end.
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
    }
}
