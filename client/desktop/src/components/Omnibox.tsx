// Omnibox 组件（地址栏）
// 完整实现：URL 导航 / 搜索 / AI 对话 / 斜杠命令 / 建议补全 / 键盘导航 / Ctrl+L 聚焦
import { useState, useRef } from 'react'
import { isUrl, normalizeUrl, browserToolBridge, buildSearchUrl } from '../utils/browserToolBridge'
// Phase 15 批次2 任务2.0：改用静态 import，避免每次提交都触发动态 import 开销
import { useAppStore } from '../stores/useAppStore'
// Phase 15 批次4 修复 P1-1：从 hook 读取 focus-omnibox 当前生效组合（自定义优先）
import { getShortcutKeys } from '../hooks/useKeyboardShortcuts'

interface OmniboxProps {
  // 批次1: 支持外层动态设置宽度（用于 ResizableDivider 拖拽改变 Omnibox 宽度）
  style?: React.CSSProperties
}

export default function Omnibox({ style }: OmniboxProps) {
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  // Phase 15 批次4 修复 P1-1：Ctrl+L 聚焦逻辑已迁移到 useKeyboardShortcuts hook 统一处理
  // （通过 document.querySelector('.omnibox__input') 找到本组件的 input 并 focus + select）

  const handleSubmit = async () => {
    const trimmed = value.trim()
    if (!trimmed) return

    if (trimmed.startsWith('/')) {
      await handleSlashCommand(trimmed)
    } else if (isUrl(trimmed)) {
      await navigateToUrl(trimmed)
    } else {
      // 搜索（Phase 6.3：使用用户配置的搜索引擎）
      const engine = useAppStore.getState().settings?.behavior?.searchEngine ?? 'bing'
      await navigateToUrl(buildSearchUrl(trimmed, engine))
    }
    setValue('')
    setSuggestions([])
    setSelectedSuggestion(-1)
  }

  // Phase 15 批次2 任务2.0：按 mainView.type 分支处理导航，避免不必要的 addWidget
  // - web-tab：复用当前 activeWebTabId，仅更新 URL
  // - browser-home：新建 webTab 并切换 mainView
  // - canvas-panel / canvas-home：保持原 addWidget 行为
  const navigateToUrl = async (url: string) => {
    const state = useAppStore.getState()
    const mainView = state.mainView
    const targetUrl = isUrl(url) ? normalizeUrl(url) : buildSearchUrl(url, state.settings?.behavior?.searchEngine ?? 'bing')

    if (mainView.type === 'web-tab') {
      // 复用现有 activeWebTabId
      const tabId = mainView.tabId ?? state.activeWebTabId
      if (tabId) {
        useAppStore.setState({
          webTabs: state.webTabs.map(t => t.id === tabId ? { ...t, url: targetUrl, updatedAt: Date.now() } : t),
        })
        return
      }
      // 无 activeWebTabId 则新建
      await state.addWebTab(targetUrl)
    } else if (mainView.type === 'browser-home') {
      // 新建 webTab 并切换
      const newTabId = await state.addWebTab(targetUrl)
      useAppStore.setState({
        activeWebTabId: newTabId,
        mainView: { type: 'web-tab', tabId: newTabId },
      })
    } else {
      // canvas-panel / canvas-home：保持当前 addWidget 行为
      const panelId = state.activePanelId
      if (!panelId) return
      try {
        await state.addWidget('webPage', {
          panelId,
          position: { x: 100, y: 100, w: 480, h: 600 },
          initialState: { url: targetUrl, title: targetUrl, schemaVersion: 1 },
        })
      } catch (e) {
        alert(e instanceof Error ? e.message : '添加网页组件失败')
      }
    }
  }

  // S6 修复：/open 命令调用 normalizeUrl 规范化 URL（与 navigateToUrl 内部双重保护）
  // Phase 15 批次1 任务1.3：/open 非 URL 输入用当前搜索引擎搜索（不再 fallback about:blank）
  const handleSlashCommand = async (cmd: string) => {
    const parts = cmd.slice(1).split(' ')
    const command = parts[0]
    const arg = parts.slice(1).join(' ')
    switch (command) {
      case 'new-panel':
        await useAppStore.getState().addPanel(arg || '新面板')
        break
      case 'open': {
        if (!arg) break
        if (isUrl(arg)) {
          await navigateToUrl(normalizeUrl(arg))
        } else {
          const engine = useAppStore.getState().settings.behavior.searchEngine
          await navigateToUrl(buildSearchUrl(arg, engine))
        }
        break
      }
    }
  }

  // M4 修复：用 Set 去重，避免重复 URL 出现在建议列表
  const updateSuggestions = (input: string) => {
    if (!input) { setSuggestions([]); return }
    const tabs = browserToolBridge.getRegisteredWebviews()
    const urls = Array.from(new Set(tabs.map(t => t.url).filter(Boolean)))
    setSuggestions(urls.filter(u => u.includes(input)).slice(0, 5))
  }

  // 键盘导航：Enter 提交 / ArrowDown/ArrowUp 循环选择 / Escape 清空失焦
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
        const url = suggestions[selectedSuggestion]
        navigateToUrl(url)
        setValue('')
        setSuggestions([])
        setSelectedSuggestion(-1)
      } else {
        handleSubmit()
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (suggestions.length === 0) return
      setSelectedSuggestion(prev => (prev + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (suggestions.length === 0) return
      setSelectedSuggestion(prev => (prev - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Escape') {
      setValue('')
      setSuggestions([])
      setSelectedSuggestion(-1)
      inputRef.current?.blur()
    }
  }

  return (
    <div className="omnibox" style={style}>
      <input
        ref={inputRef}
        className="omnibox__input"
        value={value}
        onChange={(e) => { setValue(e.target.value); updateSuggestions(e.target.value) }}
        onKeyDown={handleKeyDown}
        placeholder="输入 URL、搜索内容、/ 命令"
        title={`地址栏 (${getShortcutKeys('focus-omnibox')} 聚焦)`}
      />
      {suggestions.length > 0 && (
        <div className="omnibox__suggestions">
          {suggestions.map((url, i) => (
            <div
              key={url}
              className={`omnibox__suggestion ${i === selectedSuggestion ? 'omnibox__suggestion--selected' : ''}`}
              onClick={() => { navigateToUrl(url); setValue(''); setSuggestions([]); setSelectedSuggestion(-1) }}
            >
              {url}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
