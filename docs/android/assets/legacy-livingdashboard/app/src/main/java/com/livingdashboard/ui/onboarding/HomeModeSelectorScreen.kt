package com.livingdashboard.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 首次启动主页选择页，Spec 8.2 节。
 *
 * App 首次启动时（defaultHomeMode == null）显示，让用户选择默认主页：
 * - "browser" → 浏览器主页（BrowserHomeScreen）
 * - "canvas" → 画布主页（CanvasHomeScreen）
 *
 * 选择后通过 [onSelect] 回调通知 MainViewModel 持久化到 SettingsStore，
 * 后续启动直接进入选择的主页，不再显示此页。
 *
 * 用户可在设置中随时更改（D4）。
 *
 * 视觉规格（D6 白色洁净色系）：
 * - 标题：24sp 加粗，#333333
 * - 副标题：14sp，#999999
 * - 卡片：圆角 20dp，背景 rgba(0,0,0,0.03)，宽高比 0.8
 *
 * @param onSelect 选择回调，参数为 "browser" 或 "canvas"
 */
@Composable
fun HomeModeSelectorScreen(
    onSelect: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "选择你的默认主页",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF333333)
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "你可以在设置中随时更改",
            fontSize = 14.sp,
            color = Color(0xFF999999)
        )
        Spacer(modifier = Modifier.height(48.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 浏览器主页
            ModeCard(
                title = "浏览器",
                description = "搜索 + 网页浏览",
                onClick = { onSelect("browser") },
                modifier = Modifier.weight(1f)
            )
            // 画布主页
            ModeCard(
                title = "画布",
                description = "无限画布 + 组件",
                onClick = { onSelect("canvas") },
                modifier = Modifier.weight(1f)
            )
        }
    }
}

/**
 * 主页模式选择卡片。
 *
 * @param title 卡片标题（如"浏览器"/"画布"）
 * @param description 卡片描述
 * @param onClick 点击回调
 * @param modifier 外层 Modifier
 */
@Composable
private fun ModeCard(
    title: String,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(0.8f),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = Color(0x08000000)  // D6 rgba(0,0,0,0.03)
        ),
        elevation = CardDefaults.cardElevation(0.dp),
        onClick = onClick
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = title,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF333333)
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = description,
                fontSize = 12.sp,
                color = Color(0xFF999999)
            )
        }
    }
}
