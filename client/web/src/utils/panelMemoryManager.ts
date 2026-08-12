// Phase 6.1：面板内存休眠管理器（spec 第 1 节）
// 三级状态模型：active → background → hibernated → deep-hibernated
// - active：当前激活的面板（仅一个）
// - background：切换到其他面板（组件树保留内存）
// - hibernated：后台超 5 分钟 或 内存达 1.5GB（卸载组件树，状态存数据库）
// - deep-hibernated：内存达 2GB（只保留面板元数据，清空 panelWidgets/panelPositions）
//
// LRU 策略：内存压力下优先休眠 lastActiveAt 最早的后台面板
// 内存监控：通过 window.memoryApi.getMemoryUsage() IPC 获取主进程内存（spec 第 7 节）

export type PanelMemoryStatus = 'active' | 'background' | 'hibernated' | 'deep-hibernated'

export interface PanelSavedState {
  webviewUrl?: string
  webviewScrollY?: number
  widgetStates?: Record<string, unknown>
}

export interface PanelMemoryState {
  panelId: string
  status: PanelMemoryStatus
  lastActiveAt: number
  backgroundSince: number | null
  widgetCount: number
  estimatedMemoryBytes: number
  savedState: PanelSavedState | null
}

export interface PanelMemoryManagerConfig {
  hibernateAfterMs: number
  hibernateMemoryThresholdBytes: number
  deepHibernateThresholdBytes: number
  memoryCheckIntervalMs: number
}

type StateChangeListener = (panelId: string, state: PanelMemoryState) => void

const DEFAULT_CONFIG: PanelMemoryManagerConfig = {
  hibernateAfterMs: 5 * 60 * 1000,
  hibernateMemoryThresholdBytes: 1.5 * 1024 * 1024 * 1024,
  deepHibernateThresholdBytes: 2 * 1024 * 1024 * 1024,
  memoryCheckIntervalMs: 30 * 1000,
}

class PanelMemoryManager {
  private states = new Map<string, PanelMemoryState>()
  private listeners = new Set<StateChangeListener>()
  private memoryCheckInterval: ReturnType<typeof setInterval> | null = null
  private config: PanelMemoryManagerConfig = { ...DEFAULT_CONFIG }
  private started = false
  // Phase 6.1：正在恢复中的面板集合（用于骨架屏显示，spec 第 5 节"恢复时显示骨架屏，无白屏"）
  private restoringPanels = new Set<string>()

  // ========== 面板注册/注销 ==========

  /** 注册面板（addPanel/initialize 时调用） */
  registerPanel(panelId: string, widgetCount = 0): void {
    const existing = this.states.get(panelId)
    if (existing) {
      // 已存在，仅更新 widgetCount
      existing.widgetCount = widgetCount
      return
    }
    const now = Date.now()
    const state: PanelMemoryState = {
      panelId,
      status: 'background',
      lastActiveAt: now,
      backgroundSince: now,
      widgetCount,
      estimatedMemoryBytes: 0,
      savedState: null,
    }
    this.states.set(panelId, state)
    this.notifyListeners(panelId, state)
  }

  /** 注销面板（deletePanel 时调用，清理本地状态） */
  unregisterPanel(panelId: string): void {
    const state = this.states.get(panelId)
    this.states.delete(panelId)
    if (state) {
      // 通知监听器面板已移除（status 设为 deep-hibernated 表示已清理）
      this.notifyListeners(panelId, { ...state, status: 'deep-hibernated' })
    }
  }

  // ========== 状态切换 ==========

  /** 标记面板为活跃（setActivePanel 时调用） */
  markActive(panelId: string): void {
    const now = Date.now()
    // 将之前的 active 面板降级为 background
    for (const [pid, state] of this.states) {
      if (pid !== panelId && state.status === 'active') {
        state.status = 'background'
        state.backgroundSince = now
        this.notifyListeners(pid, state)
      }
    }
    // 标记新面板为 active
    const state = this.states.get(panelId)
    if (state) {
      state.status = 'active'
      state.lastActiveAt = now
      state.backgroundSince = null
      // 恢复时清空 savedState（已恢复到内存）
      state.savedState = null
      this.notifyListeners(panelId, state)
    } else {
      // 未注册则自动注册为 active
      const newState: PanelMemoryState = {
        panelId,
        status: 'active',
        lastActiveAt: now,
        backgroundSince: null,
        widgetCount: 0,
        estimatedMemoryBytes: 0,
        savedState: null,
      }
      this.states.set(panelId, newState)
      this.notifyListeners(panelId, newState)
    }
  }

