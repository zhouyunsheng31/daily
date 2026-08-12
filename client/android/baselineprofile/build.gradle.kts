import androidx.baselineprofile.gradle.BaselineProfilePlugin

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.baselineprofile)
}

android {
    namespace = "xyz.shadowshub.baselineprofile"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(libs.androidx.baselineprofile)
    implementation(project(":app"))
}

// Baseline Profile：真机执行（13-dev-toolchain §7.4），CI 仅编译骨架
baselineProfile {
    automaticGenerationDuringBuild = false
}