// ============================================================================
// 图片编辑模块（2026-08-02）
// ----------------------------------------------------------------------------
// 面向 AI 与用户的图片处理能力：
// - remove-background（去白底）：纯 JS 实现（PNG 解码→阈值抠白→编码），零外部依赖，
//   任何服务器开箱即用；ImageMagick/ffmpeg 可用时作为增强后端（更快的 fuzz 羽化）。
// - convert / resize / crop / rotate / watermark：优先 ImageMagick，其次 ffmpeg；
//   两者都不可用时返回明确错误（不静默失败）。
// ============================================================================

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import zlib from 'node:zlib'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// PNG 编解码（纯 JS，支持 8bit 灰度/RGB/RGBA、非隔行）
// ---------------------------------------------------------------------------

interface PngInfo {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlace: number
  rgba: Buffer // width * height * 4
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

/** 解码 PNG → RGBA（仅支持 8bit、非隔行；失败抛错） */
export function decodePng(buffer: Buffer): PngInfo {
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!buffer || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error('不是有效的 PNG 文件')
  }
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idatChunks: Buffer[] = []
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idatChunks.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (!width || !height) throw new Error('PNG 缺少 IHDR')
  if (bitDepth !== 8) throw new Error(`仅支持 8bit PNG（当前 ${bitDepth}bit）`)
  if (interlace !== 0) throw new Error('暂不支持隔行 PNG')

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`不支持的 PNG 色彩类型 ${colorType}`)

  const raw = zlib.inflateSync(Buffer.concat(idatChunks))
  const stride = width * channels
  const rgba = Buffer.alloc(width * height * 4)
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    if (pa <= pb && pa <= pc) return a
    if (pb <= pc) return b
    return c
  }
  const prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const recon = Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? recon[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let val = line[x]
      if (filter === 1) val = (val + a) & 0xFF
      else if (filter === 2) val = (val + b) & 0xFF
      else if (filter === 3) val = (val + Math.floor((a + b) / 2)) & 0xFF
      else if (filter === 4) val = (val + paeth(a, b, c)) & 0xFF
      recon[x] = val
    }
    for (let x = 0; x < width; x++) {
      const src = x * channels
      const dst = (y * width + x) * 4
      if (colorType === 6) {
        rgba[dst] = recon[src]
        rgba[dst + 1] = recon[src + 1]
        rgba[dst + 2] = recon[src + 2]
        rgba[dst + 3] = recon[src + 3]
      } else if (colorType === 2) {
        rgba[dst] = recon[src]
        rgba[dst + 1] = recon[src + 1]
        rgba[dst + 2] = recon[src + 2]
        rgba[dst + 3] = 255
      } else if (colorType === 0) {
        rgba[dst] = recon[src]
        rgba[dst + 1] = recon[src]
        rgba[dst + 2] = recon[src]
        rgba[dst + 3] = 255
      } else if (colorType === 4) {
        rgba[dst] = recon[src]
        rgba[dst + 1] = recon[src]
        rgba[dst + 2] = recon[src]
        rgba[dst + 3] = recon[src + 1]
      } else if (colorType === 3) {
        throw new Error('暂不支持索引色 PNG')
      }
    }
    prev.set(recon)
  }
  return { width, height, bitDepth, colorType, interlace, rgba }
}

/** 编码 RGBA → PNG（8bit RGBA 非隔行） */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const stride = width * 4
  const rawSize = (stride + 1) * height
  const raw = Buffer.alloc(rawSize)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const idat = zlib.deflateSync(raw, { level: 6 })
  return Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------
// 去白底（纯 JS 实现，零依赖）
// ---------------------------------------------------------------------------

export interface RemoveBgOptions {
  /** 欧氏距离阈值（0-255²×3 开方）。默认 40（对应 -fuzz 约 15%） */
  threshold?: number
  /** 边缘羽化：阈值 ±fuzz 区间内线性过渡 alpha（0-255）。默认 20 */
  feather?: number
}

/**
 * 去除白色/近白背景（纯 JS）：
 * 对每个像素，若其与纯白(255,255,255)的欧氏距离 ≤ threshold 则 alpha=0；
 * 在 threshold ~ threshold+feather 区间做线性过渡（半透明），避免硬边锯齿。
 */
