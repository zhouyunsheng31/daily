package xyz.shadowshub.daily.ui.theme

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import xyz.shadowshub.daily.R

/**
 * 品牌启动图（2026-08-16 用户定稿：纯色极简，去掉生图背景）：
 * 浅色纯底（与主题 background 一致，无闪变）+ 中央 E1 logo + "daily"。
 * 只用于系统首屏（冷启动 → 桌面第一帧渲染完成），不用于 App 加载（宿主不干涉 App）。
 */
@Composable
fun LoadingView(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFFF8F7F3)),
    ) {
        Column(
            modifier = Modifier.align(Alignment.Center),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(
                painter = painterResource(R.drawable.icon_e1_logo),
                contentDescription = "Daily",
                modifier = Modifier.size(96.dp).clip(CircleShape),
            )
            Spacer(Modifier.height(16.dp))
            Text(
                "daily",
                fontSize = 24.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color(0xFF0F172A),
                letterSpacing = 3.sp,
            )
        }
    }
}