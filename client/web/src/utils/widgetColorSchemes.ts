/**
 * Widget 配色方案系统
 * 参考 Material Design 3 Color Scheme 设计
 * 每个方案包含 6 个角色色，分亮/暗两套变体
 */

export interface ColorSchemeColors {
  primary: string    // 主色：标题、强调按钮、关键操作
  secondary: string  // 辅助色：次要元素、图标、标签
  surface: string    // 表面色：组件背景
  onSurface: string  // 表面文字色
  outline: string    // 边框/分割线色
  accent: string     // 强调色：选中态、高亮、焦点
}

export interface WidgetColorScheme {
  name: string
  label: string
  dark: ColorSchemeColors
  light: ColorSchemeColors
}

// 组件级 CSS 变量名映射
export const WIDGET_CSS_VARS = {
  primary: '--widget-primary',
  secondary: '--widget-secondary',
  surface: '--widget-surface',
  onSurface: '--widget-on-surface',
  outline: '--widget-outline',
  accent: '--widget-accent',
  primaryMuted: '--widget-primary-muted',
  secondaryMuted: '--widget-secondary-muted',
  accentMuted: '--widget-accent-muted',
  accentLight: '--widget-accent-light',
  accentBgSubtle: '--widget-accent-bg-subtle',
  accentBgSelected: '--widget-accent-bg-selected',
  accentBgSameNumber: '--widget-accent-bg-same-number',
  accentBgHighlighted: '--widget-accent-bg-highlighted',
} as const

// 预设配色方案
export const WIDGET_COLOR_SCHEMES: WidgetColorScheme[] = [
  {
    name: 'ocean',
    label: '海洋蓝',
    dark: { primary: '#60A5FA', secondary: '#93C5FD', surface: '#1E293B', onSurface: '#E2E8F0', outline: '#334155', accent: '#3B82F6' },
    light: { primary: '#2563EB', secondary: '#3B82F6', surface: '#EFF6FF', onSurface: '#1E3A5F', outline: '#BFDBFE', accent: '#1D4ED8' },
  },
  {
    name: 'mint',
    label: '薄荷绿',
    dark: { primary: '#34D399', secondary: '#6EE7B7', surface: '#1A2E2E', onSurface: '#D1FAE5', outline: '#2D4A4A', accent: '#10B981' },
    light: { primary: '#059669', secondary: '#10B981', surface: '#ECFDF5', onSurface: '#064E3B', outline: '#A7F3D0', accent: '#047857' },
  },
  {
    name: 'sunset',
    label: '暖橙',
    dark: { primary: '#FB923C', secondary: '#FDBA74', surface: '#2D2017', onSurface: '#FED7AA', outline: '#4A3525', accent: '#F97316' },
    light: { primary: '#EA580C', secondary: '#F97316', surface: '#FFF7ED', onSurface: '#7C2D12', outline: '#FED7AA', accent: '#C2410C' },
  },
  {
    name: 'rose',
    label: '玫瑰红',
    dark: { primary: '#FB7185', secondary: '#FDA4AF', surface: '#2D1520', onSurface: '#FFE4E6', outline: '#4A2535', accent: '#F43F5E' },
    light: { primary: '#E11D48', secondary: '#F43F5E', surface: '#FFF1F2', onSurface: '#881337', outline: '#FECDD3', accent: '#BE123C' },
  },
  {
    name: 'aurora',
    label: '极光紫',
    dark: { primary: '#C084FC', secondary: '#D8B4FE', surface: '#1A1025', onSurface: '#F3E8FF', outline: '#3D2B5E', accent: '#A855F7' },
    light: { primary: '#9333EA', secondary: '#A855F7', surface: '#FAF5FF', onSurface: '#581C87', outline: '#E9D5FF', accent: '#7E22CE' },
  },
  {
    name: 'sunlight',
    label: '日光白',
    dark: { primary: '#60A5FA', secondary: '#93C5FD', surface: '#1E293B', onSurface: '#F1F5F9', outline: '#334155', accent: '#3B82F6' },
    light: { primary: '#2563EB', secondary: '#3B82F6', surface: '#FFFFFF', onSurface: '#0F172A', outline: '#E2E8F0', accent: '#1D4ED8' },
  },
  {
    name: 'cream',
    label: '奶油黄',
    dark: { primary: '#FCD34D', secondary: '#FDE68A', surface: '#2D2517', onSurface: '#FEF3C7', outline: '#4A3D25', accent: '#F59E0B' },
    light: { primary: '#D97706', secondary: '#F59E0B', surface: '#FFFBEB', onSurface: '#78350F', outline: '#FDE68A', accent: '#B45309' },
  },
  {
    name: 'lavender',
    label: '薰衣草',
    dark: { primary: '#A78BFA', secondary: '#C4B5FD', surface: '#1E1530', onSurface: '#EDE9FE', outline: '#3B2D5E', accent: '#8B5CF6' },
    light: { primary: '#7C3AED', secondary: '#8B5CF6', surface: '#F5F3FF', onSurface: '#4C1D95', outline: '#DDD6FE', accent: '#6D28D9' },
  },
  {
    name: 'forest',
    label: '森林',
    dark: { primary: '#4ADE80', secondary: '#86EFAC', surface: '#0F1F0F', onSurface: '#DCFCE7', outline: '#1F3A1F', accent: '#22C55E' },
    light: { primary: '#16A34A', secondary: '#22C55E', surface: '#F0FDF4', onSurface: '#14532D', outline: '#BBF7D0', accent: '#15803D' },
  },
  {
    name: 'cyber',
    label: '赛博',
    dark: { primary: '#22D3EE', secondary: '#67E8F9', surface: '#0C0F1A', onSurface: '#CFFAFE', outline: '#1E2D42', accent: '#06B6D4' },
    light: { primary: '#0891B2', secondary: '#06B6D4', surface: '#ECFEFF', onSurface: '#164E63', outline: '#A5F3FC', accent: '#0E7490' },
  },
]

