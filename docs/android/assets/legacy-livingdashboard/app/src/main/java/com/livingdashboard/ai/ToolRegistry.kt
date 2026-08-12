package com.livingdashboard.ai

import com.livingdashboard.data.repository.CanvasRepository
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.concurrent.ConcurrentHashMap

/**
 * 工具注册表（Spec 6.3 节）。
 *
 * - 线程安全（[ConcurrentHashMap]）
 * - [execute] 捕获工具抛出的异常，转为 [ToolResult.error]，避免单工具崩溃中断 agent 循环
 */
class ToolRegistry {
    private val tools = ConcurrentHashMap<String, Tool>()

    /** 注册工具（按 definition.name 索引，重复注册覆盖旧值） */
    fun register(tool: Tool) {
        tools[tool.definition.name] = tool
    }

    /** 注销工具 */
    fun unregister(name: String) {
        tools.remove(name)
    }

    /** 按名查工具（找不到返回 null） */
    fun get(name: String): Tool? = tools[name]

    /** 列出所有工具定义（按 name 字典序，保证 LLM 看到的工具列表稳定） */
    fun listDefinitions(): List<ToolDefinition> =
        tools.values.map { it.definition }.sortedBy { it.name }

    /**
     * 执行工具（Spec 5.6 节 C2 修复：未实现工具降级处理）。
     *
     * - 工具不存在 → 返回 `ToolResult.success(data={status:"not_implemented", ...})`
     *   （用 success=true 包装结构化错误，让 AI 看到降级提示而非 ToolRegistry 异常）
     * - 工具抛异常 → [ToolResult.error] 异常 message
     * - 正常 → 透传 [Tool.execute] 返回值
     */
    suspend fun execute(name: String, args: JsonObject): ToolResult {
        val tool = tools[name] ?: return ToolResult.success(buildJsonObject {
            put("status", "not_implemented")
            put("tool", name)
            put("success", false)
            put("error", "tool not implemented on mobile: $name")
            put("fallback_hint", when (name) {
                "browser_open" -> "use browser_navigate instead"
                "browser_list_tabs" -> "use list_widgets with type=webview"
                "browser_switch_tab" -> "use navigate_to_panel"
                "local_search" -> "use browser_get_dom and grep manually"
                else -> "no fallback"
            })
        })
        return try {
            tool.execute(args)
        } catch (e: Exception) {
            ToolResult.error(e.message ?: "tool execution failed")
        }
    }

    /**
     * 注册所有 14 个 browser_* 与 navigate_* 工具（Spec 6.15 节）。
     *
     * 工具层 A（6 个：BrowserClickTool / BrowserInputTool / BrowserScrollTool /
     * BrowserWaitForTool / BrowserScreenshotTool / BrowserGetDomTool）由其他 sub-agent
     * 并行实现。如果这些文件尚未创建，下面的注册行会编译失败，故先注释掉 + TODO 标记。
     * 待工具层 A 文件就绪后，取消注释即可启用全部 14 个工具。
     *
     * 工具层 B（8 个：6 个 browser_* + 2 个 navigate_*）由本任务实现，已注册。
     *
     * @param webviewHolder 活跃 WebView 持有者
     * @param navigatorHolder 活跃 NavController 持有者
     * @param canvasRepository 画布仓库
     */
    fun registerAllBrowserTools(
        webviewHolder: ActiveWebViewHolder,
        navigatorHolder: ActiveNavigatorHolder,
        canvasRepository: CanvasRepository,
    ) {
        // ===== 工具层 A（6 个）—— 文件已就绪，启用注册 =====
        register(BrowserClickTool(webviewHolder))
        register(BrowserInputTool(webviewHolder))
        register(BrowserScrollTool(webviewHolder))
        register(BrowserWaitForTool(webviewHolder))
        register(BrowserScreenshotTool(webviewHolder))
        register(BrowserGetDomTool(webviewHolder))

        // ===== 工具层 B（6 个 browser_*）—— 本任务实现 =====
        register(BrowserGetTitleTool(webviewHolder))
        register(BrowserBackTool(webviewHolder))
        register(BrowserForwardTool(webviewHolder))
        register(BrowserReloadTool(webviewHolder))
        register(BrowserGetCookieTool(webviewHolder))
        register(BrowserSetCookieTool(webviewHolder))

        // ===== 导航工具（2 个 navigate_*）—— 本任务实现 =====
        register(NavigateToPanelTool(navigatorHolder))
        register(CreatePanelTool(canvasRepository, navigatorHolder))
    }
}
