plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "xyz.shadowshub.core"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    // 契约 DTO
    implementation(libs.kotlinx.serialization.json)
    // 协程（Flow/callbackFlow）
    implementation(libs.kotlinx.coroutines.core)
    // 网络（M0-2 已实现 ApiClient/SSE；OkHttp4.12 稳定版 + okhttp-sse）
    implementation(libs.okhttp)
    implementation(libs.okhttp.sse)
    // DI
    implementation(libs.koin.core)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.core)
}