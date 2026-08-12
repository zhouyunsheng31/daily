/**
 * NSIS 安装包品牌化 BMP 资源生成 — Phase 15 批次 6 任务 6.1
 *
 * 产出 3 个 24-bit BMP（NSIS 安装向导严格尺寸要求）：
 * - build/installer-banner.bmp         150×57  px  安装向导顶部 banner（MUI_HEADERIMAGE）
 * - build/installer-sidebar.bmp        164×314 px  安装向导左侧 sidebar
 * - build/uninstaller-sidebar.bmp      164×314 px  卸载向导左侧 sidebar
 *
 * 品牌：Living Dashboard（LD Logo 紫色到蓝色渐变 #667eea → #764ba2，与 LdLogo 组件一致）
 * 风格：现代 Electron 应用风格（参考 VSCode / Notion / Figma 安装界面）
 *   - 品牌渐变作为主背景（不再是深色 VSCode 主题）
 *   - LD 圆形 Logo（复用 client/desktop/src/components/LdLogo.tsx 设计）
 *   - "Living Dashboard" 主标题 + 版本号
 *   - sidebar 增加功能图标示意（仪表盘 / 图层 / AI 搜索）
 *   - uninstaller 使用不同色调（暗紫渐变）区分安装/卸载
 *
 * 流程：SVG 字符串 → sharp 渲染 raw RGB → 手写 24-bit BMP encoder
 * （sharp 不直接支持 BMP 输出，但 BMP 格式简单，手写 encoder 完全可控）
 *
 * 用法：node scripts/generate-nsis-branding.mjs
 * 幂等：可重复运行，覆盖旧文件。
 *
 * 依赖：sharp（devDependencies，已通过 npm install 安装）
 *
 * BMP 格式要求（NSIS 兼容）：
 * - 24-bit（无 alpha 通道）
 * - sRGB 颜色空间
 * - 文件大小 < 1MB
 */

