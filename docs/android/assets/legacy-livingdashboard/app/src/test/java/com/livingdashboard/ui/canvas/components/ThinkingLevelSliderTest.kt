package com.livingdashboard.ui.canvas.components

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertRangeInfoEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.livingdashboard.ai.ThinkingLevel
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * ThinkingLevelSlider Compose UI 测试（Spec 8.1 节，6 用例）。
 *
 * 用 Robolectric + AndroidJUnit4 + createComposeRule()。
 * @Config(sdk = [34]) 因 compileSdk=36（build.gradle.kts 行 151 注释要求）。
 *
 * application = Application::class：覆盖 AndroidManifest 中声明的 LivingDashboardApp，
 * 阻止 Robolectric 实例化它。LivingDashboardApp.onCreate 会启动数据库协程
 * （CanvasRepository.createAggregatePanel），在 Robolectric 的 ShadowLegacySQLiteConnection
 * 下因线程局部连接指针不匹配而崩溃（Illegal connection pointer），导致
 * UncaughtExceptionsBeforeTest。ThinkingLevelSlider 是纯 Compose 组件，无需 Hilt/数据库。
 *
 * 关键设计：
 * - 用 [SemanticsMatcher.keyIsDefined] + [SemanticsProperties.ProgressBarRangeInfo] 定位 Slider 节点
 * - 用 [assertRangeInfoEquals] 验证滑块位置（ordinal 0/1/2/3 ↔ value 0f/1f/2f/3f）
 * - 用 [performSemanticsAction] + [SemanticsActions.SetProgress] 模拟滑动到指定值
 * - 4 档标签（快速/平衡/深度/极深度）始终显示在底部 Row，故用 onNodeWithText 验证存在
 *
 * 用例：
 * 1. AUTO selected → slider 在位置 0 + "快速" 标签显示
 * 2. STANDARD selected → slider 在位置 1 + "平衡" 标签显示
 * 3. MAX selected → slider 在位置 3 + "极深度" 标签显示
 * 4. 4 个标签始终全部显示
 * 5. SetProgress 到 1f → onChange 被调用为 STANDARD
 * 6. SetProgress 到 3f → onChange 被调用为 MAX
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], application = Application::class)
class ThinkingLevelSliderTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val sliderMatcher = SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)

    // =========================================================================
    // 1. AUTO selected → slider 在位置 0 + "快速" 标签
    // =========================================================================

    @Test
    fun `AUTO selected shows slider at position 0 and 快速 label`() {
        composeRule.setContent {
            MaterialTheme {
                ThinkingLevelSlider(
                    selected = ThinkingLevel.AUTO,
                    onChange = {},
                )
            }
        }

        composeRule.onNode(sliderMatcher).assertRangeInfoEquals(
            ProgressBarRangeInfo(0f, 0f..3f, 2)
        )
        composeRule.onNodeWithText("快速").assertIsDisplayed()
    }

    // =========================================================================
    // 2. STANDARD selected → slider 在位置 1 + "平衡" 标签
    // =========================================================================

    @Test
    fun `STANDARD selected shows slider at position 1 and 平衡 label`() {
        composeRule.setContent {
            MaterialTheme {
                ThinkingLevelSlider(
                    selected = ThinkingLevel.STANDARD,
                    onChange = {},
                )
            }
        }

        composeRule.onNode(sliderMatcher).assertRangeInfoEquals(
            ProgressBarRangeInfo(1f, 0f..3f, 2)
        )
        composeRule.onNodeWithText("平衡").assertIsDisplayed()
    }

    // =========================================================================
    // 3. MAX selected → slider 在位置 3 + "极深度" 标签
    // =========================================================================

    @Test
    fun `MAX selected shows slider at position 3 and 极深度 label`() {
        composeRule.setContent {
            MaterialTheme {
                ThinkingLevelSlider(
                    selected = ThinkingLevel.MAX,
                    onChange = {},
                )
            }
        }

        composeRule.onNode(sliderMatcher).assertRangeInfoEquals(
            ProgressBarRangeInfo(3f, 0f..3f, 2)
        )
        composeRule.onNodeWithText("极深度").assertIsDisplayed()
    }

    // =========================================================================
    // 4. 4 个标签始终全部显示
    // =========================================================================

    @Test
    fun `all four labels always displayed regardless of selected`() {
        composeRule.setContent {
            MaterialTheme {
                ThinkingLevelSlider(
                    selected = ThinkingLevel.AUTO,
                    onChange = {},
                )
            }
        }

        composeRule.onNodeWithText("快速").assertIsDisplayed()
        composeRule.onNodeWithText("平衡").assertIsDisplayed()
        composeRule.onNodeWithText("深度").assertIsDisplayed()
        composeRule.onNodeWithText("极深度").assertIsDisplayed()
    }

    // =========================================================================
    // 5. SetProgress 到 1f → onChange 被调用为 STANDARD
    // =========================================================================

    @Test
    fun `SetProgress to 1f calls onChange with STANDARD`() {
        var captured: ThinkingLevel? = null
        composeRule.setContent {
            MaterialTheme {
                ThinkingLevelSlider(
                    selected = ThinkingLevel.AUTO,
                    onChange = { captured = it },
                )
            }
        }

        composeRule.onNode(sliderMatcher).performSemanticsAction(SemanticsActions.SetProgress) {
            it(1f)
        }

        assertEquals(ThinkingLevel.STANDARD, captured)
    }

    // =========================================================================
    // 6. SetProgress 到 3f → onChange 被调用为 MAX
    // =========================================================================

    @Test
    fun `SetProgress to 3f calls onChange with MAX`() {
        var captured: ThinkingLevel? = null
        composeRule.setContent {
            MaterialTheme {
                ThinkingLevelSlider(
                    selected = ThinkingLevel.AUTO,
                    onChange = { captured = it },
                )
            }
        }

        composeRule.onNode(sliderMatcher).performSemanticsAction(SemanticsActions.SetProgress) {
            it(3f)
        }

        assertEquals(ThinkingLevel.MAX, captured)
    }
}
