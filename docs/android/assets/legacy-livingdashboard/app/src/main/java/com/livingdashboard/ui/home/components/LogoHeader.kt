package com.livingdashboard.ui.home.components

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.livingdashboard.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Logo 头部（Spec 3.3.2）。
 *
 * - 默认显示 `R.drawable.ic_logo`
 * - 若 `logoUri` 不为空，则异步加载本地文件 URI 替换默认 Logo
 * - 可选显示书签入口按钮（onOpenBookmarks 不为 null 时显示）
 *
 * @param logoUri 自定义 Logo 文件路径（null=用默认 ic_logo）
 * @param onOpenBookmarks 书签入口回调（null=不显示书签按钮）
 * @param modifier Compose Modifier
 */
@Composable
fun LogoHeader(
    logoUri: String?,
    onOpenBookmarks: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current

    // 异步加载自定义 Logo Bitmap（避免阻塞主线程）
    val logoBitmap: ImageBitmap? by produceState<ImageBitmap?>(initialValue = null, logoUri) {
        value = if (logoUri.isNullOrEmpty()) {
            null
        } else {
            withContext(Dispatchers.IO) {
                runCatching {
                    val stream = context.contentResolver.openInputStream(Uri.parse(logoUri))
                        ?: return@runCatching null
                    stream.use { BitmapFactory.decodeStream(it)?.asImageBitmap() }
                }.getOrNull()
            }
        }
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center
    ) {
        // 问题4修复：Logo/书签一体入口——Logo 本身可点击打开书签
        val logoModifier = if (onOpenBookmarks != null) {
            Modifier
                .size(56.dp)
                .clickable { onOpenBookmarks() }
        } else {
            Modifier.size(56.dp)
        }
        if (logoBitmap != null) {
            Image(
                bitmap = logoBitmap!!,
                contentDescription = "App Logo",
                modifier = logoModifier
            )
        } else {
            Image(
                painter = painterResource(id = R.drawable.ic_logo),
                contentDescription = "App Logo",
                modifier = logoModifier
            )
        }
    }
}
