plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.superdrive"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.superdrive"
        minSdk = 24
        targetSdk = 34
        // CI passes the run number; local builds get 1.
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("versionName") as String?) ?: "1.0.0"
    }

    // Production builds sign with the key from the environment (GitHub secrets). Without it the fixed key that is
    // committed next to this file is used: fine for sideloading and for updates over earlier builds, but it is a
    // public key, so replace it (see README) before distributing the app widely.
    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("ANDROID_KEYSTORE_FILE") ?: "release.keystore")
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: "superdrive"
            keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "superdrive"
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: "superdrive"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.work:work-runtime:2.9.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
}
