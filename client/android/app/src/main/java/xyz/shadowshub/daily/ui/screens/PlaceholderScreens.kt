package xyz.shadowshub.daily.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** 占位页：M0-1 空壳，M1-1 按 10-ui-design 完整实现。 */
@Composable
private fun Placeholder(title: String, subtitle: String) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text = title, style = MaterialTheme.typography.headlineMedium)
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun DesktopScreen() = Placeholder("桌面", "你的第二个桌面（M1-4 实现）")

@Composable
fun StoreScreen() = Placeholder("商店", "App 包市场（M2 实现）")

@Composable
fun ProfileScreen() = Placeholder("我的", "账号/余额/文件/备份（M1-6 实现）")