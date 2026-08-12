package com.livingdashboard.ai

import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 活跃 NavController 持有者（Spec 6.10 节）。
 *
 * - 写入方：AppNavGraph 创建 NavController 后 `holder.value.value = navController`，
 *   销毁时置 null
 * - 读取方：工具层（如 NavigateToPanelTool）通过 [navigate] 方法导航，不直接操作 NavController
 *
 * M8 修复（Spec 6.10）：新增 [navigate] suspend 方法，内部 [withContext]([Dispatchers.Main])。
 * NavController 必须主线程访问，直接暴露会让工具层误用。
 *
 * Hilt 注入：@Singleton（App 级共享 NavController 引用，AppNavGraph 写入 / 工具层读取）。
 */
@Singleton
class ActiveNavigatorHolder @Inject constructor() {
    val value: MutableStateFlow<NavController?> = MutableStateFlow(null)

    /** 只读视图，UI 订阅用 */
    val state: StateFlow<NavController?> = value.asStateFlow()

    /**
     * 工具层调用此方法导航，内部切主线程。
     *
     * @param route 目标路由
     */
    suspend fun navigate(route: String) {
        withContext(Dispatchers.Main) {
            value.value?.navigate(route)
        }
    }

    /** 可选的 popBackStack 等其他导航操作（同理切主线程） */
    suspend fun popBackStack() {
        withContext(Dispatchers.Main) {
            value.value?.popBackStack()
        }
    }
}
