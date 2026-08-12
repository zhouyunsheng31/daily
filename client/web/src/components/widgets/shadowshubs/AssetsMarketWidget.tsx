// ============================================================================
// Phase 7 §14.4：shadowshubs 素材市场 widget
//
// 对应 shadowshubs 原能力：素材市场（/assets）
// 显示素材卡片列表（图标/字体/配色），每个卡片有预览 + 下载按钮
// 下载时模拟进度（不依赖真实后端）
// ============================================================================

import { useState, useCallback } from 'react'
import { Image as ImageIcon, Download, Check, Loader2 } from 'lucide-react'

interface AssetInfo {
  id: string
  name: string
  category: '图标' | '字体' | '配色'
  description: string
  size: string
  format: string
  color: string
  preview: React.ReactNode
}

const ASSETS: AssetInfo[] = [
  {
    id: 'icon-set-fluent',
    name: 'Fluent UI Icons',
    category: '图标',
    description: '微软 Fluent Design 风格图标集，500+ 图标，SVG 格式',
    size: '2.3 MB',
    format: 'SVG',
    color: 'linear-gradient(135deg, #F1C40F, #50E3C2)',
    preview: (
      <div style={{ display: 'flex', gap: 4 }}>
        {['🏠', '📅', '✅', '📋', '⚙️'].map((icon, i) => (
          <div key={i} style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, background: 'rgba(241,196,15,0.15)', borderRadius: 4 }}>
            {icon}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'font-inter',
    name: 'Inter Font',
    category: '字体',
    description: '为屏幕阅读优化的无衬线字体，支持中英文，6 种字重',
    size: '1.8 MB',
    format: 'WOFF2',
    color: 'linear-gradient(135deg, #3498DB, #2ECC71)',
    preview: (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <span style={{ fontFamily: 'Inter, -apple-system, sans-serif', fontSize: 18, fontWeight: 700, color: '#3498DB' }}>Aa</span>
        <span style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>Inter Bold</span>
      </div>
    ),
  },
  {
    id: 'palette-sunset',
    name: 'Sunset Palette',
    category: '配色',
    description: '日落渐变配色方案，12 色，适合暖色调 UI 设计',
    size: '4 KB',
    format: 'JSON',
    color: 'linear-gradient(135deg, #E74C3C, #F39C12)',
    preview: (
      <div style={{ display: 'flex', gap: 2, borderRadius: 4, overflow: 'hidden' }}>
        {['#FF6B6B', '#FF9F43', '#FECA57', '#FF6348', '#E74C3C', '#C0392B'].map(c => (
          <div key={c} style={{ width: 16, height: 24, background: c }} title={c} />
        ))}
      </div>
    ),
  },
]

type DownloadState = 'idle' | 'downloading' | 'downloaded'

export interface AssetsMarketWidgetProps {
  onEnter?: () => void
}

export default function AssetsMarketWidget({ onEnter: _onEnter }: AssetsMarketWidgetProps) {
  const [downloadStates, setDownloadStates] = useState<Record<string, DownloadState>>({})

  const handleDownload = useCallback((assetId: string) => {
    setDownloadStates(prev => ({ ...prev, [assetId]: 'downloading' }))
    // 模拟下载过程
    setTimeout(() => {
      setDownloadStates(prev => ({ ...prev, [assetId]: 'downloaded' }))
    }, 1200)
  }, [])

  return (
    <div
      className="shadowshubs-widget-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 20,
        borderRadius: 12,
        background: 'linear-gradient(135deg, rgba(241,196,15,0.08), rgba(80,227,194,0.08))',
        border: '1px solid var(--border-default)',
        minHeight: 180,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #F1C40F, #50E3C2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <ImageIcon size={22} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>素材市场</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Assets Market · {ASSETS.length} 个素材</div>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
        浏览游戏/网页开发素材（图标/字体/配色），下载后直接拖入画布使用。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ASSETS.map(asset => {
          const state = downloadStates[asset.id] || 'idle'
          return (
            <div
              key={asset.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border-default)',
              }}
            >
              {/* 预览区 */}
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 8,
                  background: asset.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  padding: 4,
                }}
              >
                {asset.preview}
              </div>
              {/* 信息区 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{asset.name}</span>
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(241,196,15,0.15)', color: '#F1C40F' }}>
                    {asset.category}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {asset.description}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {asset.format} · {asset.size}
                </div>
              </div>
              {/* 下载按钮 */}
              <button
                onClick={() => state === 'idle' && handleDownload(asset.id)}
                disabled={state !== 'idle'}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: state === 'downloaded'
                    ? 'linear-gradient(135deg, #2ECC71, #27AE60)'
                    : state === 'downloading'
                      ? 'rgba(241,196,15,0.3)'
                      : 'linear-gradient(135deg, #F1C40F, #50E3C2)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: state === 'idle' ? 'pointer' : 'default',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontFamily: 'inherit',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                {state === 'downloaded' ? (
                  <><Check size={11} /> 已下载</>
                ) : state === 'downloading' ? (
                  <><Loader2 size={11} className="animate-spin" /> 下载中</>
                ) : (
                  <><Download size={11} /> 下载</>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