import sharp from 'sharp'
import { writeFile, mkdir, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BUILD_DIR = resolve(ROOT, 'build')

// 从 package.json 动态读取版本号，避免硬编码
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
const VERSION = pkg.version

// Living Dashboard 品牌配色（与 LdLogo.tsx 一致：紫色到蓝色渐变）
const COLORS = {
  // 品牌渐变（LdLogo.tsx linearGradient: #667eea → #764ba2）
  brandStart: '#667eea', // 渐变浅端（紫蓝）
  brandEnd: '#764ba2', // 渐变深端（紫）
  // 文字色（渐变背景上的白色文字，高对比度）
  text: '#ffffff', // 主文字
  textDim: '#e8e4f0', // 次文字（略带紫调的浅色，营造层次）
  textFaint: '#c8c0d8', // 更暗的次文字
  // 装饰元素
  white10: 'rgba(255,255,255,0.10)', // 半透明白（分隔线、装饰）
  white20: 'rgba(255,255,255,0.20)', // 半透明白（图标轮廓）
  white60: 'rgba(255,255,255,0.60)', // 半透明白（图标填充）
  // 卸载器专属：暗紫色调（区分安装/卸载）
  uninstStart: '#5b4670', // 暗紫渐变浅端
  uninstEnd: '#2d1b3d', // 暗紫渐变深端
}

const FONT_STACK = "'Segoe UI', 'Microsoft YaHei', 'PingFang SC', Arial, sans-serif"
const GRAD_ID = 'ldGrad'

// ---------------------------------------------------------------------------
// SVG 生成
// ---------------------------------------------------------------------------

/**
 * LD Logo 图形（复用 client/desktop/src/components/LdLogo.tsx 设计）
 * 圆形渐变背景 + "LD" 白色字母
 * 原始 viewBox 0 0 48 48，通过 scale 缩放到指定尺寸
 * @param {number} size 边长（px）
 * @param {number} x 左上 x
 * @param {number} y 左上 y
 * @param {string} gradId 渐变 id（允许卸载器用不同渐变）
 */
function logoGlyph(size, x, y, gradId = GRAD_ID) {
  const scale = size / 48
  const fs = 18 * scale // 字体大小随 scale 缩放
  const ty = 32 * scale // text y 基线
  return `<g transform="translate(${x},${y})">
    <circle cx="${24 * scale}" cy="${24 * scale}" r="${24 * scale}" fill="url(#${gradId})"/>
    <text x="${24 * scale}" y="${ty}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${fs}" font-weight="bold" fill="white">LD</text>
  </g>`
}

/**
 * 渐变定义
 * - ldGrad: 品牌紫蓝对角渐变（#667eea → #764ba2，与 LdLogo 一致）
 * - bgGrad: 安装器背景垂直渐变（品牌色上→下）
 * - uninstBgGrad: 卸载器背景垂直渐变（暗紫色，区分语义）
 * - uninstGrad: 卸载器 logo 渐变（暗紫调）
 */
function gradDefs() {
  return `<defs>
    <linearGradient id="${GRAD_ID}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${COLORS.brandStart}"/>
      <stop offset="100%" stop-color="${COLORS.brandEnd}"/>
    </linearGradient>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${COLORS.brandStart}"/>
      <stop offset="100%" stop-color="${COLORS.brandEnd}"/>
    </linearGradient>
    <linearGradient id="uninstBgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${COLORS.uninstStart}"/>
      <stop offset="100%" stop-color="${COLORS.uninstEnd}"/>
    </linearGradient>
    <linearGradient id="uninstGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${COLORS.uninstStart}"/>
      <stop offset="100%" stop-color="${COLORS.uninstEnd}"/>
    </linearGradient>
  </defs>`
}

/**
 * 装饰：右上角半透明大圆（增加层次感，现代设计语言）
 * @param {number} cx 圆心 x
 * @param {number} cy 圆心 y
 * @param {number} r 半径
 * @param {string} fill 填充色
 */
function decoCircle(cx, cy, r, fill) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`
}

/** 安装向导顶部 banner SVG (150×57) — 品牌渐变背景 + LD logo + Living Dashboard */
function bannerSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  ${gradDefs()}
  <!-- 品牌渐变背景（水平 #667eea → #764ba2） -->
  <rect width="150" height="57" fill="url(#${GRAD_ID})"/>
  <!-- 右上角装饰半透明圆（层次感） -->
  ${decoCircle(140, -10, 28, COLORS.white10)}
  <!-- LD logo 28×28，垂直居中 y=(57-28)/2≈14.5 -->
  ${logoGlyph(28, 12, 15)}
  <!-- 主标题 Living Dashboard（白色，居中字体） -->
  <text x="48" y="30" font-family="${FONT_STACK}" font-size="13" font-weight="600" fill="${COLORS.text}" letter-spacing="0.2">Living Dashboard</text>
  <!-- 副标题版本号 -->
  <text x="48" y="44" font-family="${FONT_STACK}" font-size="8" fill="${COLORS.textDim}" letter-spacing="0.5">v${VERSION}</text>
  <!-- 底部细分隔线（层次） -->
  <rect x="0" y="56" width="150" height="1" fill="${COLORS.white10}"/>
</svg>`
}

/**
 * 功能图标示意（白色线条图标，代表 Living Dashboard 核心功能）
 * 3 个图标横向排列，用于 sidebar 中部装饰
 * @param {number} y 图标行 y 坐标
 * @param {string} fill 图标填充色
 */
function featureIcons(y, fill) {
  const iconSize = 20
  const gap = 14
  const totalWidth = iconSize * 3 + gap * 2
  const startX = (164 - totalWidth) / 2
  // 图标1：仪表盘网格（4 个小方块）
  const x1 = startX
  const grid = `<g transform="translate(${x1},${y})" fill="${fill}">
    <rect x="0" y="0" width="8" height="8" rx="1.5"/>
    <rect x="12" y="0" width="8" height="8" rx="1.5"/>
    <rect x="0" y="12" width="8" height="8" rx="1.5"/>
    <rect x="12" y="12" width="8" height="8" rx="1.5"/>
  </g>`
  // 图标2：图层堆叠（3 层菱形）
  const x2 = startX + iconSize + gap
  const layers = `<g transform="translate(${x2},${y})" fill="none" stroke="${fill}" stroke-width="1.5" stroke-linejoin="round">
    <path d="M 10 0 L 20 5 L 10 10 L 0 5 Z"/>
    <path d="M 0 9 L 10 14 L 20 9"/>
    <path d="M 0 13 L 10 18 L 20 13"/>
  </g>`
  // 图标3：AI 星花（四角星 + 中心点）
  const x3 = startX + (iconSize + gap) * 2
  const spark = `<g transform="translate(${x3},${y})" fill="${fill}">
    <path d="M 10 0 L 11.5 8.5 L 20 10 L 11.5 11.5 L 10 20 L 8.5 11.5 L 0 10 L 8.5 8.5 Z"/>
  </g>`
  return grid + layers + spark
}

