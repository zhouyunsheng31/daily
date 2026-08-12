import { useEffect, useMemo, useState } from 'react'
import { useBackgroundStore, type BasicComponent } from '../stores/useBackgroundStore'

/**
 * 背景层组件（Phase 5 完整实现）
 *
 * 三层画布模型中的最底层，固定在视口，不随画布平移/缩放而移动。
 * 不参与相册缩放（始终 1:1 渲染）。
 *
 * 三个方面：
 * 1. 背景本身（color/gradient/image）—— AI 通过 set_background 控制
 * 2. 视觉特效（rain/snow/particles/stars）—— AI 通过 add_effect 控制
 * 3. 基础组件（clock/text/image）—— AI 通过 place_basic_component 控制
 *
 * 容器 pointer-events: none，子元素按需开启 pointer-events: auto
 */
export function BackgroundLayer() {
  const backgroundType = useBackgroundStore(s => s.backgroundType)
  const color = useBackgroundStore(s => s.color)
  const gradient = useBackgroundStore(s => s.gradient)
  const imageUrl = useBackgroundStore(s => s.imageUrl)
  const effect = useBackgroundStore(s => s.effect)
  const effectConfig = useBackgroundStore(s => s.effectConfig)
  const basicComponents = useBackgroundStore(s => s.basicComponents)

  // 计算背景样式
  const bgStyle = useMemo<React.CSSProperties>(() => {
    const base: React.CSSProperties = { position: 'absolute', inset: 0 }
    switch (backgroundType) {
      case 'color':
        base.background = color
        break
      case 'gradient':
        base.background = gradient
        break
      case 'image':
        base.backgroundImage = `url("${imageUrl}")`
        base.backgroundSize = 'cover'
        base.backgroundPosition = 'center'
        base.backgroundRepeat = 'no-repeat'
        break
    }
    return base
  }, [backgroundType, color, gradient, imageUrl])

  return (
    <div className="background-layer">
      {/* 1. 背景本身 */}
      <div style={bgStyle} />

      {/* 2. 视觉特效 */}
      <EffectRenderer effect={effect} config={effectConfig} />

      {/* 3. 基础组件 */}
      {basicComponents.map(comp => (
        <BasicComponentRenderer key={comp.id} component={comp} />
      ))}
    </div>
  )
}

// ============================================================================
// 特效渲染器
// ============================================================================

function EffectRenderer({ effect, config }: {
  effect: 'none' | 'rain' | 'snow' | 'particles' | 'stars'
  config: Record<string, unknown>
}) {
  const count = typeof config.count === 'number' ? Math.min(config.count, 200) : 80
  const particleColor = typeof config.color === 'string' ? config.color : '#fff'

  const particles = useMemo(() => {
    if (effect === 'none') return []
    return Array.from({ length: count }, (_, i) => ({
      id: `${effect}-${i}`,
      left: Math.random() * 100,
      delay: Math.random() * 10,
      duration: 5 + Math.random() * 10,
      size: effect === 'rain' ? 1 + Math.random() * 2 : effect === 'stars' ? 1 + Math.random() * 2 : 2 + Math.random() * 4,
      opacity: 0.3 + Math.random() * 0.7,
    }))
  }, [effect, count])

  if (effect === 'none' || particles.length === 0) return null

  const className = `bg-effect bg-effect--${effect}`

  return (
    <div className={className} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {particles.map(p => {
        const style: React.CSSProperties = {
          position: 'absolute',
          left: `${p.left}%`,
          animationDelay: `${p.delay}s`,
          animationDuration: `${p.duration}s`,
          opacity: p.opacity,
        }
        if (effect === 'rain') {
          style.width = `${p.size}px`
          style.height = `${p.size * 10}px`
          style.background = particleColor
        } else if (effect === 'snow') {
          style.width = `${p.size}px`
          style.height = `${p.size}px`
          style.background = particleColor
          style.borderRadius = '50%'
        } else if (effect === 'particles') {
          style.width = `${p.size}px`
          style.height = `${p.size}px`
          style.background = particleColor
          style.borderRadius = '50%'
        } else if (effect === 'stars') {
          style.width = `${p.size}px`
          style.height = `${p.size}px`
          style.background = particleColor
          style.borderRadius = '50%'
        }
        return <div key={p.id} className={`bg-effect-particle bg-effect-particle--${effect}`} style={style} />
      })}
    </div>
  )
}

// ============================================================================
// 基础组件渲染器
// ============================================================================

function BasicComponentRenderer({ component }: { component: BasicComponent }) {
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: component.position.x,
    top: component.position.y,
    pointerEvents: 'auto',
  }

  switch (component.type) {
    case 'clock':
      return <ClockComponent baseStyle={baseStyle} config={component.config} id={component.id} />
    case 'text':
      return <TextComponent baseStyle={baseStyle} config={component.config} />
    case 'image':
      return <ImageComponent baseStyle={baseStyle} config={component.config} />
    default:
      return null
  }
}

function ClockComponent({ baseStyle, config, id }: {
  baseStyle: React.CSSProperties
  config: Record<string, unknown>
  id: string
}) {
  const [time, setTime] = useState(new Date())
  const format = typeof config.format === 'string' ? config.format : 'HH:mm:ss'
  const fontSize = typeof config.fontSize === 'number' ? config.fontSize : 14
  const color = typeof config.color === 'string' ? config.color : 'rgba(255,255,255,0.6)'
  const fontFamily = typeof config.fontFamily === 'string' ? config.fontFamily : 'monospace'

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // 简单时间格式化
  const formatted = useMemo(() => {
    const h = String(time.getHours()).padStart(2, '0')
    const m = String(time.getMinutes()).padStart(2, '0')
    const s = String(time.getSeconds()).padStart(2, '0')
    return format
      .replace('HH', h)
      .replace('mm', m)
      .replace('ss', s)
  }, [time, format])

  return (
    <div data-bg-component={id} style={{ ...baseStyle, fontSize, color, fontFamily }}>
      {formatted}
    </div>
  )
}

function TextComponent({ baseStyle, config }: {
  baseStyle: React.CSSProperties
  config: Record<string, unknown>
}) {
  const content = typeof config.content === 'string' ? config.content : ''
  const fontSize = typeof config.fontSize === 'number' ? config.fontSize : 14
  const color = typeof config.color === 'string' ? config.color : 'rgba(255,255,255,0.6)'
  return (
    <div style={{ ...baseStyle, fontSize, color, whiteSpace: 'pre-wrap', maxWidth: 400 }}>
      {content}
    </div>
  )
}

function ImageComponent({ baseStyle, config }: {
  baseStyle: React.CSSProperties
  config: Record<string, unknown>
}) {
  const url = typeof config.url === 'string' ? config.url : ''
  const width = typeof config.width === 'number' ? config.width : 100
  const height = typeof config.height === 'number' ? config.height : 100
  if (!url) return null
  return (
    <img
      src={url}
      style={{ ...baseStyle, width, height, objectFit: 'contain' }}
      alt=""
    />
  )
}