export function removeWhiteBackground(input: Buffer, options: RemoveBgOptions = {}): Buffer {
  const threshold = Math.max(0, Math.min(200, Number(options.threshold) || 40))
  const feather = Math.max(0, Math.min(100, Number(options.feather) ?? 20))
  const png = decodePng(input)
  const { width, height, rgba } = png
  const out = Buffer.from(rgba)
  const t2 = threshold * threshold
  const softStart = Math.max(0, threshold - feather)
  const softEnd = threshold + feather
  for (let i = 0; i < width * height; i++) {
    const p = i * 4
    const r = out[p]
    const g = out[p + 1]
    const b = out[p + 2]
    const dr = 255 - r
    const dg = 255 - g
    const db = 255 - b
    const dist = Math.sqrt(dr * dr + dg * dg + db * db)
    if (dist <= threshold) {
      // 阈值内完全透明；软区间线性过渡
      let alpha = 0
      if (dist > softStart && softEnd > softStart) {
        alpha = Math.round(((dist - softStart) / (softEnd - softStart)) * 255)
      }
      const orig = out[p + 3]
      out[p + 3] = Math.min(orig, alpha)
    }
  }
  return encodePng(width, height, out)
}

// ---------------------------------------------------------------------------
// 纯 JS 图像缩放（双线性插值，零依赖兜底；ImageMagick 可用时优先用 convert）
// ---------------------------------------------------------------------------

/** 读取 PNG 尺寸（不解码全部像素，仅解析 IHDR；失败返回 null） */
export function pngSizeOf(buffer: Buffer): { width: number; height: number } | null {
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!buffer || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) return null
  try {
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    return { width, height }
  } catch {
    return null
  }
}

/**
 * 通用图片尺寸探测（2026-08-14）：支持 PNG（IHDR）/ JPEG（SOF0/1/2 标记）/
 * GIF（逻辑屏幕描述符）/ WebP（VP8 / VP8L / VP8X）。不解码全部像素，失败返回 null。
 * 用途：素材工具（generate_image/edit_image/edit_video）返回产物尺寸，AI 拿到
 * 真实像素尺寸写游戏碰撞/布局，避免"猜尺寸导致判定偏差"。
 */
export function imageSizeOf(buffer: Buffer): { width: number; height: number } | null {
  if (!buffer || buffer.length < 16) return null
  // PNG
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return pngSizeOf(buffer)
  }
  // GIF（header 6 字节 + LSD 4 字节）
  if (buffer.subarray(0, 6).toString('ascii').startsWith('GIF8')) {
    try {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
    } catch { return null }
  }
  // JPEG：扫描 SOF0/1/2（FFC0/FFC1/FFC2）标记
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    try {
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue }
        const marker = buffer[offset + 1]
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
        const len = buffer.readUInt16BE(offset + 2)
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          const height = buffer.readUInt16BE(offset + 5)
          const width = buffer.readUInt16BE(offset + 7)
          if (width > 0 && height > 0) return { width, height }
        }
        offset += 2 + len
      }
    } catch { return null }
    return null
  }
  // WebP：RIFF....WEBP
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    try {
      const chunk = buffer.subarray(12, 12 + 8)
      const fourcc = chunk.subarray(0, 4).toString('ascii')
      if (fourcc === 'VP8 ') { // 丢帧 VP8：帧头 3 字节 + 尺寸 2+2
        const w = buffer.readUInt16LE(26) & 0x3fff
        const h = buffer.readUInt16LE(28) & 0x3fff
        if (w > 0 && h > 0) return { width: w, height: h }
      } else if (fourcc === 'VP8L') { // 无损 VP8L：14 字节头后 4 字节打包尺寸
        const b0 = buffer[21] ?? 0, b1 = buffer[22] ?? 0, b2 = buffer[23] ?? 0, b3 = buffer[24] ?? 0
        const w = 1 + (((b1 & 0x3f) << 8) | b0)
        const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
        if (w > 0 && h > 0) return { width: w, height: h }
      } else if (fourcc === 'VP8X') { // 扩展：24 字节头后 3+3 字节尺寸（-1）
        const w = 1 + buffer.readUIntLE(24, 3)
        const h = 1 + buffer.readUIntLE(27, 3)
        if (w > 0 && h > 0) return { width: w, height: h }
      }
    } catch { return null }
    return null
  }
  return null
}

/**
 * 纯 JS 缩放 PNG（双线性插值）。仅支持 8bit 非隔行 PNG（decodePng 支持的范围）。
 * 目标尺寸与源尺寸相同时原样返回。
 */
