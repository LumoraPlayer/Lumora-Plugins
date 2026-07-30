package com.lumora.animeplugin

import android.app.Activity
import android.os.Bundle

/**
 * Placeholder activity — the plugin has no UI. Launching it directly tells the user
 * how to use it from the Lumora host.
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
    }
}