const schemeMap = new Map(WIDGET_COLOR_SCHEMES.map(s => [s.name, s]))

export function getWidgetColorScheme(name: string): WidgetColorScheme | undefined {
  return schemeMap.get(name)
}

/**
 * 获取配色方案的 CSS 变量样式对象
 * @param schemeName 配色方案名
 * @param isLight 是否为亮色模式（由调用方传入，确保响应式）
 */
export function getColorSchemeStyle(schemeName: string, isLight: boolean): React.CSSProperties | null {
  const scheme = getWidgetColorScheme(schemeName)
  if (!scheme) return null

  const colors = isLight ? scheme.light : scheme.dark

  const styles: Record<string, string> = {
    [WIDGET_CSS_VARS.primary]: colors.primary,
    [WIDGET_CSS_VARS.secondary]: colors.secondary,
    [WIDGET_CSS_VARS.surface]: colors.surface,
    [WIDGET_CSS_VARS.onSurface]: colors.onSurface,
    [WIDGET_CSS_VARS.outline]: colors.outline,
    [WIDGET_CSS_VARS.accent]: colors.accent,
    [WIDGET_CSS_VARS.primaryMuted]: colors.primary + '26',
    [WIDGET_CSS_VARS.secondaryMuted]: colors.secondary + '26',
    [WIDGET_CSS_VARS.accentMuted]: colors.accent + '26',
    [WIDGET_CSS_VARS.accentLight]: colors.accent + '80',
    [WIDGET_CSS_VARS.accentBgSubtle]: colors.accent + '12',
    [WIDGET_CSS_VARS.accentBgSelected]: colors.accent + '26',
    [WIDGET_CSS_VARS.accentBgSameNumber]: colors.accent + '1A',
    [WIDGET_CSS_VARS.accentBgHighlighted]: colors.primary + '1A',
  }

  return styles as React.CSSProperties
}
