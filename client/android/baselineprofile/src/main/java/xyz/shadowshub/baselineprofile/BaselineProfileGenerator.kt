package xyz.shadowshub.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Baseline Profile 生成器（M0-1 骨架）。
 * 真机执行：./gradlew :baselineprofile:connectedCheck
 * 生成产物：app/src/main/generated/baselineProfiles/baseline-prof.txt
 */
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {

    @get:Rule
    val rule = BaselineProfileRule()

    @Test
    fun generate() {
        rule.collect(
            packageName = "xyz.shadowshub.daily",
            profileBlock = {
                startActivityAndWait()
            },
        )
    }
}