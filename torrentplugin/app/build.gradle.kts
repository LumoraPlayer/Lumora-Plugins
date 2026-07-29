plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.torrentplugin"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.torrentplugin"
        minSdk = 25
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            // jlibtorrent ships native .so per ABI; leave shrinking off to avoid stripping
            // JNI entry points the linker resolves reflectively.
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    packaging {
        // Multiple jlibtorrent ABI artifacts can carry the same license/notice files.
        resources.excludes += setOf("META-INF/LICENSE*", "META-INF/NOTICE*")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // HTML scraping (torrent site pages)
    implementation("org.jsoup:jsoup:1.18.1")
    // Local streaming HTTP server handed to the host's player
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    // libtorrent on Android (frostwire jlibtorrent) - core jar + per-ABI native binaries
    implementation("com.frostwire:jlibtorrent:1.2.0.18")
    implementation("com.frostwire:jlibtorrent-android-arm64:1.2.0.18")
    implementation("com.frostwire:jlibtorrent-android-arm:1.2.0.18")
    implementation("com.frostwire:jlibtorrent-android-x86_64:1.2.0.18")
}
