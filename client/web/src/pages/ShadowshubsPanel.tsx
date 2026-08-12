// ============================================================================
// Phase 7 §14：shadowshubs 内置官方社区面板视图（框架展示 + MOCK 聚合预览）
//
// 设计文档 §14.2 / §16.1：
// - "先不做整合，只留框架，后面慢慢考虑"
// - 允许 MVP 降级，但需要在 UI 上显式标注"当前为模拟数据"让用户知道
//
// 本面板当前为"框架展示 + MOCK 聚合预览"：
// - 保留路由 /shadowshubs 和本组件（框架）
// - 显示 shadowshubs 社区信息卡片（名称、描述、连接状态）
// - 显示用户已连接的外部社区列表（从 /api/communities 获取真实数据）
// - 为每个已连接社区展示 MOCK 组件/面板聚合列表（让用户看到聚合效果）
// - 所有 MOCK 数据位置加显式"模拟数据"徽章（橙色背景）
// - 历史 widget（PlayLobbyWidget 等 4 个）仍保留在 widgets/shadowshubs/ 目录下
//   作为代码框架，但不在本面板渲染（保持降级状态）
// ============================================================================

import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft,
  Sparkles,
  Globe,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Gamepad2,
  Puzzle,
  Image,
  Wifi,
  CheckCircle,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { getCommunities, type CommunityDTO } from '../api/communities'

// ----------------------------------------------------------------------------
// MOCK 聚合预览：每个已连接社区展示的"组件/面板"列表
// 这些是 shadowshubs 未来整合的能力维度（对应 widgets/shadowshubs/ 下的 4 个 widget），
// 当前仅作为 MOCK 预览展示，不真正激活 widget 组件（保持降级状态）。
// ----------------------------------------------------------------------------
interface MockPanel {
  id: string
  name: string
  description: string
  icon: typeof Gamepad2
}

const MOCK_PANELS: MockPanel[] = [
  { id: 'play-lobby', name: '游戏大厅', description: '社区游戏组件聚合入口', icon: Gamepad2 },
  { id: 'skills-gallery', name: 'Skill 展示', description: '社区 Skill 组件展示', icon: Puzzle },
  { id: 'assets-market', name: '素材市场', description: '社区素材组件聚合', icon: Image },
  { id: 'realtime-game', name: '实时联机', description: '社区联机组件入口', icon: Wifi },
]

const MOCK_NOTE_TEXT = '当前为模拟数据，联邦式社区功能将在后续版本实现'

/** 模拟数据徽章（橙色背景，醒目） */
function MockBadge({ title }: { title?: string }) {
  return (
    <span
      title={title ?? MOCK_NOTE_TEXT}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 10,
        padding: '1px 7px',
        borderRadius: 999,
        background: 'rgba(241, 142, 38, 0.15)',
        color: '#e8861a',
        fontWeight: 600,
        border: '1px solid rgba(241, 142, 38, 0.3)',
        whiteSpace: 'nowrap',
      }}
    >
      <AlertTriangle size={9} />
      模拟数据
    </span>
  )
}

