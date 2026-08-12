// ============================================================================
// Phase 7 §14.4：shadowshubs Skill 市场 widget
//
// 对应 shadowshubs 原能力：Skill 市场（/skills-gallery）
// 显示 Skill 卡片列表，每个卡片有名称/描述/安装按钮
// 安装时模拟下载进度（不依赖真实后端）
// ============================================================================

import { useState, useCallback } from 'react'
import { Package, Download, Check, Loader2 } from 'lucide-react'

interface SkillInfo {
  id: string
  name: string
  description: string
  version: string
  author: string
  commands: number
  color: string
  icon: string
}

const SKILLS: SkillInfo[] = [
  {
    id: 'canvas-cli',
    name: 'canvas-cli',
    description: '画布操作命令行工具，支持 widget 创建/删除/查询、画布缩放、导出等',
    version: '1.2.0',
    author: 'shadowshubs',
    commands: 12,
    color: 'linear-gradient(135deg, #9B59B6, #4A90E2)',
    icon: '🎨',
  },
  {
    id: 'fs-cli',
    name: 'fs-cli',
    description: '文件系统命令行工具，支持读写/搜索/执行 shell 命令（沙箱内）',
    version: '2.0.1',
    author: 'shadowshubs',
    commands: 7,
    color: 'linear-gradient(135deg, #E67E22, #F39C12)',
    icon: '📁',
  },
  {
    id: 'memory-cli',
    name: 'memory-cli',
    description: 'AI 记忆管理工具，支持长期记忆存储/检索/遗忘策略配置',
    version: '1.0.3',
    author: 'shadowshubs',
    commands: 5,
    color: 'linear-gradient(135deg, #1ABC9C, #16A085)',
    icon: '🧠',
  },
]

type InstallState = 'idle' | 'installing' | 'installed'

export interface SkillsGalleryWidgetProps {
  onEnter?: () => void
}

export default function SkillsGalleryWidget({ onEnter: _onEnter }: SkillsGalleryWidgetProps) {
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({})

  const handleInstall = useCallback((skillId: string) => {
    setInstallStates(prev => ({ ...prev, [skillId]: 'installing' }))
    // 模拟安装过程（不依赖真实后端）
    setTimeout(() => {
      setInstallStates(prev => ({ ...prev, [skillId]: 'installed' }))
    }, 1500)
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
        background: 'linear-gradient(135deg, rgba(155,89,182,0.08), rgba(74,144,226,0.08))',
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
            background: 'linear-gradient(135deg, #9B59B6, #4A90E2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <Package size={22} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Skill 市场</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Skills Gallery · {SKILLS.length} 个 Skill</div>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
        浏览社区贡献的 Skill 包，一键安装到本地，扩展 AI Agent 能力。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SKILLS.map(skill => {
          const state = installStates[skill.id] || 'idle'
          return (
            <div
              key={skill.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border-default)',
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: skill.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                {skill.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{skill.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>v{skill.version}</span>
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(155,89,182,0.15)', color: '#9B59B6' }}>
                    {skill.commands} 命令
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.4 }}>
                  {skill.description}
                </div>
              </div>
              <button
                onClick={() => state === 'idle' && handleInstall(skill.id)}
                disabled={state !== 'idle'}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: state === 'installed'
                    ? 'linear-gradient(135deg, #2ECC71, #27AE60)'
                    : state === 'installing'
                      ? 'rgba(155,89,182,0.3)'
                      : 'linear-gradient(135deg, #9B59B6, #4A90E2)',
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
                {state === 'installed' ? (
                  <><Check size={11} /> 已安装</>
                ) : state === 'installing' ? (
                  <><Loader2 size={11} className="animate-spin" /> 安装中</>
                ) : (
                  <><Download size={11} /> 安装</>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
