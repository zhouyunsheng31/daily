package com.livingdashboard.ai

import kotlinx.coroutines.flow.Flow

/**
 * Agent 服务接口（Spec 6.3 节）。
 *
 * Local 与 Cloud 两种实现的共同接口。UI 层（CanvasHomeViewModel）通过
 * [RuntimeModeManager.state].value.effectiveMode 选择具体实现：
 * - CLOUD → [CloudAgentService]（WS 路由到服务器 Pi Agent）
 * - LOCAL → [LocalAgentService]（本地 LlmClient + AgentLoop）
 *
 * 注意：effectiveMode 已由 RuntimeModeManager 把 AUTO 解析为 CLOUD 或 LOCAL，
 * 调用方只需匹配 CLOUD / LOCAL，无需 AUTO 分支（m18 修复）。
 *
 * 路由实现位置：CanvasHomeViewModel.pickService()（Spec 6.6 节，不新建类），
 * 根据 effectiveMode 路由到 Local 或 Cloud（不要 AUTO 分支，直接用 effectiveMode）。
 */
interface AgentService {
    /**
     * 发送消息到指定面板，返回 AgentEvent 流。
     *
     * - CLOUD 模式：通过 WS 把消息发到服务器 Pi Agent，订阅 PanelEventRouter 收 PiEvent
     * - LOCAL 模式：调 LocalAgentService 走本地 LlmClient + AgentLoop
     *
     * 实现由 RuntimeModeManager.state.value.effectiveMode 决定走哪个分支。
     *
     * @param panelId 面板 ID（Session 隔离粒度）
     * @param userMessage 用户消息文本
     * @param thinkingLevel 思考等级（默认 STANDARD）
     * @return AgentEvent 流（UI 按事件类型更新消息列表）
     */
    fun sendMessage(
        panelId: String,
        userMessage: String,
        thinkingLevel: ThinkingLevel = ThinkingLevel.STANDARD,
    ): Flow<AgentEvent>

    /**
     * 销毁指定面板的 Session（面板删除 / ViewModel onCleared 时调）。
     *
     * CLOUD 实现：必须发 [com.livingdashboard.sync.ClientMessage.DisposeSession] 到服务器（C3 修复）。
     *
     * @param panelId 面板 ID
     */
    fun disposeSession(panelId: String)

    /**
     * 测试连接（仅 LOCAL 模式有意义，CLOUD 走 WS 状态）。
     *
     * @param config 待测试的 provider 配置（不需要先保存到 ApiKeyStore）
     * @return true=连接成功，false=失败
     */
    suspend fun testConnection(config: LlmProviderConfig): Boolean
}