export default function ShadowshubsPanel() {
  const navigate = useNavigate()
  const [communities, setCommunities] = useState<CommunityDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await getCommunities()
      setCommunities(list)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <main
      className="workspace full"
      style={{
        background: 'linear-gradient(180deg, var(--bg-default) 0%, var(--bg-surface) 100%)',
        minHeight: '100vh',
        overflowY: 'auto',
      }}
    >
      {/* 顶部导航栏 */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 20px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-default)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <button
          onClick={() => navigate('/')}
          title="返回首页"
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-default)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
            fontFamily: 'inherit',
          }}
        >
          <ArrowLeft size={14} />
          返回
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => navigate('/settings')}
          title="社区发现"
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-default)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'inherit',
          }}
        >
          社区发现
        </button>
      </div>

      {/* 面板头部 + 社区信息卡片 */}
      <div
        style={{
          padding: '40px 20px 24px',
          maxWidth: 960,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: 'linear-gradient(135deg, #4A90E2, #50E3C2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 8px 24px rgba(74,144,226,0.3)',
            }}
          >
            <Sparkles size={32} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              shadowshubs
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 7px',
                  borderRadius: 999,
                  background: 'rgba(80,227,194,0.15)',
                  color: 'var(--color-success, #50E3C2)',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <CheckCircle size={9} />
                内置社区·已连接
              </span>
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              Daily 官方社区面板 — 游戏 / Skill / 素材聚合入口
            </p>
          </div>
        </div>

        {/* 社区信息卡片 */}
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 8,
            background: 'rgba(74,144,226,0.06)',
            border: '1px solid rgba(74,144,226,0.18)',
            fontSize: 13,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Globe size={13} style={{ color: 'var(--color-primary, #4A90E2)' }} />
            <strong style={{ color: 'var(--text-primary)' }}>shadowshubs</strong>
            <span style={{ color: 'var(--text-tertiary)' }}>·</span>
            <span>Daily 官方社区面板 - 游戏/Skill/素材</span>
            <span style={{ color: 'var(--text-tertiary)' }}>·</span>
            <span style={{ fontFamily: 'SF Mono, monospace', fontSize: 11 }}>
              内置（无需外部地址）
            </span>
          </div>
          <div style={{ fontSize: 12, marginTop: 6, color: 'var(--text-tertiary)' }}>
            联邦模型：每个 Daily 部署是一个独立社区实例，本面板聚合展示你已连接的外部社区。
          </div>
        </div>

        {/* MOCK 全局提示 */}
        <div
          style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(241, 142, 38, 0.08)',
            border: '1px solid rgba(241, 142, 38, 0.25)',
            fontSize: 12,
            color: '#b5641a',
            lineHeight: 1.6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <div>
            <MockBadge />
            <span style={{ marginLeft: 8 }}>{MOCK_NOTE_TEXT}</span>
          </div>
        </div>
      </div>

      {/* 已连接社区列表 + 内容聚合 */}
      <div
        style={{
          padding: '0 20px 24px',
          maxWidth: 960,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Globe size={14} />
            已连接社区
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400 }}>
              （{communities.length} 个）
            </span>
          </h2>
          <button
            onClick={refresh}
            disabled={loading}
            title="刷新社区列表"
            style={{
              padding: '4px 10px',
              borderRadius: 8,
              border: '1px solid var(--border-default)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            刷新
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: 'rgba(231,76,60,0.08)',
              border: '1px solid rgba(231,76,60,0.25)',
              fontSize: 12,
              color: '#c0392b',
              marginBottom: 12,
            }}
          >
            加载失败：{error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
            <Loader2 size={20} className="animate-spin" style={{ display: 'inline-block', verticalAlign: 'middle' }} />
            <span style={{ marginLeft: 8 }}>加载社区列表...</span>
          </div>
        ) : communities.length === 0 ? (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 13,
              background: 'var(--bg-elevated)',
              borderRadius: 8,
              border: '1px dashed var(--border-default)',
            }}
          >
            <Globe size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
            <div>暂未连接任何外部社区</div>
            <div style={{ fontSize: 11, marginTop: 6 }}>
              前往「社区发现」添加外部 Daily 社区实例地址，即可在此聚合展示
            </div>
            <button
              onClick={() => navigate('/settings')}
              style={{
                marginTop: 12,
                padding: '5px 14px',
                borderRadius: 8,
                border: '1px solid var(--color-primary, #4A90E2)',
                background: 'var(--color-primary, #4A90E2)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'inherit',
              }}
            >
              前往社区发现
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {communities.map((c) => (
              <ConnectedCommunityCard key={c.id} community={c} />
            ))}
          </div>
        )}
      </div>

      {/* 底部框架说明 */}
      <div
        style={{
          padding: '20px',
          maxWidth: 960,
          margin: '0 auto',
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 8,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            fontSize: 12,
            color: 'var(--text-tertiary)',
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
            关于本面板
          </div>
          shadowshubs 能力拆解进行中，当前为框架展示。按设计文档 §14.2 / §16.1，
          shadowshubs 整合「先不做，只留框架，后面慢慢考虑」。本页面展示已连接社区的
          组件/面板聚合预览（当前为模拟数据），后续版本将逐步接入真实联邦社区能力。
          历史 widget 实现（PlayLobbyWidget / SkillsGalleryWidget / AssetsMarketWidget /
          RealtimeGameWidget）保留在代码库中作为框架，暂不在本面板激活。
        </div>
      </div>
    </main>
  )
}

// ----------------------------------------------------------------------------
// 已连接社区卡片：显示社区基本信息 + MOCK 组件/面板聚合列表
// ----------------------------------------------------------------------------
function ConnectedCommunityCard({ community }: { community: CommunityDTO }) {
  const isBuiltin = !community.apiUrl
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        borderRadius: 10,
        border: '1px solid var(--border-default)',
        overflow: 'hidden',
      }}
    >
      {/* 卡片头部：社区信息 */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Globe size={14} style={{ color: 'var(--color-primary, #4A90E2)', flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>{community.name}</span>
          {community.isOfficial && (
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 999,
                background: 'rgba(74,144,226,0.15)',
                color: 'var(--color-primary, #4A90E2)',
                fontWeight: 600,
              }}
            >
              官方
            </span>
          )}
          {isBuiltin && (
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 999,
                background: 'rgba(80,227,194,0.15)',
                color: 'var(--color-success, #50E3C2)',
                fontWeight: 600,
              }}
            >
              内置
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 999,
              background: 'rgba(80,227,194,0.1)',
              color: 'var(--color-success, #50E3C2)',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <CheckCircle size={9} />
            已连接
          </span>
        </div>
        {community.description && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
            {community.description}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'SF Mono, monospace', marginTop: 4 }}>
          {community.apiUrl || '（内置，无需外部地址）'}
        </div>
      </div>

      {/* 社区内容聚合：MOCK 组件/面板列表 */}
      <div style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
            组件 / 面板聚合
          </span>
          <MockBadge />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {MOCK_PANELS.map((p) => {
            const Icon = p.icon
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--bg-default, rgba(0,0,0,0.02))',
                  border: '1px solid var(--border-default)',
                  opacity: 0.85,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: 'rgba(74,144,226,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-primary, #4A90E2)',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={14} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
                    {p.description}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8, textAlign: 'right' }}>
          以上组件为模拟数据预览，实际聚合能力将在后续版本接入
        </div>
      </div>
    </div>
  )
}