/**
 * sidebar 通用布局 (164×314) — 现代风格
 * @param {object} opts 配置
 * @param {string} opts.bgGrad 背景渐变 id
 * @param {string} opts.logoGrad logo 渐变 id
 * @param {string} opts.subtitle 副标题（INSTALLER / UNINSTALLER）
 * @param {string} opts.tagline 底部 tagline
 * @param {string} opts.iconFill 功能图标填充色
 * @param {boolean} opts.showFeatures 是否显示功能图标
 */
function sidebarSvg(opts) {
  const { bgGrad, logoGrad, subtitle, tagline, iconFill, showFeatures } = opts
  return `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  ${gradDefs()}
  <!-- 背景渐变（垂直） -->
  <rect width="164" height="314" fill="url(#${bgGrad})"/>
  <!-- 右上角装饰半透明大圆（层次感） -->
  ${decoCircle(150, -30, 60, COLORS.white10)}
  ${decoCircle(-20, 280, 50, COLORS.white10)}
  <!-- LD logo 56×56，居中 x=(164-56)/2=54，y=40 -->
  ${logoGlyph(56, 54, 40, logoGrad)}
  <!-- 主标题 Living Dashboard -->
  <text x="82" y="130" text-anchor="middle" font-family="${FONT_STACK}" font-size="16" font-weight="600" fill="${COLORS.text}" letter-spacing="0.3">Living Dashboard</text>
  <!-- 版本号 -->
  <text x="82" y="148" text-anchor="middle" font-family="${FONT_STACK}" font-size="9" fill="${COLORS.textDim}" letter-spacing="0.6">Version ${VERSION}</text>
  <!-- 副标题（INSTALLER / UNINSTALLER），大字距增加专业感 -->
  <text x="82" y="170" text-anchor="middle" font-family="${FONT_STACK}" font-size="8" fill="${COLORS.textFaint}" letter-spacing="2.5">${subtitle.toUpperCase()}</text>
  <!-- 中部细分隔线 -->
  <rect x="54" y="190" width="56" height="1" fill="${COLORS.white20}"/>
  ${showFeatures ? featureIcons(210, iconFill) : ''}
  <!-- 底部 tagline -->
  <text x="82" y="285" text-anchor="middle" font-family="${FONT_STACK}" font-size="8" fill="${COLORS.textDim}" letter-spacing="0.3">${tagline}</text>
  <!-- 底部品牌渐变横条（与 banner 呼应） -->
  <rect x="0" y="306" width="164" height="8" fill="url(#${logoGrad})"/>
</svg>`
}

/** 安装向导左侧 sidebar SVG (164×314) */
function installerSidebarSvg() {
  return sidebarSvg({
    bgGrad: 'bgGrad',
    logoGrad: GRAD_ID,
    subtitle: 'Installer',
    tagline: 'Your Intelligent Workspace',
    iconFill: COLORS.white60,
    showFeatures: true,
  })
}

/** 卸载向导左侧 sidebar SVG (164×314) — 暗紫色调区分安装/卸载 */
function uninstallerSidebarSvg() {
  return sidebarSvg({
    bgGrad: 'uninstBgGrad',
    logoGrad: 'uninstGrad',
    subtitle: 'Uninstaller',
    tagline: 'Thank you for using Living Dashboard',
    iconFill: COLORS.white20,
    showFeatures: false,
  })
}

// ---------------------------------------------------------------------------
// 24-bit BMP encoder
// ---------------------------------------------------------------------------

/**
 * 将 sharp 输出的 raw RGB buffer（top-to-bottom, RGB 顺序, 无 padding）
 * 编码为 24-bit bottom-up BMP。
 *
 * BMP 格式（严格遵守）：
 * - File header (14): 'BM' + filesize(4) + reserved(4) + offset(4)
 * - DIB header BITMAPINFOHEADER (40): size=40 + width + height + planes=1 + bpp=24
 *   + compression=0 + imagesize + xppm+ yppm + colorsused=0 + importantcolors=0
 * - Pixel data: BGR 序，每行 4 字节对齐，bottom-up（最后一行存最先）
 *
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgbBuffer length === width * height * 3
 * @returns {Buffer} BMP 文件 buffer
 */
