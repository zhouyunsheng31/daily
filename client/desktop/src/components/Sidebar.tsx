// Sidebar 组件（侧边栏面板库 + AI 助手切换）
// Phase 8 批次4：增加 sidebarMode 切换（canvas 画布面板 / ai-assistant AI 助手）
// 按 Phase 2 Spec 2.2 节实现：header/panel-list/折叠/footer，整合模板和自动布局按钮
// 关键约束（M3）：不抽取 SidebarCollapsed / CanvasSidebar 子组件，折叠态和展开态逻辑保留在原文件内
// 关键约束（m4）：用 sidebarWidth 判断折叠态，不用 sidebarCollapsed
import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { showContextMenu } from '../utils/contextMenu'
import { Plus, LayoutGrid, Sparkles, PanelLeftClose, PanelLeftOpen, Bot, Cloud, HardDrive, X } from 'lucide-react'
import { getBuiltinPanelTemplates } from '../utils/dbStores/panelTemplates'
import type { PanelTemplate } from '../types'
import AIAssistantSidebar from './AIAssistantSidebar'
// Phase 9 批次 3 模块 7：Sidebar 加 Agent 切换快捷入口（小图标循环切换）
import { useRuntimeModeStore, type RuntimeMode } from '../stores/useRuntimeModeStore'
// Phase 15 batch4 task4.2: tooltip show shortcut keys
import { getShortcutKeys } from '../hooks/useKeyboardShortcuts'

