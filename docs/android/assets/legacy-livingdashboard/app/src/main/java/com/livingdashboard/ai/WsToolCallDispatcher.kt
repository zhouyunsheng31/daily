package com.livingdashboard.ai

import android.util.Log
import com.livingdashboard.sync.ClientMessage
import com.livingdashboard.sync.DeviceAuth
import com.livingdashboard.sync.ServerMessage
import com.livingdashboard.sync.WsClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import javax.inject.Inject
import javax.inject.Singleton

/**
 * WS 工具调用派发器（Spec 6.2 节）。
 *
 * 订阅 [WsClient.messages]，按 [ServerMessage] 类型分发：
 * - [ServerMessage.ToolCall] → [handleToolCall]：先 dispatch [AgentEvent.ToolCallStart]，
 *   再 [ToolRegistry.execute]（30s 超时），再 dispatch [AgentEvent.ToolCallEnd]，
 *   回传 [ClientMessage.ToolResult]（M9 修复：ToolCallStart/End 分开 dispatch）
 * - [ServerMessage.PiEvent] → [handlePiEvent]：根据 event.type 派发
 *   [AgentEvent.TextDelta]/[ThinkingDelta]/[TurnStart]/[TurnEnd]/[Error] 到 [PanelEventRouter]
 * - [ServerMessage.AskUser] → [handleAskUser]：调 [AskUserDialogState.showAndWait] 弹窗，
 *   用户响应后回传 [ClientMessage.AskUserResponse] + dispatch [AgentEvent.ToolCallEnd]
 * - [ServerMessage.SessionReady] / [ServerMessage.Error] / [ServerMessage.Pong] /
 *   [ServerMessage.Change] → 各自处理（log 或忽略）
 *
 * C5 风险注解：event.type 来自 pi-coding-agent SDK，需在实施首步用 logcat 抓取实际值后固化映射。
 * 临时映射：text_delta / thinking_delta / turn_start / turn_end / error。
 *
 * Hilt 注入：@Singleton（持有 Job 状态，App 级唯一实例；由 Application.onCreate 注入并调 [start]）。
 * 依赖均为 @Singleton：WsClient / ToolRegistry / DeviceAuth / PanelEventRouter / AskUserDialogState / CoroutineScope。
 *
 * @param wsClient WebSocket 客户端（订阅 messages，发送 ToolResult/AskUserResponse）
 * @param toolRegistry 工具注册表（执行 ToolCall）
 * @param deviceAuth 设备认证（多端路由过滤：targetDeviceId 校验）
 * @param panelEventRouter 面板事件路由器（dispatch AgentEvent 到 UI）
 * @param askUserDialogState AskUser 弹窗状态（处理 ask_user 工具下发）
 * @param scope 应用级 CoroutineScope（启动 ask_user 协程）
 */
