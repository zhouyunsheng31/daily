package com.livingdashboard.ai

import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * browser_screenshot 工具（Spec 6.9.5 节）。
 *
 * 截取当前活跃 WebView 的画面，返回 JPEG base64 编码。
 *
 * 关键实现点：
 * - **M6 修复**：`webView.width/height <= 0` 防御（页面未布局完成时 `createBitmap` 会抛 `IllegalArgumentException`）
 * - **m17 修复**：截图压缩——JPEG quality=80，最大 1080x1920，超出按比例缩放（不放大）
 * - `View.draw(Canvas)` 不含 WebGL 内容（已知 trade-off，对 99% 网页足够）
 * - 返回 `{imageBase64, width, height, format, mimeType}` 供 LLM / UI 消费
 */
class BrowserScreenshotTool(
    private val webviewHolder: ActiveWebViewHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_screenshot",
        description = "截取当前页面的截图，返回 JPEG base64 编码。",
        parameters = toolObjectSchema { /* 无参数 */ },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewHolder.value.value
            ?: return ToolResult.error("no active webview")

        // 1. 主线程截图：createBitmap + Canvas + webView.draw
        // M6 修复：width/height <= 0 时 resumeWithException，由外层 catch 返回错误
        val bitmap: Bitmap = try {
            withTimeoutOrNull(30_000) {
                suspendCancellableCoroutine<Bitmap> { cont ->
                    webView.post {
                        // M6 修复：防御 width/height <= 0（页面未布局完成时 createBitmap 会抛 IllegalArgumentException）
                        if (webView.width <= 0 || webView.height <= 0) {
                            if (cont.isActive) cont.resumeWithException(
                                IllegalStateException("webview not laid out yet (width/height <= 0)")
                            )
                            return@post
                        }
                        try {
                            val rawBitmap = Bitmap.createBitmap(
                                webView.width, webView.height, Bitmap.Config.ARGB_8888
                            )
                            val canvas = Canvas(rawBitmap)
                            webView.draw(canvas)
                            if (cont.isActive) cont.resume(rawBitmap)
                        } catch (e: Exception) {
                            if (cont.isActive) cont.resumeWithException(e)
                        }
                    }
                }
            } ?: return ToolResult.error("screenshot timeout")
        } catch (e: Exception) {
            return ToolResult.error(e.message ?: "screenshot failed")
        }

        // 2. m17 压缩 + 缩放（后台线程）
        val (scaledBitmap, actualWidth, actualHeight) = withContext(Dispatchers.Default) {
            // 按最大尺寸 1080x1920 等比缩放（不放大，只缩小）
            val maxW = 1080
            val maxH = 1920
            val srcW = bitmap.width
            val srcH = bitmap.height
            val scaleW = maxW.toFloat() / srcW
            val scaleH = maxH.toFloat() / srcH
            val scale = minOf(scaleW, scaleH, 1f)
            val scaled = if (scale < 1f) {
                Bitmap.createScaledBitmap(bitmap, (srcW * scale).toInt(), (srcH * scale).toInt(), true)
            } else {
                bitmap
            }
            Triple(scaled, scaled.width, scaled.height)
        }

        // 3. JPEG quality=80（PNG 无损 quality 不生效；用 JPEG 减小体积，UI 显示足够）
        val base64 = withContext(Dispatchers.Default) {
            ByteArrayOutputStream().use { baos ->
                scaledBitmap.compress(Bitmap.CompressFormat.JPEG, 80, baos)
                Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
            }
        }
        // 释放 scaled bitmap（若是新建的）
        if (scaledBitmap !== bitmap) scaledBitmap.recycle()

        return ToolResult.success(buildJsonObject {
            put("imageBase64", base64)
            put("width", actualWidth)
            put("height", actualHeight)
            put("format", "jpeg")
            put("mimeType", "image/jpeg")
        })
    }
}
