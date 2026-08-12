import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.kapt")
    id("com.google.dagger.hilt.android")
    id("org.jetbrains.kotlinx.kover") version "0.7.6"
}

// 手动读取 local.properties（project.findProperty 不读 local.properties 的自定义属性）
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val wsUrl: String = localProps.getProperty("LIVING_DASHBOARD_WS_URL")
    ?: (project.findProperty("LIVING_DASHBOARD_WS_URL") as String?)
    ?: "ws://10.0.2.2:3456/ws"

android {
    namespace = "com.livingdashboard"
    compileSdk = 36  // 实验性：AGP 8.2 官方支持最高 34，用 suppressUnsupportedCompileSdk 压制警告

    defaultConfig {
        applicationId = "com.livingdashboard"
        minSdk = 26
        targetSdk = 36
        versionCode = 10  // M4
        versionName = "0.1.0-m4"

        // WS 地址：优先 local.properties，其次 gradle property，最后默认值
        // 真机验收前在 local.properties 设置 LIVING_DASHBOARD_WS_URL=ws://<主机IP>:3456/ws
        buildConfigField("String", "WS_URL", "\"$wsUrl\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }
    }

    signingConfigs {
        create("release") {
            // Spec 8.2 节 行 1815：keystore 路径固定 F:\allmylife\keystores\living-dashboard.jks
            // 密码/alias 通过环境变量传入，避免敏感信息入 git
            storeFile = file("F:/allmylife/keystores/living-dashboard.jks")
            storePassword = System.getenv("LD_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("LD_KEY_ALIAS")
            keyPassword = System.getenv("LD_KEY_PASSWORD")
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }

    testOptions {
        unitTests {
            // Spec 五节 行 210：Robolectric 需要 Android 资源
            isIncludeAndroidResources = true
            // Spec 五节 行 211：未 mock 的 Android API 返回默认值（避免 NPE）
            isReturnDefaultValues = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

// Robolectric 锁文件修复（两步策略）：
// 1. 将 user.home 重定向到 F 盘（避免在 C 盘创建 .robolectric-download-lock）。
//    Gradle test worker JVM 沙箱阻止 RandomAccessFile.open0 native 调用，
//    即使路径在 F 盘也无法创建锁文件。
// 2. 设置 robolectric.dependency.dir 指向预下载 android-all jar 的目录，
//    完全绕过 MavenDependencyResolver（不再需要锁文件）。
//    jar 路径：<dir>/android-all-instrumented-14-robolectric-10818077-i6.jar
//    SDK 34 对应 build 10818077，Robolectric 4.13 DefaultSdkProvider 映射到 i6 版本。
// 符合用户规则：不下载到 C 盘。
tasks.withType<Test> {
    systemProperty("user.home", "F:/allmylife/robolectric-home")
    systemProperty("robolectric.dependency.dir", "F:/allmylife/robolectric-home")
}

dependencies {
    // Compose
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.core:core-ktx:1.13.1")

    // Hilt
    implementation("com.google.dagger:hilt-android:2.48")
    kapt("com.google.dagger:hilt-compiler:2.48")
    implementation("androidx.hilt:hilt-navigation-compose:1.2.0")

    // OkHttp (WebSocket)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // kotlinx-serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // Room (M0 引入，M1 建表)
    implementation("androidx.room:room-runtime:2.6.1")
    kapt("androidx.room:room-compiler:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")

    // Navigation (M1)
    implementation("androidx.navigation:navigation-compose:2.7.7")

    // DataStore Preferences (M1)
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // Coroutines (M1，Room 异步)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // material-icons-extended (M1，更多图标，R8 裁剪)
    implementation("androidx.compose.material:material-icons-extended")

    // NC4：CalculatorEngine 表达式解析库（EvalEx，Maven Central 坐标 com.ezylang:EvalEx）
    implementation("com.ezylang:EvalEx:3.6.2")

    // 测试
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")

    // ===== M8 新增（Spec 五节 行 189-200）=====

    // API Key 加密存储（EncryptedSharedPreferences，minSdk=26 兼容 alpha06）
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // M8 测试依赖
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.robolectric:robolectric:4.13")  // 支持 SDK 35；compileSdk=36 时测试类加 @Config(sdk = [34])
    testImplementation("io.mockk:mockk:1.13.10")
    testImplementation("com.google.truth:truth:1.1.5")
    testImplementation("androidx.test:core:1.5.0")  // AndroidX Test
    testImplementation("androidx.test.ext:junit:1.1.5")  // AndroidX JUnit Extensions

    // ===== M3 新增（Spec 6.21 节）：Compose UI 测试依赖 =====
    // 用于 ThinkingLevelSliderTest 的滑动交互测试（createComposeRule）
    testImplementation("androidx.compose.ui:ui-test-junit4")
    // ui-test-manifest 仅 debug 依赖，提供测试 Activity 容器
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

// Spec 5.1 节：Kover 覆盖率配置（行 ≥ 80%，分支 ≥ 70%）
// Kover 0.7.0+ 迁移：kover { verify { rule { minBound() } } } → koverReport { defaults { verify { rule { bound {} } } } }
koverReport {
    defaults {
        verify {
            rule {
                bound {
                    minValue = 80
                    metric = kotlinx.kover.gradle.plugin.dsl.MetricType.LINE
                    aggregation = kotlinx.kover.gradle.plugin.dsl.AggregationType.COVERED_PERCENTAGE
                }
                bound {
                    minValue = 70
                    metric = kotlinx.kover.gradle.plugin.dsl.MetricType.BRANCH
                    aggregation = kotlinx.kover.gradle.plugin.dsl.AggregationType.COVERED_PERCENTAGE
                }
            }
        }
    }
}

// 注：suppressUnsupportedCompileSdk 在 gradle.properties 中设置（此处不生效）