export default function Sidebar() {
  // 订阅 store
  const panels = useAppStore(s => s.panels)
  const activePanelId = useAppStore(s => s.activePanelId)
  const setActivePanel = useAppStore(s => s.setActivePanel)
  const addPanel = useAppStore(s => s.addPanel)
  const deletePanel = useAppStore(s => s.deletePanel)
  const renamePanel = useAppStore(s => s.renamePanel)
  const addPanelFromTemplate = useAppStore(s => s.addPanelFromTemplate)
  const autoLayoutPanel = useAppStore(s => s.autoLayoutPanel)
  // 批次1: 改为订阅 sidebarWidth，根据 sidebarWidth <= 48 派生折叠态
  const sidebarWidth = useAppStore(s => s.sidebarWidth)
  const toggleSidebar = useAppStore(s => s.toggleSidebar)
  const setMainView = useAppStore(s => s.setMainView)  // Phase 4: 点击面板时设置 mainView
  const collapsed = sidebarWidth <= 48  // 折叠态阈值（与 toggleSidebar 切换逻辑一致）
  // 批次4: sidebarMode 切换
  const sidebarMode = useAppStore(s => s.sidebarMode)
  const setSidebarMode = useAppStore(s => s.setSidebarMode)

  // 模板 popover 状态
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false)
  const [templates, setTemplates] = useState<PanelTemplate[]>([])

  useEffect(() => {
    if (templatePopoverOpen) {
      getBuiltinPanelTemplates().then(setTemplates).catch(() => setTemplates([]))
    }
  }, [templatePopoverOpen])

  const handleTemplateClick = async (templateId: string) => {
    // Phase 4: 从模板创建面板后，显示画布主页
    try {
      await addPanelFromTemplate(templateId)
      // addPanelFromTemplate 内部会 setActivePanel，创建后跳转到画布主页
      const newActiveId = useAppStore.getState().activePanelId
      if (newActiveId) {
        setMainView({ type: 'canvas-home', panelId: newActiveId })
      }
    } catch (err) {
      console.error(err)
    }
    setTemplatePopoverOpen(false)
  }

  const handleAutoLayout = () => {
    autoLayoutPanel()
  }

  // Phase 4 任务 8：新建画布面板 → 显示画布主页
  const handleNewPanel = async () => {
    try {
      const newPanelId = await addPanel('新面板')
      setMainView({ type: 'canvas-home', panelId: newPanelId })
    } catch (err) {
      console.error(err)
    }
  }

  // Phase 4 任务 2：点击面板 → 切换 activePanel + 显示画布面板
  const handlePanelClick = async (panelId: string) => {
    try {
      await setActivePanel(panelId)
      setMainView({ type: 'canvas-panel', panelId })
    } catch (err) {
      console.error(err)
    }
  }

  // Phase 9 批次 3 模块 7：Agent 切换快捷入口
  // 在 Sidebar canvas 模式 footer 区域加一个小图标按钮，点击循环切换 cloud→local→auto→cloud
  // 显示当前 effectiveMode 对应的图标（用户选 auto 时显示实际生效模式图标）
  const runtimeMode = useRuntimeModeStore(s => s.mode)
  const effectiveMode = useRuntimeModeStore(s => s.effectiveMode)
  const setRuntimeMode = useRuntimeModeStore(s => s.setMode)
  const isOfflineDowngraded = useRuntimeModeStore(s => s.isOfflineDowngraded)

  const handleCycleRuntimeMode = () => {
    // 循环顺序：cloud → local → auto → cloud
    const order: RuntimeMode[] = ['cloud', 'local', 'auto']
    const currentIdx = order.indexOf(runtimeMode)
    const nextIdx = (currentIdx + 1) % order.length
    setRuntimeMode(order[nextIdx])
  }

  // 根据实际生效模式选图标（用户选 auto 时显示实际生效的模式图标）
  const RuntimeModeIcon = effectiveMode === 'cloud' ? Cloud : HardDrive
  // tooltip 显示用户选择 + 实际生效模式
  const runtimeModeTooltip = `当前 Agent 模式：${runtimeMode}${
    runtimeMode === 'auto' ? `（实际生效：${effectiveMode}）` : ''
  }${isOfflineDowngraded ? ' [离线降级]' : ''}（点击循环切换）`

  // ============ 折叠态：只显示一个图标，点击整个条带展开 ============
  // L2 修复：折叠态不显示 toggle 按钮，只显示一个图标
  if (collapsed) {
    return (
      <aside
        className="panel-sidebar panel-sidebar--collapsed"
        style={{ width: sidebarWidth, minWidth: sidebarWidth, cursor: 'pointer' }}
        onClick={toggleSidebar}
        title={sidebarMode === 'canvas' ? '展开侧边栏（画布面板）' : '展开侧边栏（AI 助手）'}
      >
        <div className="panel-sidebar__header" style={{ justifyContent: 'center' }}>
          {sidebarMode === 'canvas' ? (
            <PanelLeftOpen size={16} />
          ) : (
            <Bot size={16} />
          )}
        </div>
      </aside>
    )
  }

  // ============ 展开态：顶部 toggle + 条件渲染 ============
  return (
    <aside
      className="panel-sidebar"
      style={{ width: sidebarWidth, minWidth: sidebarWidth }}
    >
      {/* ===== 顶部 toggle 按钮组 + 折叠按钮 ===== */}
      <div
        style={{
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: '1px solid var(--border-default)',
          flexShrink: 0,
        }}
      >
        {/* toggle 容器：rgba(0,0,0,0.03) 背景，圆角 10px，padding 4px */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            background: 'rgba(0,0,0,0.03)',
            borderRadius: 10,
            padding: 4,
            gap: 2,
          }}
        >
          {/* 画布面板按钮 */}
          <button
            type="button"
            onClick={() => setSidebarMode('canvas')}
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '8px 16px',
              background: sidebarMode === 'canvas' ? 'rgba(0,0,0,0.08)' : 'transparent',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              transition: 'background 0.2s ease-in-out',
            }}
            onMouseEnter={(e) => {
              if (sidebarMode !== 'canvas') e.currentTarget.style.background = 'rgba(0,0,0,0.05)'
            }}
            onMouseLeave={(e) => {
              if (sidebarMode !== 'canvas') e.currentTarget.style.background = 'transparent'
            }}
            title="画布面板"
          >
            <PanelLeftOpen size={12} />
            <span>画布面板</span>
          </button>

          {/* AI 助手按钮 */}
          <button
            type="button"
            onClick={() => setSidebarMode('ai-assistant')}
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '8px 16px',
              background: sidebarMode === 'ai-assistant' ? 'rgba(0,0,0,0.08)' : 'transparent',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              transition: 'background 0.2s ease-in-out',
            }}
            onMouseEnter={(e) => {
              if (sidebarMode !== 'ai-assistant') e.currentTarget.style.background = 'rgba(0,0,0,0.05)'
            }}
            onMouseLeave={(e) => {
              if (sidebarMode !== 'ai-assistant') e.currentTarget.style.background = 'transparent'
            }}
            title="AI 助手"
          >
            <Bot size={12} />
            <span>AI助手</span>
          </button>
        </div>

        {/* 折叠按钮 */}
        <button
          className="panel-sidebar__collapse-btn"
          onClick={toggleSidebar}
          title="折叠侧边栏"
          style={{ flexShrink: 0 }}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* ===== 条件渲染：canvas 模式 / ai-assistant 模式 ===== */}
      {sidebarMode === 'ai-assistant' ? (
        // AI 助手形态：渲染 AIAssistantSidebar（占据剩余空间）
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <AIAssistantSidebar />
        </div>
      ) : (
        // 画布面板形态：保留原 panel-list + footer 逻辑（不变）
        <>
          {/* panel-list 区域：面板列表 */}
          <div className="panel-sidebar__panel-list">
            {panels.map(panel => (
              <div
                key={panel.id}
                className={`panel-sidebar__panel-item ${panel.id === activePanelId ? 'panel-sidebar__panel-item--active' : ''}`}
                onClick={() => handlePanelClick(panel.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  const items: Array<{ label: string; onClick: () => void | Promise<void> }> = [
                    { label: '重命名', onClick: () => {
                      const newName = window.prompt('新名称', panel.name)
                      if (newName && newName.trim()) renamePanel(panel.id, newName.trim()).catch(console.error)
                    }},
                    { label: '删除', onClick: () => deletePanel(panel.id).catch(console.error) },
                    { label: '复制', onClick: () => addPanel(`${panel.name} 副本`).catch(console.error) },
                  ]
                  // panel.settings 是必需字段，不用可选链
                  if (panel.settings.url) {
                    items.push({
                      label: '转换为网页组件',
                      onClick: () => useAppStore.getState().convertTabToWidget(panel.id).catch(err => window.alert((err as Error).message)),
                    })
                  }
                  showContextMenu(e, items)
                }}
              >
                <span className="panel-sidebar__panel-name">{panel.name}</span>
                <button
                  type="button"
                  className="panel-sidebar__panel-delete"
                  onClick={(e) => { e.stopPropagation(); deletePanel(panel.id).catch(console.error) }}
                  title="删除面板"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* footer 区域：新建/模板/自动布局按钮 */}
          <div className="panel-sidebar__footer">
            <button
              className="panel-sidebar__footer-btn"
              onClick={handleNewPanel}
              title={`新建面板 (${getShortcutKeys('new-canvas-panel')})`}
            >
              <Plus size={14} /> 新建面板
            </button>
            {/* 从 UnifiedToolbar 迁移的模板按钮 */}
            <button
              className="panel-sidebar__footer-btn"
              onClick={() => setTemplatePopoverOpen(!templatePopoverOpen)}
              title="从模板创建面板"
            >
              <LayoutGrid size={14} /> 模板
            </button>
            {/* 从 UnifiedToolbar 迁移的自动布局按钮 */}
            <button
              className="panel-sidebar__footer-btn"
              onClick={handleAutoLayout}
              title="自动布局所有面板"
            >
              <Sparkles size={14} /> 自动布局
            </button>
            {templatePopoverOpen && (
              <div className="panel-sidebar__template-popover">
                {templates.map(t => (
                  <div
                    key={t.id}
                    className="panel-sidebar__template-item"
                    onClick={() => handleTemplateClick(t.id)}
                  >
                    {t.name}
                  </div>
                ))}
              </div>
            )}
            {/* Phase 9 批次 3 模块 7：Agent 切换快捷入口
                小图标按钮，点击循环切换 cloud→local→auto→cloud
                显示当前 effectiveMode 对应的图标
                离线降级时显示警告色 */}
            <button
              type="button"
              onClick={handleCycleRuntimeMode}
              title={runtimeModeTooltip}
              aria-label={`切换 Agent 模式，当前：${runtimeMode}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px 8px',
                marginLeft: 'auto',
                background: isOfflineDowngraded ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
                border: `1px solid ${isOfflineDowngraded ? 'rgba(245, 158, 11, 0.4)' : 'var(--border-subtle)'}`,
                borderRadius: 9999,
                cursor: 'pointer',
                color: isOfflineDowngraded ? '#b45309' : 'var(--text-secondary)',
                fontSize: 11,
                transition: 'background 0.2s ease-in-out',
              }}
              onMouseEnter={(e) => {
                if (!isOfflineDowngraded) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'
              }}
              onMouseLeave={(e) => {
                if (!isOfflineDowngraded) e.currentTarget.style.background = 'transparent'
              }}
            >
              <RuntimeModeIcon size={12} />
              {runtimeMode === 'auto' && (
                <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>自动</span>
              )}
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
