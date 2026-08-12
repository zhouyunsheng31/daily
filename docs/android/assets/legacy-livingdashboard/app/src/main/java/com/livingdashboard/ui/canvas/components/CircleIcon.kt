package com.livingdashboard.ui.canvas.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.livingdashboard.R

/**
 * 圆形图标，Spec 6.1 节。
 *
 * v4 #9：可点击进入画布面板（layout-design 2.10 要求）。
 *
 * 视觉规格（D6 白色洁净色系）：
 * - 72dp 圆形，背景 rgba(0,0,0,0.03)
 * - 内嵌 40dp logo 图标
 *
 * @param modifier 外层 Modifier
 * @param onClick 点击回调（默认无操作）
 */
@Composable
fun CircleIcon(
    modifier: Modifier = Modifier,
    onClick: () -> Unit = {}
) {
    Box(
        modifier = modifier
            .size(72.dp)
            .background(
                color = Color(0x08000000),  // D6 rgba(0,0,0,0.03)
                shape = androidx.compose.foundation.shape.CircleShape
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_logo),
            contentDescription = "Logo",
            modifier = Modifier.size(40.dp),
            tint = Color.Unspecified
        )
    }
}