function encodeBmp24(width, height, rgbBuffer) {
  if (rgbBuffer.length !== width * height * 3) {
    throw new Error(
      `encodeBmp24: rgbBuffer length mismatch, got ${rgbBuffer.length}, expected ${width * height * 3}`,
    )
  }

  // 每行 4 字节对齐
  const rowSize = ((width * 3 + 3) & ~3) >>> 0
  const pixelDataSize = rowSize * height
  const fileSize = 14 + 40 + pixelDataSize

  const buf = Buffer.alloc(fileSize)
  let o = 0

  // ---- File header (14 bytes) ----
  buf.write('BM', o, 'ascii')
  o += 2
  buf.writeUInt32LE(fileSize, o)
  o += 4
  buf.writeUInt32LE(0, o) // reserved
  o += 4
  buf.writeUInt32LE(54, o) // offset to pixel data = 14 + 40
  o += 4

  // ---- DIB header BITMAPINFOHEADER (40 bytes) ----
  buf.writeUInt32LE(40, o) // header size
  o += 4
  buf.writeInt32LE(width, o)
  o += 4
  buf.writeInt32LE(height, o) // positive => bottom-up
  o += 4
  buf.writeUInt16LE(1, o) // planes
  o += 2
  buf.writeUInt16LE(24, o) // bpp
  o += 2
  buf.writeUInt32LE(0, o) // compression BI_RGB
  o += 4
  buf.writeUInt32LE(pixelDataSize, o) // image size
  o += 4
  buf.writeInt32LE(2835, o) // x pixels per meter (~72 DPI)
  o += 4
  buf.writeInt32LE(2835, o) // y pixels per meter
  o += 4
  buf.writeUInt32LE(0, o) // colors used
  o += 4
  buf.writeUInt32LE(0, o) // important colors
  o += 4

  // ---- Pixel data (bottom-up, BGR, row-padded) ----
  const srcStride = width * 3 // sharp raw RGB: no padding
  for (let y = height - 1; y >= 0; y--) {
    const srcRowStart = y * srcStride
    // 写一行的 BGR 像素
    for (let x = 0; x < width; x++) {
      const si = srcRowStart + x * 3
      buf[o] = rgbBuffer[si + 2] // B
      buf[o + 1] = rgbBuffer[si + 1] // G
      buf[o + 2] = rgbBuffer[si] // R
      o += 3
    }
    // 行尾 padding（rowSize - width*3 字节，已 alloc 为 0）
    o += rowSize - width * 3
  }

  return buf
}

// ---------------------------------------------------------------------------
// SVG → BMP 流水线
// ---------------------------------------------------------------------------

/**
 * 用 sharp 将 SVG 渲染为指定尺寸的 raw RGB buffer，再编码为 24-bit BMP。
 * @param {string} svg
 * @param {number} width
 * @param {number} height
 * @param {string} flattenBg flatten 背景色（去掉 alpha 用）
 * @returns {Promise<Buffer>} BMP buffer
 */
async function svgToBmp(svg, width, height, flattenBg = COLORS.brandStart) {
  const rawRgb = await sharp(Buffer.from(svg))
    .resize(width, height, { fit: 'fill' })
    .flatten({ background: flattenBg }) // 安全保险：去掉任何残留 alpha
    .removeAlpha()
    .raw()
    .toBuffer()

  return encodeBmp24(width, height, rawRgb)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[generate-nsis-branding] build dir:', BUILD_DIR)
  console.log('[generate-nsis-branding] brand: Living Dashboard (LD Logo), version:', VERSION)
  await mkdir(BUILD_DIR, { recursive: true })

  const tasks = [
    { name: 'installer-banner.bmp', svg: bannerSvg(), w: 150, h: 57, bg: COLORS.brandStart },
    { name: 'installer-sidebar.bmp', svg: installerSidebarSvg(), w: 164, h: 314, bg: COLORS.brandStart },
    { name: 'uninstaller-sidebar.bmp', svg: uninstallerSidebarSvg(), w: 164, h: 314, bg: COLORS.uninstStart },
  ]

  for (const t of tasks) {
    const bmp = await svgToBmp(t.svg, t.w, t.h, t.bg)
    const out = resolve(BUILD_DIR, t.name)
    await writeFile(out, bmp)
    const st = await stat(out)
    console.log(
      `[generate-nsis-branding] ${t.name}  ${t.w}×${t.h}  ${st.size} bytes  (${(st.size / 1024).toFixed(1)} KB)`,
    )
  }

  console.log('[generate-nsis-branding] Done.')
}

main().catch((err) => {
  console.error('[generate-nsis-branding] Failed:', err)
  process.exit(1)
})
