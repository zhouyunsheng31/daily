package xyz.shadowshub.daily.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.DesktopWindows
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import xyz.shadowshub.daily.ui.apps.AppRunScreen
import xyz.shadowshub.daily.ui.apps.AppsScreen
import xyz.shadowshub.daily.ui.chat.ChatScreen
import xyz.shadowshub.daily.ui.screens.ProfileScreen
import xyz.shadowshub.daily.ui.screens.StoreScreen

/** 底部四大主 Tab（10-ui-design §3：对话/桌面/商店/我的）。 */
enum class DailyTab(val route: String, val label: String, val icon: ImageVector) {
    Chat("chat", "对话", Icons.Filled.Chat),
    Desktop("desktop", "桌面", Icons.Filled.DesktopWindows),
    Store("store", "商店", Icons.Filled.Storefront),
    Profile("profile", "我的", Icons.Filled.Person),
}

@Composable
fun DailyApp() {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination

    // M0-3：打开的 App（全屏运行页，覆盖主 UI）
    var openApp by remember { mutableStateOf<Pair<String, String>?>(null) }

    if (openApp != null) {
        AppRunScreen(
            appId = openApp!!.first,
            appName = openApp!!.second,
            onBack = { openApp = null },
        )
        return
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                DailyTab.entries.forEach { tab ->
                    val selected = currentDestination?.hierarchy?.any { it.route == tab.route } == true
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(tab.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = DailyTab.Chat.route,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable(DailyTab.Chat.route) { ChatScreen() }
            composable(DailyTab.Desktop.route) { AppsScreen(onOpen = { id, name -> openApp = id to name }) }
            composable(DailyTab.Store.route) { StoreScreen() }
            composable(DailyTab.Profile.route) { ProfileScreen() }
        }
    }
}