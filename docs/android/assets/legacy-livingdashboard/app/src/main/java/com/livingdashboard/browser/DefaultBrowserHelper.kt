package com.livingdashboard.browser

import android.app.Activity
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings

/**
 * 默认浏览器辅助工具（Spec 3.2.5，含 C6 修复）。
 *
 * C6 修复：不走 Hilt DI（需要 Activity 引用，Hilt 通常注入 ApplicationContext）。
 * 改为 object 单例 + Activity 参数的顶层方法。
 *
 * 使用示例（rememberLauncherForActivityResult 用法）：
 * ```kotlin
 * @Composable
 * fun DefaultBrowserSettingItem() {
 *     val context = LocalContext.current
 *     val activity = context as Activity  // Composable 顶层确保是 Activity Context
 *
 *     // 注册 ActivityResultLauncher 接收 RoleManager 回调
 *     val roleLauncher = rememberLauncherForActivityResult(
 *         contract = ActivityResultContracts.StartActivityForResult()
 *     ) { result ->
 *         if (result.resultCode == Activity.RESULT_OK) {
 *             Toast.makeText(context, "已设为默认浏览器", Toast.LENGTH_SHORT).show()
 *         } else {
 *             Toast.makeText(context, "未设为默认浏览器", Toast.LENGTH_SHORT).show()
 *         }
 *     }
 *
 *     // 判断是否已是默认浏览器
 *     val isDefault = DefaultBrowserHelper.isDefaultBrowser(activity)
 *
 *     // 请求设为默认浏览器
 *     val intent = DefaultBrowserHelper.createRequestRoleIntent(activity)
 *     if (intent != null) {
 *         roleLauncher.launch(intent)
 *     }
 * }
 * ```
 *
 * 关键设计：
 * - 不走 Hilt DI：因为需要 Activity（不是 ApplicationContext）
 * - Android 10+：用 RoleManager，需通过 ActivityResultLauncher 接收回调
 * - Android <10：降级打开系统"默认应用"设置页
 */
object DefaultBrowserHelper {

    /**
     * 判断当前 App 是否已设为默认浏览器。
     * - Android 10+：用 RoleManager.isRoleHeld(ROLE_BROWSER)
     * - Android <10：返回 false（不支持 RoleManager）
     *
     * @param activity Activity（用于获取系统服务）
     * @return true 表示已是默认浏览器
     */
    fun isDefaultBrowser(activity: Activity): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        val roleManager = activity.getSystemService(Context.ROLE_SERVICE) as RoleManager
        return roleManager.isRoleHeld(RoleManager.ROLE_BROWSER)
    }

    /**
     * 创建请求设为默认浏览器的 Intent。
     * - Android 10+：用 RoleManager.createRequestRoleIntent(ROLE_BROWSER)
     * - Android <10：降级返回 ACTION_MANAGE_DEFAULT_APPS_SETTINGS Intent
     *
     * 调用方需用 rememberLauncherForActivityResult 接收回调：
     * - Android 10+：用 roleLauncher.launch(intent) 接收用户选择结果
     * - Android <10：直接 startActivity(intent) 打开系统设置页
     *
     * @param activity Activity（用于获取系统服务）
     * @return Intent（Android 10+ 为 RoleManager 请求 Intent，<10 为系统设置 Intent）
     */
    fun createRequestRoleIntent(activity: Activity): Intent? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // 降级：打开系统默认应用设置
            return Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
        }
        val roleManager = activity.getSystemService(Context.ROLE_SERVICE) as RoleManager
        return roleManager.createRequestRoleIntent(RoleManager.ROLE_BROWSER)
    }
}
