package com.redditscan.plugin

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The plugin does its real work through [PluginService], driven by the host app - there's no
 * standalone UI to speak of. This screen exists only so the app is launchable and can tell the
 * user what it is and how it's used.
 */
class MainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#101216"))
            setPadding(64, 64, 64, 64)
        }
        fun text(value: String, size: Float, color: String, topMargin: Int = 0) {
            root.addView(TextView(this).apply {
                text = value
                textSize = size
                setTextColor(Color.parseColor(color))
                gravity = Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { setMargins(0, topMargin, 0, 0) }
            })
        }

        text("Reddit Scan", 26f, "#FFFFFF")
        text("Companion plugin for Lumora", 15f, "#9AA3AD", 12)
        text(
            "This app has no controls of its own. Open Lumora, go to Settings > Plugins, enable " +
                "\"Reddit Scan\", and press Run. Providers it finds appear there for you to add.",
            14f, "#9AA3AD", 32
        )

        setContentView(root)
    }
}
