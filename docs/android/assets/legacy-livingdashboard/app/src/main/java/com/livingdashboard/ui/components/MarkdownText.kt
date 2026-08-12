package com.livingdashboard.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.TextUnit

/**
 * 轻量级纯 Compose Markdown 渲染组件。
 *
 * 替代 compose-markdown 库（jeziellago），避免 AppCompat 主题冲突。
 *
 * 支持的语法：
 * - `**bold**` → 粗体
 * - `` `inline code` `` → 等宽字体 + 浅灰背景
 * - `# heading` / `## heading` / `### heading` → 不同字号标题
 * - `- list item` → 带 "•" 前缀
 * - ` ```code block``` ` → 等宽字体 + 浅灰背景块
 * - 普通文本 → 正常显示
 *
 * @param markdown markdown 文本
 * @param textColor 文字颜色
 * @param fontSize 基础字号
 * @param modifier 外层 Modifier
 */
@Composable
fun MarkdownText(
    markdown: String,
    textColor: Color,
    fontSize: TextUnit,
    modifier: Modifier = Modifier,
) {
    val lines = markdown.lines()
    Column(modifier = modifier) {
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            when {
                // 代码块 ```lang ... ```
                line.startsWith("```") -> {
                    val lang = line.removePrefix("```").trim()
                    val codeBuilder = StringBuilder()
                    i++
                    while (i < lines.size && !lines[i].startsWith("```")) {
                        codeBuilder.append(lines[i]).append("\n")
                        i++
                    }
                    // 跳过结束的 ```
                    if (i < lines.size) i++
                    CodeBlock(codeBuilder.toString().trimEnd(), fontSize)
                }
                // 标题 # / ## / ###
                line.startsWith("### ") -> {
                    Text(
                        text = line.removePrefix("### "),
                        fontSize = (fontSize.value * 1.1f).sp,
                        fontWeight = FontWeight.Bold,
                        color = textColor,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                    )
                    i++
                }
                line.startsWith("## ") -> {
                    Text(
                        text = line.removePrefix("## "),
                        fontSize = (fontSize.value * 1.25f).sp,
                        fontWeight = FontWeight.Bold,
                        color = textColor,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                    )
                    i++
                }
                line.startsWith("# ") -> {
                    Text(
                        text = line.removePrefix("# "),
                        fontSize = (fontSize.value * 1.5f).sp,
                        fontWeight = FontWeight.Bold,
                        color = textColor,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    )
                    i++
                }
                // 列表项 - / *
                line.startsWith("- ") || line.startsWith("* ") -> {
                    val content = line.substring(2)
                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 1.dp)) {
                        Text(
                            text = "• ",
                            fontSize = fontSize,
                            color = textColor,
                        )
                        Text(
                            text = parseInline(content, textColor, fontSize),
                            fontSize = fontSize,
                            color = textColor,
                        )
                    }
                    i++
                }
                // 空行
                line.isBlank() -> {
                    i++
                }
                // 普通行（含 inline bold/code）
                else -> {
                    Text(
                        text = parseInline(line, textColor, fontSize),
                        fontSize = fontSize,
                        color = textColor,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 1.dp),
                    )
                    i++
                }
            }
        }
    }
}

/**
 * 解析行内 markdown 语法（`**bold**` 和 `` `code` ``）。
 */
private fun parseInline(text: String, color: Color, fontSize: TextUnit): AnnotatedString =
    buildAnnotatedString {
        var i = 0
        while (i < text.length) {
            when {
                // **bold**
                text.startsWith("**", i) -> {
                    val end = text.indexOf("**", i + 2)
                    if (end != -1) {
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = color, fontSize = fontSize)) {
                            append(text.substring(i + 2, end))
                        }
                        i = end + 2
                    } else {
                        append(text[i])
                        i++
                    }
                }
                // `inline code`
                text.startsWith("`", i) -> {
                    val end = text.indexOf("`", i + 1)
                    if (end != -1) {
                        withStyle(
                            SpanStyle(
                                fontFamily = FontFamily.Monospace,
                                background = Color(0x14000000),
                                color = color,
                                fontSize = fontSize,
                            )
                        ) {
                            append(" ")
                            append(text.substring(i + 1, end))
                            append(" ")
                        }
                        i = end + 1
                    } else {
                        append(text[i])
                        i++
                    }
                }
                // *italic*（单星号，非 **）
                text.startsWith("*", i) && !text.startsWith("**", i) -> {
                    val end = text.indexOf("*", i + 1)
                    if (end != -1) {
                        withStyle(SpanStyle(fontStyle = FontStyle.Italic, color = color, fontSize = fontSize)) {
                            append(text.substring(i + 1, end))
                        }
                        i = end + 1
                    } else {
                        append(text[i])
                        i++
                    }
                }
                else -> {
                    append(text[i])
                    i++
                }
            }
        }
    }

/**
 * 代码块渲染（等宽 + 浅灰背景）。
 */
@Composable
private fun CodeBlock(code: String, fontSize: TextUnit) {
    Text(
        text = code,
        fontSize = (fontSize.value * 0.9f).sp,
        fontFamily = FontFamily.Monospace,
        color = Color(0xFF333333),
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .background(
                color = Color(0x0F000000),
                shape = RoundedCornerShape(4.dp),
            )
            .padding(8.dp),
    )
}