@Singleton
class WsToolCallDispatcher @Inject constructor(
    private val wsClient: WsClient,
    private val toolRegistry: ToolRegistry,
    private val deviceAuth: DeviceAuth,
    private val panelEventRouter: PanelEventRouter,
    private val askUserDialogState: AskUserDialogState,
    private val scope: CoroutineScope,
) {
    private var job: Job? = null

    /** 启动派发（Application.onCreate 后由 Hilt 注入后自动启动） */
    fun start() {
        job?.cancel()
        job = scope.launch {
            wsClient.messages.collect { msg ->
                when (msg) {
                    is ServerMessage.ToolCall -> handleToolCall(msg)
                    is ServerMessage.PiEvent -> handlePiEvent(msg)
                    is ServerMessage.AskUser -> handleAskUser(msg)
                    is ServerMessage.Error -> handleError(msg)
                    is ServerMessage.SessionReady -> {
                        // 可选：通知 UI session 已就绪（M3 暂不处理）
                        Log.d(TAG, "Session ready: ${msg.sessionId}, panelId=${msg.panelId}")
                    }
                    is ServerMessage.Change -> {
                        // M5 任务，M3 暂不处理
                        Log.d(TAG, "Change event: ${msg.changeType}")
                    }
                    is ServerMessage.Pong -> {
                        // 心跳响应，无需处理
                    }
                }
            }
        }
    }

    /** 停止派发（Application.onTerminate 调） */
    fun stop() {
        job?.cancel()
        job = null
    }

    /**
     * 处理工具调用（Spec 6.2 节）。
     *
     * M9 修复：先 dispatch [AgentEvent.ToolCallStart]（让 UI 看到工具调用中间态），
     * 再执行工具，再 dispatch [AgentEvent.ToolCallEnd]。
     *
     * @param msg 服务器下发的 ToolCall 消息
     */
    private suspend fun handleToolCall(msg: ServerMessage.ToolCall) {
        // 1. 多端路由过滤：targetDeviceId 不为 null 且不等于本机 deviceId 则跳过
        val myDeviceId = deviceAuth.getDeviceId()
        if (msg.targetDeviceId != null && msg.targetDeviceId != myDeviceId) return

        // m8 修复：params 安全转换（避免类型不匹配 NPE）
        val params = (msg.params as? JsonObject) ?: JsonObject(emptyMap())

        // 2. 先 dispatch ToolCallStart（M9：让 UI 看到工具调用中间态）
        msg.panelId?.let { panelId ->
            panelEventRouter.dispatch(panelId, AgentEvent.ToolCallStart(
                callId = msg.requestId,
                toolName = msg.tool,
                args = params,
            ))
        }

        // 3. 执行工具（带 30s 超时，与服务器 TOOL_TIMEOUT_MS 对齐）
        val result = withTimeoutOrNull(30_000L) {
            toolRegistry.execute(msg.tool, params)
        } ?: ToolResult.error("tool timeout after 30s")

        // 4. 回传 ToolResult
        wsClient.send(ClientMessage.ToolResult(
            requestId = msg.requestId,
            success = result.success,
            data = result.data,
            error = result.error,
        ))

        // 5. 再 dispatch ToolCallEnd（M9：在工具执行完之后）
        msg.panelId?.let { panelId ->
            panelEventRouter.dispatch(panelId, AgentEvent.ToolCallEnd(
                callId = msg.requestId,
                success = result.success,
                result = result.error ?: result.data?.toString() ?: "",
            ))
        }
    }

    /**
     * 处理 Pi 事件（Spec 6.2 节）。
     *
     * 根据 event.type 派发 [AgentEvent] 到 [PanelEventRouter]。
     *
     * C5 风险注解：event.type 来自 pi-coding-agent SDK，需 logcat 验证。
     * m8 修复：msg.data 用 `as? JsonObject` 安全转换。
     *
     * @param msg 服务器下发的 PiEvent 消息
     */
    private fun handlePiEvent(msg: ServerMessage.PiEvent) {
        val panelId = msg.panelId ?: return
        // m8 修复：msg.data 安全转换（避免类型不匹配 NPE）
        val data = msg.data as? JsonObject ?: JsonObject(emptyMap())
        val event = when (msg.event) {
            "text_delta" -> {
                val text = data["text"]?.jsonPrimitive?.contentOrNull ?: return
                AgentEvent.TextDelta(text)
            }
            "thinking_delta" -> {
                val text = data["text"]?.jsonPrimitive?.contentOrNull ?: return
                AgentEvent.ThinkingDelta(text)
            }
            "turn_start" -> AgentEvent.TurnStart
            "turn_end" -> {
                val reason = data["finishReason"]?.jsonPrimitive?.contentOrNull
                AgentEvent.TurnEnd(reason ?: "stop")
            }
            "error" -> {
                val message = data["message"]?.jsonPrimitive?.contentOrNull ?: "unknown error"
                AgentEvent.Error(message, recoverable = false)
            }
            else -> {
                // C5：未知事件类型记 log，便于实施时抓取真实事件名固化映射
                Log.w(TAG, "unknown pi event type: ${msg.event}, data: $data")
                return
            }
        }
        panelEventRouter.dispatch(panelId, event)
    }

    /**
     * 处理 ask_user 弹窗请求（Spec 6.2 节 C1 新增）。
     *
     * 服务器 piBridge.ts 把 ask_user 作为独立 ServerMessage 下发。
     * 调 [AskUserDialogState.showAndWait] 弹窗，suspend 等待用户响应，
     * 把用户响应回传给服务器（[ClientMessage.AskUserResponse]），
     * 同时 dispatch [AgentEvent.ToolCallEnd] 让 UI 看到弹窗已响应。
     *
     * @param msg 服务器下发的 AskUser 消息
     */
    private fun handleAskUser(msg: ServerMessage.AskUser) {
        val panelId = msg.panelId ?: return
        val promptText = msg.prompt.ifBlank { msg.message ?: "" }
        // 转换 List<String> → List<JsonObject>（AskUserDialogState.showAndWait 接收 List<JsonObject>）
        val options = msg.options.map { s ->
            buildJsonObject {
                put("label", s)
                put("value", s)
            }
        }
        scope.launch {
            // 调 AskUserDialogState.showAndWait 弹窗，suspend 等待用户响应
            val userResponse: List<String>? = askUserDialogState.showAndWait(
                question = promptText,
                options = options,
                allowMultiple = msg.allowMultiple,
            )

            // 把用户响应回传给服务器（作为 ask_user_response）
            val dataJson = buildJsonObject {
                if (userResponse == null) {
                    put("type", "cancelled")
                } else {
                    put("type", "selected")
                    putJsonArray("values") {
                        userResponse.forEach { add(it) }
                    }
                }
            }
            wsClient.send(ClientMessage.AskUserResponse(
                requestId = msg.requestId,
                success = userResponse != null,
                data = dataJson,
                panelId = panelId,
            ))

            // 同时派发 ToolCallEnd 到 PanelEventRouter 让 UI 看到弹窗已响应
            panelEventRouter.dispatch(panelId, AgentEvent.ToolCallEnd(
                callId = msg.requestId,
                success = userResponse != null,
                result = if (userResponse != null) {
                    "ask_user: selected ${userResponse.size} item(s)"
                } else {
                    "ask_user: cancelled"
                },
            ))
        }
    }

    /**
     * 处理服务器错误消息（Spec 6.2 节）。
     *
     * 派发 [AgentEvent.Error]（recoverable=true，UI 给出重试按钮）到 [PanelEventRouter]。
     */
    private fun handleError(msg: ServerMessage.Error) {
        val panelId = msg.panelId ?: return
        panelEventRouter.dispatch(panelId, AgentEvent.Error(msg.message, recoverable = true))
    }

    companion object {
        private const val TAG = "WsToolCallDispatcher"
    }
}