  /** 标记面板为后台（setActivePanel 切换其他面板时，原面板自动降级） */
  markBackground(panelId: string): void {
    const state = this.states.get(panelId)
    if (!state) return
    if (state.status === 'active') {
      state.status = 'background'
      state.backgroundSince = Date.now()
      this.notifyListeners(panelId, state)
    }
  }

  // ========== 状态查询 ==========

  getPanelState(panelId: string): PanelMemoryState | null {
    return this.states.get(panelId) ?? null
  }

  getAllStates(): PanelMemoryState[] {
    return Array.from(this.states.values())
  }

  /** 是否处于休眠状态（hibernated 或 deep-hibernated） */
  isHibernated(panelId: string): boolean {
    const state = this.states.get(panelId)
    return state?.status === 'hibernated' || state?.status === 'deep-hibernated'
  }

  // ========== 强制休眠/恢复 ==========

  /** 强制休眠面板（卸载组件树，状态存数据库） */
  forceHibernate(panelId: string): PanelMemoryState | null {
    const state = this.states.get(panelId)
    if (!state) return null
    if (state.status === 'active') {
      // 活跃面板不能直接休眠，先降级为 background
      state.status = 'background'
      state.backgroundSince = Date.now()
    }
    if (state.status === 'background' || state.status === 'deep-hibernated') {
      state.status = 'hibernated'
      this.notifyListeners(panelId, state)
    }
    return state
  }

  /** 强制深度休眠面板（清空 panelWidgets/panelPositions） */
  forceDeepHibernate(panelId: string): PanelMemoryState | null {
    const state = this.states.get(panelId)
    if (!state) return null
    if (state.status === 'active') {
      state.status = 'background'
      state.backgroundSince = Date.now()
    }
    state.status = 'deep-hibernated'
    this.notifyListeners(panelId, state)
    return state
  }

  /** 恢复面板（从 hibernated/deep-hibernated 恢复到 background，由 setActivePanel 触发 markActive） */
  restorePanel(panelId: string): PanelMemoryState | null {
    const state = this.states.get(panelId)
    if (!state) return null
    if (state.status === 'hibernated' || state.status === 'deep-hibernated') {
      // Phase 6.1：标记为恢复中，Workspace 据此显示骨架屏（spec 第 5 节"恢复时显示骨架屏，无白屏"）
      this.restoringPanels.add(panelId)
      state.status = 'background'
      state.backgroundSince = Date.now()
      this.notifyListeners(panelId, state)
    }
    return state
  }

  /** 查询面板是否正在恢复中（用于骨架屏显示） */
  isRestoring(panelId: string): boolean {
    return this.restoringPanels.has(panelId)
  }

  /** 标记面板恢复完成（由 Workspace 在 widgets 渲染完成后调用） */
  markRestored(panelId: string): void {
    if (this.restoringPanels.delete(panelId)) {
      const state = this.states.get(panelId)
      if (state) {
        this.notifyListeners(panelId, state)
      }
    }
  }

  // ========== 状态变更监听 ==========

  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners(panelId: string, state: PanelMemoryState): void {
    for (const listener of this.listeners) {
      try {
        listener(panelId, state)
      } catch (err) {
        console.error('[PanelMemoryManager] State change listener error:', err)
      }
    }
  }

  // ========== 内存监控与自动休眠 ==========

  /** 启动内存监控定时器（App.tsx 初始化后调用） */
  start(): void {
    if (this.started) return
    this.started = true
    this.memoryCheckInterval = setInterval(() => {
      void this.checkMemoryAndHibernate()
    }, this.config.memoryCheckIntervalMs)
    // 不 unref，确保定时器能正常运行
    console.log('[PanelMemoryManager] Started, check interval:', this.config.memoryCheckIntervalMs, 'ms')
  }

