package com.livingdashboard

import android.app.Application
import com.livingdashboard.ai.KvStorage
import com.livingdashboard.ai.WsToolCallDispatcher
import com.livingdashboard.data.repository.CanvasRepository
import com.livingdashboard.data.repository.UserScriptRepository
import com.livingdashboard.sync.WsClient
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * LivingDashboardApp（Spec 8.3 节 M2 改造 + M3 C1 修复）。
 *
 * M2 改造点：
 * - 保留 M0/M1 的 WS 连接（wsClient.connect()）
 * - 注入 CanvasRepository，在 onCreate 中确保聚合面板存在（D12）
 *
 * M3 C1 修复（对抗审查 Critical）：
 * - 注入 WsToolCallDispatcher 并在 onCreate 调用 start()
 * - 否则 ServerMessage.ToolCall/PiEvent/AskUser 永远不被派发，CLOUD 模式完全失效
 *
 * 聚合面板自动创建逻辑：
 * 1. App 启动时用 appScope（SupervisorJob + IO）启动协程
 * 2. 调用 canvasRepository.getAggregatePanel() 查询是否已存在
 * 3. 如果为 null，调用 canvasRepository.createAggregatePanel() 创建
 *
 * 用 appScope 而非 viewModelScope / lifecycleScope：
 * - Application 没有 ViewModel 持有作用域
 * - SupervisorJob 保证一个子任务失败不影响其他任务
 * - Dispatchers.IO 因涉及 Room 数据库写入
 */
@HiltAndroidApp
class LivingDashboardApp : Application() {
    @Inject lateinit var wsClient: WsClient
    @Inject lateinit var canvasRepository: CanvasRepository
    @Inject lateinit var wsToolCallDispatcher: WsToolCallDispatcher
    @Inject lateinit var kvStorage: KvStorage              // M4 新增（Spec 2.7.3）
    @Inject lateinit var userScriptRepository: UserScriptRepository  // M4 新增（Spec 2.7.3）

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        // M0/M1 保留：App 启动即建立 WS 连接（全局单例，生命周期跟随 Application）
        wsClient.connect()

        // M3 C1 修复：启动 WS 工具调用派发器（监听 WsClient.messages，按 ServerMessage 类型派发）
        // 必须在 wsClient.connect() 之后调用，否则订阅 SharedFlow 时无生产者
        wsToolCallDispatcher.start()

        // M2 新增：确保聚合面板存在（D12，spec 8.3 节）
        // v4 #17：createAggregatePanel 已在 CanvasRepository 类内部定义（见 4.8 节），此处只调用
        appScope.launch {
            val aggregate = canvasRepository.getAggregatePanel()
            if (aggregate == null) {
                canvasRepository.createAggregatePanel()
            }
            // 修复：首次启动若不存在普通面板（type != AGGREGATE），创建默认面板"我的画布"
            // 否则 currentPanelId 为 null，圆形图标点击和下滑手势等画布入口全部失效
            val normalPanel = canvasRepository.getNormalPanel()
            if (normalPanel == null) {
                canvasRepository.createPanel("我的画布")
            }
            // v4 #4：缓存聚合面板 ID 的逻辑由 observeAggregateWidgets 用 Flow 自动处理（v5 #N8）

            // M4 新增（Spec 2.7.3）：预加载 KV 和脚本到内存缓存
            // - kvStorage.preload()：GM_getValue 同步读用（preload 完成前返回 defaultValue）
            // - userScriptRepository.preload()：ScriptInjector.snapshot() 用，避免每次注入都查 DB
            kvStorage.preload()
            userScriptRepository.preload()
        }
    }
}
