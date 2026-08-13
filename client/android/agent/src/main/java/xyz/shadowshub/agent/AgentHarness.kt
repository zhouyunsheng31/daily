package xyz.shadowshub.agent

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import xyz.shadowshub.core.agent.AgentBridgeClient
import xyz.shadowshub.core.agent.AgentChatSource

/**
 * Agent Harness 宿主（agent/ 模块门面，D15 端侧 pi）。
 *
 * 组合：HarnessProcessManager（进程生命周期）+ AgentBridgeClient（JSON-RPC 桥）。
 * 对外暴露：
 * - startAndPing()：启动 Node 进程并探活（含指数退避重启）
 * - source：对话源（turn/abort/ping）
 * - stop()：显式停止
 *
 * BYOK 密钥经 HarnessConfig.env 注入（Keystore 解出后由上层构造），不落盘、不记日志。
 */
class AgentHarness(
    private val processManager: HarnessProcessManager,
    private val scope: CoroutineScope,
) {
    val bridge = AgentBridgeClient(sendLine = processManager::sendLine)
    val source = AgentChatSource(bridge)

    private var pingJob: kotlinx.coroutines.Job? = null

    init {
        // stdout 行驱动桥客户端
        processManager.lineListener = { line -> bridge.onLine(line) }
    }

    /**
     * 启动进程并 ping 探活；失败按指数退避重启（最多 maxAttempts）。
     * 返回 true = Ready（可对话）。
     */
    suspend fun startAndPing(maxAttempts: Int = 5): Boolean {
        var attempt = 0
        while (attempt < maxAttempts) {
            attempt++
            if (processManager.state.value is HarnessState.Ready) return true
            if (!processManager.start()) {
                delay(1_000L * attempt)
                continue
            }
            // 等 init（pi 资源加载约 8-10s），轮询 ping
            val deadline = System.currentTimeMillis() + 30_000L
            while (System.currentTimeMillis() < deadline) {
                val ok = runCatching { source.ping() }.getOrDefault(false)
                if (ok) {
                    processManager.markReady()
                    return true
                }
                delay(1_000L)
            }
        }
        return false
    }

    /** 后台看门狗：进程意外退出（Crashed）自动重启并重新探活 */
    fun startWatchdog() {
        pingJob?.cancel()
        pingJob = scope.launch {
            processManager.state.collect { st ->
                if (st is HarnessState.Crashed) {
                    startAndPing()
                }
            }
        }
    }

    fun stop() {
        pingJob?.cancel()
        bridge.onClosed("stopped")
        processManager.stop()
    }
}