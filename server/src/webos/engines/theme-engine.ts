// server/src/webos/engines/theme-engine.ts —— W4 type=theme 包执行引擎
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/03-package-system.md §3（theme 包 = design tokens + 壁纸 +
//       模糊/动画参数；shell-web 主题引擎校验后应用，可回退）+ capabilities
//       「ui.theme——主题（design tokens 覆盖包）」。
// 职责：
//   - resolveThemeTokens：读取 manifest.contents.tokens（design tokens），校验
//     必填 key（--paper / --ink / --accent），返回 { tokens, cssVars, missing }；
//   - applyThemeTokens：生成主题 CSS 变量清单（:root { ... }），缺 key 自动回退
//     DEFAULT_TOKENS，绝不抛阻断（失败只回退，调用方/桌面侧无感）；
//   - DEFAULT_TOKENS：与 webosDesktopV1 同源的安全回退值（暖纸系）。
// 消费方：packages 生命周期把 tokens 存到调用者工作区 system/themes/<id>/tokens.json
//       + theme.css（供桌面/Shell 消费）；本引擎只做独立纯函数，不依赖 webos.ts。
// ============================================================================

/** theme 引擎默认 tokens（失败/缺 key 回退用；与 webosDesktopV1.html :root 同源） */
export const DEFAULT_TOKENS = {
  '--paper': '#f8f7f3',
  '--paper-strong': '#fffefa',
  '--paper-muted': '#efede7',
  '--board': '#e8e4db',
  '--ink': '#171918',
  '--ink-soft': '#424740',
  '--muted': '#71756f',
  '--blue': '#315bd6',
  '--green': '#376b53',
  '--line': 'rgba(23, 25, 24, .10)',
} as const

/** theme 包必需的 design token key（缺任一 → 视为不完整，但只回退不抛错） */
export const REQUIRED_TOKEN_KEYS = ['--paper', '--ink', '--accent'] as const

/** 允许的 token 前缀（防注入 CSS 语法；其余 key 忽略并记 warning） */
const ALLOWED_PREFIXES = ['--']

export interface ThemeTokensResult {
  /** 归一化后的 token 表（key 带 -- 前缀；非法 key 已剔除） */
  tokens: Record<string, string>
  /** 生成的 CSS 变量清单文本（:root { ... }） */
  cssVars: string
  /** 缺失的必填 key（已回退用默认值） */
  missing: string[]
  /** 被忽略的非法 key（非 -- 前缀） */
  ignored: string[]
}

/** 把任意 token 对象归一化为 { '--x': value } 形态（自动补 -- 前缀；防 CSS 注入） */
export function normalizeTokens(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue
    let k = String(key).trim()
    if (!k) continue
    if (!k.startsWith('--')) k = `--${k}`
    // 防注入：只允许 CSS 自定义属性名（字母/数字/-/_）；值只允许安全字符
    if (!/^--[a-zA-Z0-9_-]+$/.test(k)) continue
    const v = String(value).trim()
    if (!v || v.length > 500) continue
    if (!/^[#a-zA-Z0-9\s(),.%\-_/\[\]]+$/.test(v)) continue
    out[k] = v
  }
  return out
}

/** 读取包的 design tokens（manifest.contents.tokens）；无法读取时回退默认空表 */
export function resolveThemeTokens(manifest: Record<string, unknown>): Record<string, string> {
  const contents = manifest.contents
  if (!contents || typeof contents !== 'object' || Array.isArray(contents)) return {}
  const tokens = (contents as Record<string, unknown>).tokens
  return normalizeTokens(tokens)
}

/** 生成主题 :root CSS 变量清单；缺必填 key 回退 DEFAULT_TOKENS（不抛阻断） */
export function applyThemeTokens(manifestOrTokens: Record<string, unknown> | Record<string, string>, opts: { withFallback?: boolean } = {}): ThemeTokensResult {
  const withFallback = opts.withFallback ?? true
  const tokens = typeof (manifestOrTokens as Record<string, unknown>).contents === 'object'
    ? resolveThemeTokens(manifestOrTokens as Record<string, unknown>)
    : normalizeTokens(manifestOrTokens)

  const missing: string[] = []
  for (const key of REQUIRED_TOKEN_KEYS) {
    if (!tokens[key]) missing.push(key)
  }

  const ignored: string[] = []
  const final: Record<string, string> = { ...tokens }
  for (const [k] of Object.entries(final)) {
    if (!ALLOWED_PREFIXES.some((p) => k.startsWith(p))) {
      ignored.push(k)
      delete final[k]
    }
  }

  // 缺 key 回退默认（withFallback=false 时保持缺失，供严格校验场景）
  if (withFallback) {
    for (const key of REQUIRED_TOKEN_KEYS) {
      if (!final[key] && DEFAULT_TOKENS[key as keyof typeof DEFAULT_TOKENS] !== undefined) {
        final[key] = DEFAULT_TOKENS[key as keyof typeof DEFAULT_TOKENS]
      }
    }
  }

  const cssVars = `:root {\n${Object.entries(final)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')}\n}`
  return { tokens: final, cssVars, missing, ignored }
}

/** 统一入口（供 packages 生命周期挂接） */
export const themeEngine = {
  resolve: resolveThemeTokens,
  apply: applyThemeTokens,
  normalize: normalizeTokens,
  defaults: DEFAULT_TOKENS,
}