export function isLightColor(hex: string): boolean {
  if (!hex || hex.startsWith('rgba') || hex.startsWith('rgb')) return false
  const c = hex.replace('#', '')
  if (c.length < 6) return false
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}

export function gradientIsLight(gradient: string): boolean {
  const hexMatches = gradient.match(/#[0-9a-fA-F]{6}/g)
  if (!hexMatches || hexMatches.length === 0) return false
  let totalBrightness = 0
  for (const hex of hexMatches) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    totalBrightness += (r * 299 + g * 587 + b * 114) / 1000
  }
  return (totalBrightness / hexMatches.length) > 128
}

export function isLightTheme(app: { backgroundType: string; backgroundColor: string; backgroundGradient: string }): boolean {
  if (app.backgroundType === 'gradient') return gradientIsLight(app.backgroundGradient)
  if (app.backgroundType === 'image') return false
  return isLightColor(app.backgroundColor)
}

export function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace('#', '')
  if (c.length < 6) return `rgba(0, 0, 0, ${alpha})`
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function ensureContrast(hex: string, isLight: boolean): string {
  const c = hex.replace('#', '')
  if (c.length < 6) return hex
  let r = parseInt(c.slice(0, 2), 16)
  let g = parseInt(c.slice(2, 4), 16)
  let b = parseInt(c.slice(4, 6), 16)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  if (isLight && brightness > 160) {
    // 亮背景上颜色太浅，与深色混合以保留饱和度
    const mix = 0.45
    r = Math.round(r * (1 - mix))
    g = Math.round(g * (1 - mix))
    b = Math.round(b * (1 - mix))
  } else if (!isLight && brightness < 150) {
    const factor = 170 / Math.max(brightness, 1)
    r = Math.min(255, Math.round(r * factor))
    g = Math.min(255, Math.round(g * factor))
    b = Math.min(255, Math.round(b * factor))
  }
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