export function resizePng(input: Buffer, targetWidth: number, targetHeight: number): Buffer {
  const png = decodePng(input)
  const { width, height, rgba } = png
  if (width === targetWidth && height === targetHeight) return input
  if (targetWidth <= 0 || targetHeight <= 0 || targetWidth > 8192 || targetHeight > 8192) {
    throw new Error(`非法目标尺寸：${targetWidth}x${targetHeight}`)
  }
  const out = Buffer.alloc(targetWidth * targetHeight * 4)
  const xRatio = width / targetWidth
  const yRatio = height / targetHeight
  for (let y = 0; y < targetHeight; y++) {
    const srcY = y * yRatio
    const y0 = Math.floor(srcY)
    const y1 = Math.min(height - 1, y0 + 1)
    const fy = srcY - y0
    for (let x = 0; x < targetWidth; x++) {
      const srcX = x * xRatio
      const x0 = Math.floor(srcX)
      const x1 = Math.min(width - 1, x0 + 1)
      const fx = srcX - x0
      const dst = (y * targetWidth + x) * 4
      for (let c = 0; c < 4; c++) {
        const p00 = rgba[(y0 * width + x0) * 4 + c]
        const p10 = rgba[(y0 * width + x1) * 4 + c]
        const p01 = rgba[(y1 * width + x0) * 4 + c]
        const p11 = rgba[(y1 * width + x1) * 4 + c]
        const top = p00 + (p10 - p00) * fx
        const bottom = p01 + (p11 - p01) * fx
        out[dst + c] = Math.round(top + (bottom - top) * fy)
      }
    }
  }
  return encodePng(targetWidth, targetHeight, out)
}

/** 强制把 PNG 缩放到目标尺寸：优先 ImageMagick（convert），失败回退纯 JS */
export async function resizePngToSize(input: Buffer, targetSize: string): Promise<Buffer> {
  const match = /^(\d+)x(\d+)$/.exec(targetSize)
  if (!match) return input
  const tw = Number(match[1])
  const th = Number(match[2])
  const info = pngSizeOf(input)
  if (!info) return input
  if (info.width === tw && info.height === th) return input
  // ImageMagick 优先（质量高、速度快）
  try {
    const magick = await commandExists('convert')
    if (magick) {
      const fs = await import('node:fs')
      const tmpIn = `/tmp/img_resize_${Date.now()}_${Math.floor(Math.random() * 1e9)}.png`
      const tmpOut = `/tmp/img_resize_${Date.now()}_${Math.floor(Math.random() * 1e9)}.png`
      fs.writeFileSync(tmpIn, input)
      await execFileAsync('convert', [tmpIn, '-resize', `${tw}x${th}!`, tmpOut], { maxBuffer: 64 * 1024 * 1024 })
      const out = fs.readFileSync(tmpOut)
      fs.rmSync(tmpIn, { force: true })
      fs.rmSync(tmpOut, { force: true })
      return out
    }
  } catch { /* 回退纯 JS */ }
  return resizePng(input, tw, th)
}

// ---------------------------------------------------------------------------
// 外部工具（ImageMagick / ffmpeg）封装
// ---------------------------------------------------------------------------

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync('which', [command])
    return true
  } catch {
    return false
  }
}

export interface EditImageParams {
  operation: 'remove-background' | 'convert' | 'resize' | 'crop' | 'rotate' | 'watermark'
  /** 目标格式：png / jpg / webp（convert 用） */
  format?: string
  /** 质量 1-100（jpg/webp） */
  quality?: number
  /** resize：'50%' 或 '宽x高'（如 512x512，等比用 512x 或 x512） */
  size?: string
  /** crop：'宽x高+x+y'（如 100x100+50+50） */
  crop?: string
  /** rotate：角度（90/180/270） */
  rotate?: number
  /** watermark：文字水印内容 */
  text?: string
  /** watermark：位置 nw/n/ne/w/center/e/sw/s/se */
  gravity?: string
  /** remove-background 阈值（0-200，默认 40） */
  threshold?: number
}

export interface EditImageResult {
  ok: boolean
  buffer?: Buffer
  engine?: string // 'js' | 'imagemagick' | 'ffmpeg'
  errorCode?: string
  errorMessage?: string
}

/**
 * 执行图片编辑。remove-background 用纯 JS（零依赖，任何环境可用）；
 * 其他操作需要 ImageMagick 或 ffmpeg，两者均不可用时返回明确错误。
 */
