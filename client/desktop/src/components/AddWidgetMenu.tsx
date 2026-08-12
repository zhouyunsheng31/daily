import { useState, useRef, useEffect, useMemo } from 'react'
import { Monitor, Globe } from 'lucide-react'
import { getAllWidgetConfigs } from '../registry'
import { widgetDefinitionMap } from '../registry/widgetDefinitions'
import { useAppStore } from '../stores/useAppStore'
import type { WidgetConfig, DynamicWidgetDef } from '../types'
import type { WidgetCategory } from '../types/v2'

// DynamicWidgetDef 扩展类型（Phase 5 新增字段，types/index.ts 由其他 agent 同步更新）
type DynamicWidgetDefWithEnv = DynamicWidgetDef & {
  componentEnv?: 'pure-frontend' | 'local-dependent'
  desktopOnly?: boolean
}

const CATEGORY_ORDER: WidgetCategory[] = ['basic', 'work', 'life', 'media', 'stats', 'ai', 'study', 'fun']
const CATEGORY_LABELS: Record<string, string> = {
  basic: '基础组件',
  work: '时间与任务',
  life: '生活与健康',
  media: '媒体与阅读',
  stats: '统计面板',
  ai: 'AI 助手',
  study: '学习工具',
  fun: '趣味',
}

interface Props {
  onAdd: (type: string) => void
}

export default function AddWidgetMenu({ onAdd }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 订阅动态组件列表（用于显示 componentEnv 标签）
  const dynamicWidgets = useAppStore(s => s.dynamicWidgets) as DynamicWidgetDefWithEnv[]

  // 构建 widgetType → env 信息的查找表
  const envMap = useMemo(() => {
    const map = new Map<string, { componentEnv?: string; desktopOnly?: boolean }>()
    for (const d of dynamicWidgets) {
      map.set(d.widgetType, {
        componentEnv: d.componentEnv,
        desktopOnly: d.desktopOnly,
      })
    }
    return map
  }, [dynamicWidgets])

  const grouped = useMemo(() => {
    const configs = getAllWidgetConfigs()
    const filtered = search.trim()
      ? configs.filter(c => c.displayName.toLowerCase().includes(search.trim().toLowerCase()))
      : configs
    return filtered.reduce((acc, config) => {
      const def = widgetDefinitionMap.get(config.widgetType)
      const category = def?.category ?? 'basic'
      if (!acc[category]) acc[category] = []
      acc[category].push(config)
      return acc
    }, {} as Record<string, WidgetConfig[]>)
  }, [search])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // 渲染 componentEnv 标签（仅动态组件显示）
  const renderEnvLabel = (widgetType: string, isDynamic?: boolean) => {
    if (!isDynamic) return null
    const env = envMap.get(widgetType)
    if (!env) return null
    const isLocalDependent = env.componentEnv === 'local-dependent' || env.desktopOnly === true
    if (isLocalDependent) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            marginLeft: 6,
            padding: '1px 5px',
            borderRadius: 3,
            fontSize: 10,
            background: 'rgba(249, 115, 22, 0.15)',
            color: '#f97316',
            whiteSpace: 'nowrap',
          }}
        >
          <Monitor size={10} />
          仅桌面端
        </span>
      )
    }
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          marginLeft: 6,
          padding: '1px 5px',
          borderRadius: 3,
          fontSize: 10,
          background: 'rgba(34, 197, 94, 0.15)',
          color: '#22c55e',
          whiteSpace: 'nowrap',
        }}
      >
        <Globe size={10} />
        纯前端
      </span>
    )
  }

  return (
    <div ref={menuRef} className="add-widget-fab-container">
      <button className="add-widget-fab" onClick={() => setOpen(!open)} title="添加组件">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {open && (
        <div className="widget-menu fab-menu" onWheel={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            className="widget-search-input"
            type="text"
            placeholder="搜索组件…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="widget-menu-scroll" style={{ maxHeight: 'min(80vh, 640px)', overflowY: 'auto' }}>
            {CATEGORY_ORDER.map(cat => {
              const items = grouped[cat]
              if (!items || items.length === 0) return null
              return (
                <div key={cat} className="widget-category-group">
                  <div className="widget-category-label">{CATEGORY_LABELS[cat] ?? cat}</div>
                  {items.map(opt => (
                    <button
                      key={opt.widgetType}
                      className="widget-menu-item"
                      onClick={() => { onAdd(opt.widgetType); setOpen(false) }}
                    >
                      <span className="menu-icon">{opt.icon}</span>
                      <div className="menu-text-group">
                        <span className="menu-text">{opt.displayName}</span>
                        {renderEnvLabel(opt.widgetType, opt.isDynamic)}
                      </div>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
