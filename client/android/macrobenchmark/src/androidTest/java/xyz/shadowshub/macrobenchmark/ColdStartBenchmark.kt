package xyz.shadowshub.macrobenchmark

import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.ExperimentalBaselineProfilesApi
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 冷启动 Macrobenchmark（M0-1 骨架）。
 * 真机执行：./gradlew :macrobenchmark:connectedBenchmarkAndroidTest
 * 结果归档：docs/android/perf-reports/（11-performance §2 预算表）
 */
@RunWith(AndroidJUnit4::class)
class ColdStartBenchmark {

    @get:Rule
    val rule = MacrobenchmarkRule()

    @OptIn(ExperimentalBaselineProfilesApi::class)
    @Test
    fun startupCompilationNone() {
        rule.measureRepeated(
            packageName = "xyz.shadowshub.daily",
            metrics = listOf(StartupMode.COLD),
            compilationMode = CompilationMode.None(),
            iterations = 5,
            startupMode = StartupMode.COLD,
            setupBlock = {
                pressHome()
                startActivityAndWait()
                device.wait(Until.hasObject(By.text("对话")), 5_000)
            },
        ) { }
    }
}