export async function editImage(input: Buffer, params: EditImageParams): Promise<EditImageResult> {
  try {
    switch (params.operation) {
      case 'remove-background':
        return {
          ok: true,
          buffer: removeWhiteBackground(input, { threshold: params.threshold }),
          engine: 'js',
        }

      case 'convert':
      case 'resize':
      case 'crop':
      case 'rotate':
      case 'watermark': {
        const magick = await commandExists('convert')
        const ffmpeg = await commandExists('ffmpeg')
        if (magick) return await viaImageMagick(input, params)
        if (ffmpeg) return await viaFFmpeg(input, params)
        return {
          ok: false,
          errorCode: 'IMAGE_EDIT_TOOL_MISSING',
          errorMessage: '服务器未安装 ImageMagick/ffmpeg，无法执行该操作（remove-background 始终可用）',
        }
      }
      default:
        return { ok: false, errorCode: 'UNKNOWN_OPERATION', errorMessage: `未知操作：${params.operation}` }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'EDIT_FAILED',
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : String(error),
    }
  }
}

/** ImageMagick 实现：convert 原生支持 resize/crop/rotate/format/水印 */
async function viaImageMagick(input: Buffer, params: EditImageParams): Promise<EditImageResult> {
  const tmpIn = `/tmp/img_edit_${Date.now()}_${Math.floor(Math.random() * 1e9)}.png`
  const tmpOut = `/tmp/img_edit_${Date.now()}_${Math.floor(Math.random() * 1e9)}.${params.format === 'jpg' ? 'jpg' : params.format === 'webp' ? 'webp' : 'png'}`
  const fs = await import('node:fs')
  fs.writeFileSync(tmpIn, input)
  const args: string[] = []
  if (params.size) args.push('-resize', params.size!)
  if (params.crop) args.push('-crop', params.crop!)
  if (params.rotate) args.push('-rotate', String(params.rotate))
  if (params.format === 'jpg' || params.format === 'webp') {
    args.push('-quality', String(params.quality ?? 90))
  }
  if (params.operation === 'watermark') {
    if (!params.text) return { ok: false, errorCode: 'NO_TEXT', errorMessage: 'watermark 需要 text 参数' }
    args.push('-gravity', params.gravity ?? 'southeast', '-pointsize', '36', '-fill', 'white', '-annotate', '+12+12', params.text)
  }
  args.push(tmpOut)
  await execFileAsync('convert', [tmpIn, ...args])
  const out = fs.readFileSync(tmpOut)
  fs.rmSync(tmpIn, { force: true })
  fs.rmSync(tmpOut, { force: true })
  return { ok: true, buffer: out, engine: 'imagemagick' }
}

/** ffmpeg 实现：scale/crop/rotate/format 可用，水印用 drawtext */
async function viaFFmpeg(input: Buffer, params: EditImageParams): Promise<EditImageResult> {
  const tmpIn = `/tmp/img_edit_${Date.now()}_${Math.floor(Math.random() * 1e9)}.png`
  const tmpOut = `/tmp/img_edit_${Date.now()}_${Math.floor(Math.random() * 1e9)}.${params.format === 'jpg' ? 'jpg' : params.format === 'webp' ? 'webp' : 'png'}`
  const fs = await import('node:fs')
  fs.writeFileSync(tmpIn, input)
  const filters: string[] = []
  if (params.size) {
    const size = params.size!
    if (size.endsWith('%')) {
      const pct = Number(size.slice(0, -1)) / 100
      filters.push(`scale=iw*${pct}:ih*${pct}`)
    } else if (size.includes('x')) {
      filters.push(`scale=${size.replace('x', ':')}`)
    }
  }
  if (params.crop) {
    const m = params.crop.match(/^(\d+)x(\d+)([+-]\d+)?([+-]\d+)?$/)
    if (m) filters.push(`crop=${m[1]}:${m[2]}${m[3] ? `:${Number(m[3]) < 0 ? '' : ''}${m[3]}` : ''}${m[4] ? `:${m[4]}` : ''}`)
  }
  if (params.rotate) filters.push(`rotate=${(Number(params.rotate) * Math.PI) / 180}:ow=iw:oh=ih`)
  if (params.operation === 'watermark' && params.text) {
    filters.push(`drawtext=text='${String(params.text).replace(/'/g, "\\'")}':fontsize=36:fontcolor=white:x=w-tw-12:y=h-th-12`)
  }
  if (filters.length === 0 && params.format) {
    filters.push('null')
  }
  const args = ['-y', '-i', tmpIn]
  if (filters.length > 0) args.push('-vf', filters.join(','))
  if (params.format === 'jpg' || params.format === 'webp') args.push('-q:v', String(Math.round((params.quality ?? 90) / 10)))
  args.push(tmpOut)
  await execFileAsync('ffmpeg', args, { maxBuffer: 64 * 1024 * 1024 })
  const out = fs.readFileSync(tmpOut)
  fs.rmSync(tmpIn, { force: true })
  fs.rmSync(tmpOut, { force: true })
  return { ok: true, buffer: out, engine: 'ffmpeg' }
}