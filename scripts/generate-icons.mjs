/**
 * 应用图标生成脚本 — Phase 13 A 线 13.1.2
 *
 * 从 client/desktop/src/assets/logo.png 生成：
 * - build/icon.ico       多分辨率 (256/128/64/48/32/16)
 * - build/icon.png       256x256 PNG
 * - build/tray-icon.png  32x32 PNG 透明背景
 *
 * 用法：node scripts/generate-icons.mjs
 *
 * 依赖：sharp、png-to-ico（devDependencies，已通过 npm install 安装）
 */

import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const LOGO = resolve(ROOT, 'client/desktop/src/assets/logo.png')
const BUILD_DIR = resolve(ROOT, 'build')

// ICO 多分辨率清单（与 electron-builder / Windows 资源管理器要求对齐）
const ICO_SIZES = [256, 128, 64, 48, 32, 16]

// 透明背景色（sharp 要求 RGBA 格式）
const TRANSPARENT_BG = { r: 0, g: 0, b: 0, alpha: 0 }

async function main() {
  console.log('[generate-icons] logo source:', LOGO)
  const logoBuffer = await readFile(LOGO)

  await mkdir(BUILD_DIR, { recursive: true })

  // 1. build/icon.png — 256x256 PNG
  const iconPng = await sharp(logoBuffer)
    .resize(256, 256, { fit: 'contain', background: TRANSPARENT_BG })
    .png()
    .toBuffer()
  await writeFile(resolve(BUILD_DIR, 'icon.png'), iconPng)
  console.log('[generate-icons] build/icon.png generated (256x256)')

  // 2. build/tray-icon.png — 32x32 PNG 透明背景
  const trayPng = await sharp(logoBuffer)
    .resize(32, 32, { fit: 'contain', background: TRANSPARENT_BG })
    .png()
    .toBuffer()
  await writeFile(resolve(BUILD_DIR, 'tray-icon.png'), trayPng)
  console.log('[generate-icons] build/tray-icon.png generated (32x32)')

  // 3. build/icon.ico — 多分辨率 ICO
  // 先用 sharp 生成各分辨率的 PNG buffer，再交给 png-to-ico 合成 ICO
  const pngBuffersForIco = await Promise.all(
    ICO_SIZES.map((size) =>
      sharp(logoBuffer)
        .resize(size, size, { fit: 'contain', background: TRANSPARENT_BG })
        .png()
        .toBuffer(),
    ),
  )
  const icoBuffer = await pngToIco(pngBuffersForIco)
  await writeFile(resolve(BUILD_DIR, 'icon.ico'), icoBuffer)
  console.log(
    '[generate-icons] build/icon.ico generated (sizes:',
    ICO_SIZES.join(', '),
    ')',
  )

  console.log('[generate-icons] Done.')
}

main().catch((err) => {
  console.error('[generate-icons] Failed:', err)
  process.exit(1)
})
