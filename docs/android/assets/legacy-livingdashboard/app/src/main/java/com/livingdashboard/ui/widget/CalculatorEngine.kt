package com.livingdashboard.ui.widget

import com.ezylang.evalex.Expression

/**
 * 计算器表达式解析引擎（Spec A.3，NC4 修复）。
 *
 * NC4 修复：用 EvalEx 库替代 javax.script
 * （Android 不自带 Rhino 引擎，javax.script 不可用）。
 *
 * 依赖：`com.ezylang:EvalEx:3.6.2`（见 build.gradle.kts，Maven Central 正确坐标）
 *
 * 参考 desktop Calculator.tsx 的 evaluate + formatResult 逻辑。
 */
object CalculatorEngine {

    /**
     * 解析并计算表达式。
     *
     * @param expression 数学表达式，支持 + - × ÷ 数字 小数点
     * @return 计算结果
     * @throws IllegalArgumentException 表达式为空或非法
     * @throws com.ezylang.evalex.parser.ParseException 表达式语法错误
     * @throws com.ezylang.evalex.EvaluationException 计算错误（如除零）
     */
    fun evaluate(expression: String): Double {
        val cleaned = expression
            .replace("×", "*")
            .replace("÷", "/")
            .replace("−", "-")
            .replace(",", "")
            .trim()
        if (cleaned.isEmpty()) {
            throw IllegalArgumentException("表达式为空")
        }
        // EvalEx 3.6.2：Expression(...).evaluate() 返回 EvaluationValue
        return Expression(cleaned).evaluate().numberValue.toDouble()
    }

    /**
     * 格式化结果：整数去小数点，浮点数保留 6 位有效数字并去尾零。
     */
    fun formatResult(value: Double): String {
        return if (value % 1.0 == 0.0 && value.isFinite()) {
            value.toLong().toString()
        } else if (!value.isFinite()) {
            "无法计算"  // NaN / Infinity
        } else {
            String.format("%.6f", value).trimEnd('0').trimEnd('.')
        }
    }
}
