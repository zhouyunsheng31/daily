package xyz.shadowshub.agent

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.BufferedWriter
import java.io.File

/**
 * harness 进程配置（D15 端侧 pi 宿主）。
 *
 * command 是可配置的完整启动命令，例如：
 * - 直接 node（开发/本机验证）：["node", "/path/harness/src/main.js"]
 * - proot 包装（真机）：["proot", "-0", "-r", "/data/.../rootfs", "-b", "/sdcard:/sdcard",
 *   "-w", "/sdcard/daily/agent", "/usr/bin/env", "BYOK_BASE_URL=...", "BYOK_API_KEY=...", "node", "/sdcard/daily/agent/harness/src/main.js"]
 *
 * BYOK 密钥经 env 注入（Keystore 解出后由上层拼入），进程内存可见，不落盘。
 */
data class HarnessConfig(
    val command: List<String>,
    val env: Map<String, String> = emptyMap(),
    val workingDir: File? = null,
)

sealed class HarnessState {
    data object Stopped : HarnessState()
    data object Starting : HarnessState()
    data object Ready : HarnessState()
    data class Crashed(val reason: String, val attempt: Int) : HarnessState()
}

/**
 * harness Node 进程生命周期管理（agent/ 模块，M0-2/M1）。
 *
 * - start()：ProcessBuilder 启动，stdout/stderr 独立读行线程（协程 IO）
 * - stdout 每行 → onLine（桥客户端）；stderr → onLog（诊断，不进协议流）
 * - 退出监听：非显式 stop 时进入 Crashed，由上层按指数退避重启
 * - sendLine()：stdin 写出（线程安全）
 */
class HarnessProcessManager(
    private val config: HarnessConfig,
    private val scope: CoroutineScope,
    private val onLog: (String) -> Unit = {},
) {
    /** stdout 行监听器（由桥客户端接入；进程启动后每行回调） */
    var lineListener: ((String) -> Unit)? = null
    private val _state = MutableStateFlow<HarnessState>(HarnessState.Stopped)
    val state: StateFlow<HarnessState> = _state.asStateFlow()

    private var process: Process? = null
    private var stdinWriter: BufferedWriter? = null
    private var stdoutJob: Job? = null
    private var stderrJob: Job? = null
    private var exitJob: Job? = null
    private var stopRequested = false
    private val stdinLock = Any()

    /** 启动进程（幂等：已在运行则返回 false） */
    fun start(): Boolean {
        val current = process
        if (current != null && current.isAlive) return false
        stopRequested = false
        _state.value = HarnessState.Starting
        return runCatching {
            val pb = ProcessBuilder(config.command)
            config.workingDir?.let { pb.directory(it) }
            pb.environment().putAll(config.env)
            pb.redirectErrorStream(false)
            val p = pb.start()
            process = p
            stdinWriter = p.outputStream.bufferedWriter()
            stdoutJob = scope.launch(Dispatchers.IO) {
                p.inputStream.bufferedReader().forEachLine { line -> lineListener?.invoke(line) }
            }
            stderrJob = scope.launch(Dispatchers.IO) {
                p.errorStream.bufferedReader().forEachLine { line -> onLog(line) }
            }
            exitJob = scope.launch(Dispatchers.IO) {
                val code = p.waitFor()
                onExit(code)
            }
            true
        }.getOrElse { e ->
            process = null
            _state.value = HarnessState.Crashed(e.message ?: "start failed", 0)
            false
        }
    }

    /** 向 stdin 写一行（JSON-RPC 请求），线程安全 */
    fun sendLine(line: String): Boolean {
        synchronized(stdinLock) {
            val w = stdinWriter ?: return false
            return runCatching {
                w.write(line)
                w.newLine()
                w.flush()
                true
            }.getOrElse { false }
        }
    }

    /** 由上层在 ping 成功后调用，标记进程就绪 */
    fun markReady() {
        _state.value = HarnessState.Ready
    }

    /** 显式停止（不触发重启） */
    fun stop() {
        stopRequested = true
        runCatching { process?.destroy() }
        stdoutJob?.cancel()
        stderrJob?.cancel()
        exitJob?.cancel()
        process = null
        stdinWriter = null
        _state.value = HarnessState.Stopped
    }

    /** 指数退避重启（Crashed 后由上层调用；成功收到 ping 后调用方负责停止重试） */
    suspend fun restartWithBackoff(
        maxAttempts: Int = 5,
        baseDelayMs: Long = 500,
        maxDelayMs: Long = 8_000,
    ): Boolean {
        var attempt = 0
        while (attempt < maxAttempts && scope.isActive) {
            attempt++
            if (start()) return true
            val delayMs = (baseDelayMs * (1L shl (attempt - 1))).coerceAtMost(maxDelayMs)
            _state.value = HarnessState.Crashed("restart failed (attempt $attempt)", attempt)
            delay(delayMs)
        }
        return false
    }

    private fun onExit(code: Int) {
        val p = process ?: return
        process = null
        stdinWriter = null
        if (stopRequested) {
            _state.value = HarnessState.Stopped
            return
        }
        _state.value = HarnessState.Crashed("process exited with code $code", 0)
    }
}