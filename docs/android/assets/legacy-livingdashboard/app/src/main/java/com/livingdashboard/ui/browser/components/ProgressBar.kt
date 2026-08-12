package com.livingdashboard.ui.browser.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * 加载进度条（Spec 3.3.3）。
 *
 * - progress < 100 时显示 LinearProgressIndicator
 * - progress >= 100 时不显示（返回空 Box）
 *
 * @param progress 加载进度（0-100）
 * @param modifier Compose Modifier
 */
@Composable
fun ProgressBar(
    progress: Int,
    modifier: Modifier = Modifier
) {
    if (progress < 100) {
        LinearProgressIndicator(
            progress = { progress / 100f },
            modifier = modifier
                .fillMaxWidth()
                .height(2.dp)
        )
    }
}