  /** 停止内存监控（destroy 时调用） */
  stop(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval)
      this.memoryCheckInterval = null
    }
    this.started = false
    console.log('[PanelMemoryManager] Stopped')
  }

  /** 更新配置（updateBehavior 时调用） */
  updateConfig(partial: Partial<PanelMemoryManagerConfig>): void {
    const oldInterval = this.config.memoryCheckIntervalMs
    this.config = { ...this.config, ...partial }
    // 如果检查间隔变化且正在运行，重启定时器
    if (this.started && this.config.memoryCheckIntervalMs !== oldInterval) {
      this.stop()
      this.start()
    }
  }

  /** 获取主进程内存使用（通过 IPC，spec 第 7 节） */
  async getMemoryUsage(): Promise<{ rss: number; heapUsed: number; heapTotal: number; external: number } | null> {
    try {
      if (typeof window !== 'undefined' && window.memoryApi?.getMemoryUsage) {
        return await window.memoryApi.getMemoryUsage()
      }
    } catch (err) {
      console.error('[PanelMemoryManager] getMemoryUsage failed:', err)
    }
    return null
  }

  /** 内存检查 + 自动休眠（定时器回调） */
  private async checkMemoryAndHibernate(): Promise<void> {
    const mem = await this.getMemoryUsage()
    if (!mem) return

    const now = Date.now()
    const rss = mem.rss

    // 1. 时间触发：后台面板超过 hibernateAfterMs 自动休眠
    for (const [panelId, state] of this.states) {
      if (state.status === 'background' && state.backgroundSince !== null) {
        if (now - state.backgroundSince >= this.config.hibernateAfterMs) {
          this.forceHibernate(panelId)
        }
      }
    }

    // 2. 内存压力触发：rss 超过 deepHibernateThresholdBytes，深度休眠最早的后台/休眠面板
    if (rss >= this.config.deepHibernateThresholdBytes) {
      this.deepHibernateByLru()
    } else if (rss >= this.config.hibernateMemoryThresholdBytes) {
      // 3. 内存压力触发：rss 超过 hibernateMemoryThresholdBytes，休眠最早的后台面板
      this.hibernateByLru()
    }
  }

  /** LRU 策略：休眠最早的后台面板 */
  private hibernateByLru(): void {
    const candidates = Array.from(this.states.values())
      .filter(s => s.status === 'background')
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    if (candidates.length === 0) return
    // 休眠最早的一个
    const target = candidates[0]
    this.forceHibernate(target.panelId)
    console.log(`[PanelMemoryManager] LRU hibernate panel: ${target.panelId} (lastActive: ${new Date(target.lastActiveAt).toISOString()})`)
  }

  /** LRU 策略：深度休眠最早的后台/休眠面板 */
  private deepHibernateByLru(): void {
    const candidates = Array.from(this.states.values())
      .filter(s => s.status === 'background' || s.status === 'hibernated')
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    if (candidates.length === 0) return
    const target = candidates[0]
    this.forceDeepHibernate(target.panelId)
    console.log(`[PanelMemoryManager] LRU deep-hibernate panel: ${target.panelId} (lastActive: ${new Date(target.lastActiveAt).toISOString()})`)
  }

  // ========== WebView 状态保存/恢复接口 ==========
  // 实际保存/恢复逻辑由 panelStatePersistence.ts 实现，管理器仅提供 savedState 存储

  /** 设置面板的已保存状态（panelStatePersistence.savePanelState 完成后调用） */
  setSavedState(panelId: string, savedState: PanelSavedState): void {
    const state = this.states.get(panelId)
    if (state) {
      state.savedState = savedState
    }
  }

  /** 获取面板的已保存状态（panelStatePersistence.restorePanel 调用） */
  getSavedState(panelId: string): PanelSavedState | null {
    const state = this.states.get(panelId)
    return state?.savedState ?? null
  }

  /** 更新 widget 数量（addWidget/removeWidget 时调用） */
  updateWidgetCount(panelId: string, widgetCount: number): void {
    const state = this.states.get(panelId)
    if (state) {
      state.widgetCount = widgetCount
    }
  }
}

// 导出单例
export const panelMemoryManager = new PanelMemoryManager()
