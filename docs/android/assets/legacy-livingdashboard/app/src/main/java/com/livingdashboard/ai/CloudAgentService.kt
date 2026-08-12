package com.livingdashboard.ai

import com.livingdashboard.sync.ClientMessage
import com.livingdashboard.sync.WsClient
import com.livingdashboard.sync.WsState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 云端 Agent 服务（Spec 6.5 节）。
 *
 * CLOUD 模式下，通过 WS 把用户消息发到服务器 Pi Agent，订阅 [PanelEventRouter] 收 PiEvent，
 * 转 [AgentEvent] 流。
 *
 * C8 修复：超时 120s（覆盖 browser_wait_for 30s + browser_screenshot 30s + LLM 推理 60s 最坏情况）。
 * 超时后发 [ClientMessage.DisposeSession] 通知服务器释放 session。
 *
 * 代码 C7 修复：用 `takeWhile` 方案替代 `return@collect`（return@collect 不停止外层 collect）。
 * 先保存终止事件，takeWhile 停止后单独 emit。
 *
 * Hilt 注入：@Singleton（与 LocalAgentService 对齐；依赖 WsClient/PanelEventRouter/scope 均为 @Singleton）。
 *
 * @param wsClient WebSocket 客户端
 * @param panelEventRouter 面板事件路由器（按 panelId 订阅 PiEvent）
 * @param scope 应用级 CoroutineScope（用于 disposeSession 异步发 WS 消息）
 */
@Singleton
class CloudAgentService @Inject constructor(
    private val wsClient: WsClient,
    private val panelEventRouter: PanelEventRouter,
    private val scope: CoroutineScope,
) : AgentService {

    /**
     * 发送消息到服务器 Pi Agent（Spec 6.5 节）。
     *
     * 流程：
     * 1. 检查 WS 状态（实时状态，非 debounced isServerOnline）
     * 2. 发送 [ClientMessage.UserMessage] 到服务器（仅 panelId + content）
     * 3. 订阅 [PanelEventRouter.getOrCreate] 该面板的事件流
     * 4. 用 takeWhile 收集非终止事件，再单独 emit 终止事件（TurnEnd / Error）
     * 5. 超时 120s（C8）：emit Error + 发 DisposeSession
     */
    override fun sendMessage(
        panelId: String,
        userMessage: String,
        thinkingLevel: ThinkingLevel,
    ): Flow<AgentEvent> = flow {
        // 1. 检查 WS 状态
        if (wsClient.state.value != WsState.CONNECTED) {
            emit(AgentEvent.Error("服务器未连接，请稍后重试或切换到本地模式", true))
            return@flow
        }

        // 2. 发送 UserMessage 到服务器（仅 panelId + content，见 5.1 节 C4 设计决策）
        val sent = wsClient.send(ClientMessage.UserMessage(panelId, userMessage))
        if (!sent) {
            emit(AgentEvent.Error("发送消息失败（WS 不可用）", true))
            return@flow
        }

        // 3. 订阅 PanelEventRouter 该面板的事件流
        //    服务器会下发：TurnStart → TextDelta* → ToolCallStart/End → TurnEnd
        //    用 takeWhile 收集非终止事件，再单独 emit 终止事件（C7 修复）
        //    超时 120s（C8：覆盖最坏情况）
        val events = panelEventRouter.getOrCreate(panelId)
        val terminalEvent = withTimeoutOrNull(120_000L) {
            // takeWhile 会在 predicate 为 false 时停止 collect，但不会 emit 那个让 predicate 失败的事件
            // 用 terminal 变量保存终止事件后单独 emit
            var terminal: AgentEvent? = null
            events.takeWhile { event ->
                val isTerminal = event is AgentEvent.TurnEnd || event is AgentEvent.Error
                if (isTerminal) {
                    terminal = event
                }
                !isTerminal  // 非终止时继续，终止时停止
            }.collect { event ->
                emit(event)  // emit 非终止事件
            }
            terminal  // 返回终止事件（null 表示 flow 被外部取消或超时）
        }

        when {
            terminalEvent == null -> {
                // 超时（120s 内没收到 TurnEnd/Error）
                emit(AgentEvent.Error("服务器响应超时（120s）", true))
                // C8：通知服务器释放 session，避免后续事件污染
                wsClient.send(ClientMessage.DisposeSession(panelId))
            }
            terminalEvent is AgentEvent.Error -> {
                emit(terminalEvent)  // emit Error 终止事件
                // 服务器侧 Error 后 session 可能不可用，主动清理
                wsClient.send(ClientMessage.DisposeSession(panelId))
            }
            else -> {
                emit(terminalEvent)  // emit TurnEnd
            }
        }
    }

    /**
     * C3 修复：销毁指定面板的 session。
     * - 本地：[panelEventRouter.dispose] 清理事件流
     * - 服务器：[wsClient.send]([ClientMessage.DisposeSession]) 通知服务器清理 session
     *   不发送则服务器侧 session 驻留 7 天才超时清理。
     */
    override fun disposeSession(panelId: String) {
        panelEventRouter.dispose(panelId)
        // 通过 scope.launch 异步发送（disposeSession 是非 suspend 方法）
        scope.launch {
            wsClient.send(ClientMessage.DisposeSession(panelId))
        }
    }

    /**
     * CLOUD 模式测试连接 = WS 是否已连接（忽略 config）。
     */
    override suspend fun testConnection(config: LlmProviderConfig): Boolean {
        return wsClient.state.value == WsState.CONNECTED
    }
}
