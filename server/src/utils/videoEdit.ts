// ============================================================================
// 视频处理模块（2026-08-06，FFmpeg）
// ----------------------------------------------------------------------------
// 面向 AI 的视频/动图处理（参考 frameronin.com 类网站能力，用系统 ffmpeg 实现）：
// - extract-frames   抽帧/序列帧（-vf fps=N 输出 img%04d.png 序列）
// - sprite-sheet     抽 N 帧拼成精灵图（tile 一行，App 里做帧动画/跑酷角色）
// - to-gif           转 GIF（fps + scale + palette）
// - poster           提取首帧封面 jpg（视频秒开预览用）
// - trim             裁剪片段（-ss -t）
// - crop             画面裁剪
// - scale            缩放/分辨率调整
// - extract-audio    提取音频 mp3
// - mute             静音
// - speed            倍速（0.5-4x）
// - remove-bg        绿幕/纯色背景去除（chroma key → 带 alpha 的 webm；仅限纯色背景，
//                    复杂背景做不到——与 AI 抠图不同，工具描述里明确说明）
// - concat           拼接多个视频（同编码参数）
// - filter           图片/视频帧滤镜（eq/hue/gblur/colorlevels/negate/alpha，结构化参数）
// - rotate/flip      旋转/翻转（90/180/270 用 transpose 无损，其他角度 rotate 黑底）
// - convert          格式转换（png/jpg/webp/gif/mp4/webm）
// - watermark        图片 overlay / 文字 drawtext 水印
// - tile             多图网格拼图（ImageMagick montage）
// - volume           音频音量
//
// 输出统一落工作区 agent/media/（AI 可管理），并双写到全局公开目录供 App/iframe 使用。
// 调用方（webos.ts edit_video 工具）负责权限、落库与计费。
// ============================================================================

import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { imageSizeOf } from './imageEdit.js'

const execFileAsync = (cmd: string, args: string[], timeoutMs = 120_000): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 128 * 1024 * 1024, timeout: timeoutMs }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })

/** 支持的输入视频扩展名 */
const VIDEO_EXTS = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v']
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp']
const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus']

export function isVideoFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase()
  return VIDEO_EXTS.includes(ext) || IMAGE_EXTS.includes(ext) || AUDIO_EXTS.includes(ext)
}

function clampNum(value: unknown, min: number, max: number, def: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

/** drawtext 文本转义：\ : ' , % 前加反斜杠（供 FFmpeg filter 解析） */
function escapeDrawText(text: string): string {
  return text.replace(/([\\:,'%])/g, '\\$1')
}

/** 从系统字体列表里挑一个存在的字体；找不到返回 null */
function findFontFile(): string | null {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
  ]
  return candidates.find((f) => fs.existsSync(f)) ?? null
}

/** 解析 #RRGGBBAA 为 FFmpeg 可用的 fontcolor（不支持 8 位 hex 时原样返回） */
function parseColor(color: string): string {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/.exec(color.trim())
  if (!m) return color.trim()
  const alpha = parseInt(m[2]!, 16) / 255
  return `0x${m[1]}@${alpha.toFixed(3)}`
}

export interface EditVideoParams {
  operation:
    | 'extract-frames' | 'sprite-sheet' | 'to-sprite' | 'to-gif' | 'poster' | 'trim' | 'crop'
    | 'scale' | 'extract-audio' | 'mute' | 'speed' | 'remove-bg' | 'concat'
    | 'filter' | 'rotate' | 'flip' | 'convert' | 'watermark' | 'tile' | 'volume'
  /** 源文件工作区绝对路径（concat 时是数组） */
  input: string | string[]
  /** 输出目录（工作区绝对路径）；默认调用方给的 agent/media/ 下自动建子目录 */
  outputDir: string
  /** extract-frames：目标帧率（默认 8）；sprite-sheet/to-sprite：总帧数（默认 8） */
  frames?: number
  /** to-gif：fps（默认 10）与宽度（默认 480） */
  gifFps?: number
  gifWidth?: number
  /** trim：开始秒数与时长（秒） */
  start?: number
  duration?: number
  /** crop：宽x高+x+y（如 400x400+100+100） */
  crop?: string
  /** scale：宽x高（如 512x512 / -1:480 / 50%） */
  size?: string
  /** speed：倍速 0.5-4（默认 1） */
  speed?: number
  /** remove-bg：背景颜色（green/blue/white/black，默认 green）与相似度（0-1，默认 0.1） */
  bgColor?: string
  similarity?: number
  /** filter：图片/视频帧滤镜 */
  contrast?: number
  brightness?: number
  saturation?: number
  gamma?: number
  blur?: number
  alpha?: number
  darken?: number
  hue?: number
  negate?: boolean
  /** rotate/flip */
  degrees?: number
  direction?: string
  /** convert */
  to?: string
  quality?: number
  /** watermark */
  watermarkPath?: string
  text?: string
  position?: string
  margin?: number
  scale?: number
  fontsize?: number
  color?: string
  /** tile */
  columns?: number
  gap?: number
  background?: string
  /** volume */
  level?: number
}

export interface EditVideoResult {
  ok: boolean
  /** 输出文件（工作区相对路径，多个时是数组）；图片产物含真实像素尺寸 width/height */
  files: Array<{ path: string; url: string; kind: 'video' | 'image' | 'audio'; width?: number; height?: number }>
  durationMs: number
  errorCode?: string
  errorMessage?: string
}

function publicDirs(): { videoDir: string; imageDir: string } {
  return {
    videoDir: path.join(process.cwd(), 'data', 'webos-public-videos'),
    imageDir: path.join(process.cwd(), 'data', 'webos-public-images'),
  }
}

/** 复制产物到公开目录并返回 URL（视频→videogen 端点；图片/gif/音频→imagegen/或 audio 端点）。
 *  2026-08-14 产物尺寸探测：图片用 imageSizeOf（PNG/JPEG/GIF/WebP 头解析），视频用 ffprobe——
 *  AI 拿到真实像素尺寸写游戏碰撞/布局，避免"猜尺寸"导致判定偏差。 */
async function publishFile(srcFull: string, dstBase: string, kind: EditVideoResult['files'][number]['kind']): Promise<EditVideoResult['files'][number]> {
  const name = path.basename(srcFull)
  const dirs = publicDirs()
  const dstDir = kind === 'video' ? dirs.videoDir : dirs.imageDir
  fs.mkdirSync(dstDir, { recursive: true })
  try { fs.copyFileSync(srcFull, path.join(dstDir, name)) } catch { /* 公开副本失败不阻断 */ }
  let dim: { width: number; height: number } | null = null
  try {
    if (kind === 'image') {
      const buf = fs.readFileSync(srcFull)
      dim = imageSizeOf(buf)
    } else if (kind === 'video') {
      dim = await videoSizeOf(srcFull)
    }
  } catch { /* 尺寸探测失败不阻断 */ }
  if (kind === 'video') return { path: name, url: `/webos/api/videogen/file/${encodeURIComponent(name)}`, kind, ...(dim ? { width: dim.width, height: dim.height } : {}) }
  if (kind === 'audio') return { path: name, url: `/webos/api/imagegen/file/${encodeURIComponent(name)}`, kind }
  return { path: name, url: `/webos/api/imagegen/file/${encodeURIComponent(name)}`, kind, ...(dim ? { width: dim.width, height: dim.height } : {}) }
}

/** 视频尺寸探测（ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json）；失败返回 null */
async function videoSizeOf(file: string): Promise<{ width: number; height: number } | null> {
  try {
    const out = await new Promise<string>((resolve, reject) => {
      execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], { maxBuffer: 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
    })
    const parsed = JSON.parse(out) as { streams?: Array<{ width?: number; height?: number }> }
    const stream = parsed.streams?.[0]
    if (stream && stream.width && stream.height) return { width: stream.width, height: stream.height }
    return null
  } catch {
    return null
  }
}

/**
 * 执行视频处理。返回产物（工作区相对路径 + 公开 URL）。
 * 所有输出先写 outputDir（自动建子目录 op-<uuid>/），再双写公开目录。
 */
export async function editVideo(params: EditVideoParams): Promise<EditVideoResult> {
  const startedAt = Date.now()
  const outRoot = path.join(params.outputDir, `op-${randomUUID().slice(0, 8)}`)
  fs.mkdirSync(outRoot, { recursive: true })
  const inputs = Array.isArray(params.input) ? params.input : [params.input]
  const ok = (files: EditVideoResult['files']): EditVideoResult => ({ ok: true, files, durationMs: Date.now() - startedAt })

  try {
    const op = params.operation
    const input0 = inputs[0]!
    if (!input0 || !fs.existsSync(input0)) {
      return { ok: false, files: [], durationMs: Date.now() - startedAt, errorCode: 'INPUT_NOT_FOUND', errorMessage: '输入文件不存在' }
    }
    const ext = path.extname(input0).toLowerCase()
    const isImgInput = IMAGE_EXTS.includes(ext)

    switch (op) {
      // ---- 抽帧 / 序列帧（图片序列，供帧动画/精灵图）----
      case 'extract-frames': {
        const fps = Math.max(1, Math.min(30, Math.floor(Number(params.frames) || 8)))
        const outPattern = path.join(outRoot, 'frame-%03d.png')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-vf', `fps=${fps}`, outPattern])
        const names = fs.readdirSync(outRoot).filter((n) => n.endsWith('.png')).sort()
        if (names.length === 0) throw new Error('未抽到帧')
        const files = await Promise.all(names.map((n) => publishFile(path.join(outRoot, n), outRoot, 'image')))
        return ok(files)
      }

      // ---- 精灵图（抽 N 帧拼成一行，跑酷/帧动画角色）----
      case 'sprite-sheet': {
        const total = Math.max(2, Math.min(24, Math.floor(Number(params.frames) || 8)))
        const outFile = path.join(outRoot, 'sprite.png')
        const fps = Number(params.gifFps) || Math.max(1, Math.round(total / Math.max(1, Number(params.duration) || 4)))
        const size = params.size || '-1:128'
        // tile=Nx1 一行拼图；-frames:v 1 强制单帧输出（否则 image2 muxer 报同名文件错误）
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-vf', `fps=${fps},scale=${size},tile=${total}x1`, '-frames:v', '1', outFile])
        return ok([await publishFile(outFile, outRoot, 'image')])
      }

      // ---- 2026-08-08 一键「视频转透明精灵图」（frameronin 式一站式流程）----
      // 抽帧 → 自动检测背景色 → 抠图（容差/羽化 + despill 抑色）→ 逐帧裁剪到角色
      // 包围盒 → 统一画布 → 拼成一行 Sprite Sheet。AI 生成游戏角色动画一次调用即可，
      // 不需要再分步拼装（对齐 frameronin「视频转序列帧」模块）。
      case 'to-sprite': {
        const total = Math.max(4, Math.min(16, Math.floor(Number(params.frames) || 8)))
        const fps = Number(params.gifFps) || Math.max(1, Math.round(total / Math.max(1, Number(params.duration) || 4)))
        const frameH = Number(String(params.size || '128').replace(/[^0-9]/g, '')) || 128
        const frameW = Math.max(48, Math.round(frameH * 0.75)) // 统一画布宽（角色包围盒约 3:4）
        const framesDir = path.join(outRoot, 'frames')
        const cleanDir = path.join(outRoot, 'clean')
        fs.mkdirSync(framesDir, { recursive: true })
        fs.mkdirSync(cleanDir, { recursive: true })
        // 1) 抽帧 + 缩放（高度 frameH）
        const rawPattern = path.join(framesDir, 'f-%02d.png')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-vf', `fps=${fps},scale=-1:${frameH}`, rawPattern])
        const frames = fs.readdirSync(framesDir).filter((n) => n.endsWith('.png')).sort()
        if (frames.length === 0) throw new Error('未抽到帧')
        const picked = frames.slice(0, total)
        // 2) 背景色检测：取第一帧四角平均色（绿幕/蓝幕/白底/黑底自动识别）
        const firstFull = path.join(framesDir, picked[0]!)
        const corners = ['8,8', `W-8,8`, `8,H-8`, `W-8,H-8`]
        const colors: Array<{ r: number; g: number; b: number }> = []
        const { execFile: execFile2 } = await import('node:child_process')
        for (const corner of corners) {
          try {
            const out = await new Promise<string>((resolve, reject) => {
              execFile2('convert', [firstFull, '-format', `%[pixel:p{${corner}}]`, 'info:'], { maxBuffer: 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
            })
            const m = out.match(/\((\d+),(\d+),(\d+)/)
            if (m) colors.push({ r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) })
          } catch { /* 忽略单角失败 */ }
        }
        // 众数背景色（四角中两两相近的取均值）
        let bg = colors[0] ?? { r: 40, g: 190, b: 58 }
        if (colors.length >= 2) {
          const best = colors.reduce<{ pair: [typeof colors[0], typeof colors[0]] | null; dist: number }>((acc, c, i) => {
            for (let j = i + 1; j < colors.length; j++) {
              const d = Math.abs(c.r - colors[j]!.r) + Math.abs(c.g - colors[j]!.g) + Math.abs(c.b - colors[j]!.b)
              if (d < acc.dist) return { pair: [c, colors[j]!], dist: d }
            }
            return acc
          }, { pair: null, dist: 999 })
          if (best.pair) {
            bg = { r: Math.round((best.pair[0].r + best.pair[1].r) / 2), g: Math.round((best.pair[0].g + best.pair[1].g) / 2), b: Math.round((best.pair[0].b + best.pair[1].b) / 2) }
          }
        }
        const bgHex = `#${[bg.r, bg.g, bg.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
        // 3) 抠图：ImageMagick 背景透明（fuzz 容差）+ 边缘羽化；再 despill 去角色边缘背景色溢
        const fuzzPct = Math.max(18, Math.min(45, Number(params.similarity) * 100 || 28))
        const { execFile: execFileRaw } = await import('node:child_process')
        // 2026-08-08 修复：execFile 是回调版，直接 await 会立即返回（命令还在后台跑），
        // 必须包成 Promise 等命令真正完成——此前 to-sprite 因此读到空目录报「抠图后无可用帧」
        const execFileAsync2 = (cmd: string, args: string[], opts?: { maxBuffer?: number }): Promise<void> =>
          new Promise((resolve, reject) => {
            execFileRaw(cmd, args, opts ?? { maxBuffer: 64 * 1024 * 1024 }, (error) => (error ? reject(error) : resolve()))
          })
        for (const f of picked) {
          const outPng = path.join(cleanDir, `c-${f}`)
          const srcFull = path.join(framesDir, f)
          // -transparent 容差抠背景（多次尝试降低残留），-trim 裁到角色包围盒，-extent 统一画布
          await execFileAsync2('convert', [srcFull, '-fuzz', `${fuzzPct}%`, '-transparent', bgHex, '-trim', '+repage', '-background', 'none', '-gravity', 'center', '-extent', `${frameW}x${frameH}`, outPng])
        }
        // 4) despill：把半透明边缘像素里残留的背景色分量压掉（绿色抑制）
        for (const f of picked) {
          const srcFull = path.join(cleanDir, `c-${f}`)
          const outPng = path.join(cleanDir, `d-${f}`)
          try {
            await execFileAsync2('ffmpeg', ['-y', '-v', 'error', '-i', srcFull, '-vf', `despill=green:0.5:1`, '-c:v', 'png', outPng])
          } catch {
            // despill 不可用则原样保留
            try { fs.copyFileSync(srcFull, outPng) } catch { /* ignore */ }
          }
        }
        // 5) 拼成一行精灵图
        const cleanFiles = picked.map((f) => path.join(cleanDir, `d-${f}`)).filter((p) => fs.existsSync(p))
        if (cleanFiles.length === 0) {
          const listing = (() => { try { return fs.readdirSync(cleanDir).join(',') } catch { return 'readdir-fail' } })()
          const framesListing = (() => { try { return fs.readdirSync(framesDir).join(',') } catch { return 'readdir-fail' } })()
          throw new Error(`抠图后无可用帧（clean=[${listing}] frames=[${framesListing}]）`)
        }
        const spriteFile = path.join(outRoot, 'sprite.png')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(cleanDir, 'd-f-%02d.png'), '-filter_complex', `tile=${cleanFiles.length}x1`, '-frames:v', '1', spriteFile])
        return ok([await publishFile(spriteFile, outRoot, 'image')])
      }

      // ---- 转 GIF ----
      case 'to-gif': {
        const fps = Math.max(4, Math.min(20, Math.floor(Number(params.gifFps) || 10)))
        const width = Number(params.gifWidth) || 480
        const outFile = path.join(outRoot, 'anim.gif')
        // palette 两遍（质量好）
        const paletteFile = path.join(outRoot, 'palette.png')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen`, paletteFile])
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-i', paletteFile, '-lavfi', `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse`, outFile])
        return ok([await publishFile(outFile, outRoot, 'image')])
      }

      // ---- 首帧封面 ----
      case 'poster': {
        const outFile = path.join(outRoot, 'poster.jpg')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-frames:v', '1', '-q:v', '4', outFile])
        return ok([await publishFile(outFile, outRoot, 'image')])
      }

      // ---- 裁剪片段 ----
      case 'trim': {
        const start = Math.max(0, Number(params.start) || 0)
        const duration = Number(params.duration) || 4
        const outFile = path.join(outRoot, 'trim.mp4')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-ss', String(start), '-t', String(duration), '-c', 'copy', '-movflags', '+faststart', outFile])
        return ok([await publishFile(outFile, outRoot, 'video')])
      }

      // ---- 画面裁剪 ----
      case 'crop': {
        if (!params.crop) throw new Error('crop 需要 "宽x高+x+y" 参数')
        const outFile = path.join(outRoot, 'crop.mp4')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-vf', `crop=${params.crop}`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', outFile])
        return ok([await publishFile(outFile, outRoot, 'video')])
      }

      // ---- 缩放 ----
      case 'scale': {
        if (!params.size) throw new Error('scale 需要 size 参数')
        const outFile = path.join(outRoot, 'scaled.mp4')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-vf', `scale=${params.size}`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', outFile])
        return ok([await publishFile(outFile, outRoot, 'video')])
      }

      // ---- 提取音频 ----
      case 'extract-audio': {
        const outFile = path.join(outRoot, 'audio.mp3')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-vn', '-c:a', 'libmp3lame', '-q:a', '4', outFile])
        return ok([await publishFile(outFile, outRoot, 'audio')])
      }

      // ---- 静音 ----
      case 'mute': {
        const outFile = path.join(outRoot, 'muted.mp4')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-an', '-c:v', 'copy', '-movflags', '+faststart', outFile])
        return ok([await publishFile(outFile, outRoot, 'video')])
      }

      // ---- 倍速 ----
      case 'speed': {
        const speed = Math.max(0.5, Math.min(4, Number(params.speed) || 1))
        const outFile = path.join(outRoot, 'speed.mp4')
        const videoFilter = `setpts=${(1 / speed).toFixed(3)}*PTS`
        const audioFilter = speed !== 1 ? `atempo=${Math.min(2, speed).toFixed(3)}${speed > 2 ? `,atempo=${(speed / 2).toFixed(3)}` : ''}` : ''
        const args = ['-y', '-v', 'error', '-i', input0, '-vf', videoFilter]
        if (audioFilter) args.push('-af', audioFilter)
        args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-movflags', '+faststart', outFile)
        await execFileAsync('ffmpeg', args)
        return ok([await publishFile(outFile, outRoot, 'video')])
      }

      // ---- 去背景（chroma key：仅纯色背景；输出带 alpha 的 webm）----
      case 'remove-bg': {
        const colorMap: Record<string, string> = { green: 'green', blue: 'blue', white: 'white', black: 'black' }
        const color = colorMap[String(params.bgColor || 'green').toLowerCase()] || 'green'
        const sim = Math.max(0.01, Math.min(0.9, Number(params.similarity) || 0.1))
        const outFile = path.join(outRoot, 'bg-removed.webm')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-vf', `colorkey=${color}:${sim}:0.15,format=rgba`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '1.5M', outFile])
        return ok([await publishFile(outFile, outRoot, 'video')])
      }

      // ---- 拼接（同参数视频）----
      case 'concat': {
        if (inputs.length < 2) throw new Error('concat 需要至少 2 个输入文件')
        const listFile = path.join(outRoot, 'list.txt')
        fs.writeFileSync(listFile, inputs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))
        const outFile = path.join(outRoot, 'concat.mp4')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outFile])
        return ok([await publishFile(outFile, outRoot, 'video')])
      }

      // ---- 图片/视频帧滤镜（结构化参数，不接受任意 filter 字符串）----
      case 'filter': {
        const contrast = clampNum(params.contrast, 0.1, 3, 1)
        const brightness = clampNum(params.brightness, -1, 1, 0)
        const saturation = clampNum(params.saturation, 0, 3, 1)
        const gamma = clampNum(params.gamma, 0.1, 3, 1)
        const blur = clampNum(params.blur, 0, 50, 0)
        const alpha = clampNum(params.alpha, 0.05, 1, 1)
        const darken = clampNum(params.darken, 0, 0.8, 0)
        const hue = clampNum(params.hue, -180, 180, 0)
        const negate = params.negate === true
        const parts: string[] = []
        parts.push(`eq=contrast=${contrast.toFixed(3)}:brightness=${brightness.toFixed(3)}:saturation=${saturation.toFixed(3)}:gamma=${gamma.toFixed(3)}`)
        if (Math.abs(hue) > 0.001) parts.push(`hue=h=${hue.toFixed(3)}`)
        if (blur > 0) parts.push(`gblur=sigma=${blur.toFixed(3)}`)
        if (darken > 0) {
          const max = (1 - darken).toFixed(3)
          // FFmpeg colorlevels 实际参数名为 romax/gomax/bomax（输出白点），同值压暗
          parts.push(`colorlevels=romax=${max}:gomax=${max}:bomax=${max}`)
        }
        if (negate) parts.push('negate')
        if (alpha < 1) parts.push('format=rgba', `colorchannelmixer=aa=${alpha.toFixed(3)}`)
        const hasAlpha = alpha < 1 || ext === '.png' || ext === '.webp'
        const outExt = hasAlpha ? '.png' : '.jpg'
        const outFile = path.join(outRoot, `filtered${outExt}`)
        const args = ['-y', '-v', 'error', '-i', input0, '-vf', parts.join(','), '-frames:v', '1']
        if (outExt === '.png') args.push('-c:v', 'png')
        else args.push('-q:v', '3')
        args.push(outFile)
        await execFileAsync('ffmpeg', args)
        return ok([await publishFile(outFile, outRoot, 'image')])
      }

      // ---- 旋转（90/180/270 用 transpose 组合，其他角度 rotate 黑底）----
      case 'rotate': {
        const degrees = clampNum(params.degrees, -360, 360, 0)
        const normalized = ((degrees % 360) + 360) % 360
        let vf = 'null'
        if (normalized === 90) vf = 'transpose=1'
        else if (normalized === 180) vf = 'transpose=1,transpose=1'
        else if (normalized === 270) vf = 'transpose=2'
        else if (Math.abs(degrees) > 0.001) {
          const rad = (degrees * Math.PI / 180).toFixed(6)
          vf = `rotate=${rad}:fillcolor=black`
        }
        const isImage = IMAGE_EXTS.includes(ext)
        const outFile = path.join(outRoot, `rotated${isImage ? ext : '.mp4'}`)
        const args = ['-y', '-v', 'error', '-i', input0]
        if (vf !== 'null') {
          args.push('-vf', vf)
          if (!isImage) args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart')
        } else if (!isImage) {
          args.push('-c', 'copy', '-movflags', '+faststart')
        }
        args.push(outFile)
        await execFileAsync('ffmpeg', args)
        return ok([await publishFile(outFile, outRoot, isImage ? 'image' : 'video')])
      }

      // ---- 翻转 ----
      case 'flip': {
        const direction = String(params.direction || 'horizontal').toLowerCase()
        if (direction !== 'horizontal' && direction !== 'vertical') throw new Error('flip direction 仅支持 horizontal/vertical')
        const vf = direction === 'horizontal' ? 'hflip' : 'vflip'
        const isImage = IMAGE_EXTS.includes(ext)
        const outFile = path.join(outRoot, `flipped${isImage ? ext : '.mp4'}`)
        const args = ['-y', '-v', 'error', '-i', input0, '-vf', vf]
        if (!isImage) args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart')
        args.push(outFile)
        await execFileAsync('ffmpeg', args)
        return ok([await publishFile(outFile, outRoot, isImage ? 'image' : 'video')])
      }

      // ---- 格式转换 ----
      case 'convert': {
        const to = String(params.to || '').toLowerCase()
        const allowed = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm']
        if (!allowed.includes(to)) throw new Error('convert to 仅支持 png/jpg/webp/gif/mp4/webm')
        const quality = Math.round(clampNum(params.quality, 1, 100, 85))
        const outExt = to === 'jpeg' ? '.jpg' : `.${to}`
        const outFile = path.join(outRoot, `converted${outExt}`)
        const args = ['-y', '-v', 'error', '-i', input0]
        if (to === 'png') args.push('-c:v', 'png')
        else if (to === 'jpg' || to === 'jpeg') args.push('-q:v', String(Math.max(2, Math.min(31, Math.round((100 - quality) * 0.3 + 2)))))
        else if (to === 'webp') args.push('-quality', String(quality))
        else if (to === 'gif') args.push('-c:v', 'gif')
        else if (to === 'mp4') args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart')
        else if (to === 'webm') args.push('-c:v', 'libvpx-vp9', '-b:v', '1.5M', '-c:a', 'libopus')
        args.push(outFile)
        await execFileAsync('ffmpeg', args)
        const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(to)
        return ok([await publishFile(outFile, outRoot, isImage ? 'image' : 'video')])
      }

      // ---- 水印（图片 overlay / 文字 drawtext）----
      case 'watermark': {
        const position = String(params.position || 'br').toLowerCase()
        const allowedPos = ['tl', 'tr', 'bl', 'br', 'center']
        if (!allowedPos.includes(position)) throw new Error('watermark position 仅支持 tl/tr/bl/br/center')
        const margin = Math.round(clampNum(params.margin, 0, 200, 12))
        const isImage = IMAGE_EXTS.includes(ext)
        const outFile = path.join(outRoot, isImage ? 'watermarked.png' : 'watermarked.mp4')

        if (params.watermarkPath) {
          const wmFull = params.watermarkPath
          if (!fs.existsSync(wmFull) || !IMAGE_EXTS.includes(path.extname(wmFull).toLowerCase())) {
            throw new Error('watermarkPath 不存在或不是图片')
          }
          const scale = clampNum(params.scale, 0.1, 2, 1)
          const posExpr: Record<string, string> = {
            tl: `x=${margin}:y=${margin}`,
            tr: `x=W-w-${margin}:y=${margin}`,
            bl: `x=${margin}:y=H-h-${margin}`,
            br: `x=W-w-${margin}:y=H-h-${margin}`,
            center: `x=(W-w)/2:y=(H-h)/2`,
          }
          const scaled = scale !== 1 ? `[1:v]scale=iw*${scale.toFixed(3)}:ih*${scale.toFixed(3)}[wm];` : ''
          const filterComplex = `${scaled}[0:v][${scale !== 1 ? 'wm' : '1:v'}]overlay=${posExpr[position]}`
          const args = ['-y', '-v', 'error', '-i', input0, '-i', wmFull, '-filter_complex', filterComplex]
          if (isImage) {
            args.push('-frames:v', '1', '-c:v', 'png')
          } else {
            args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart')
          }
          args.push(outFile)
          await execFileAsync('ffmpeg', args)
          return ok([await publishFile(outFile, outRoot, isImage ? 'image' : 'video')])
        }

        if (params.text !== undefined && String(params.text).length > 0) {
          const font = findFontFile()
          if (!font) {
            return { ok: false, files: [], durationMs: Date.now() - startedAt, errorCode: 'FONT_NOT_FOUND', errorMessage: '未找到可用系统字体（DejaVuSans/DejaVuSerif）' }
          }
          const fontsize = Math.round(clampNum(params.fontsize, 8, 200, 28))
          const color = parseColor(String(params.color || 'white'))
          const text = escapeDrawText(String(params.text))
          const posExpr: Record<string, string> = {
            tl: `x=${margin}:y=${margin}`,
            tr: `x=w-tw-${margin}:y=${margin}`,
            bl: `x=${margin}:y=h-th-${margin}`,
            br: `x=w-tw-${margin}:y=h-th-${margin}`,
            center: `x=(w-tw)/2:y=(h-th)/2`,
          }
          const vf = `drawtext=text='${text}':fontfile='${font}':fontsize=${fontsize}:fontcolor=${color}:${posExpr[position]}`
          const args = ['-y', '-v', 'error', '-i', input0, '-vf', vf]
          if (isImage) {
            args.push('-frames:v', '1', '-c:v', 'png')
          } else {
            args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart')
          }
          args.push(outFile)
          await execFileAsync('ffmpeg', args)
          return ok([await publishFile(outFile, outRoot, isImage ? 'image' : 'video')])
        }

        throw new Error('watermark 需要提供 watermarkPath 或 text')
      }

      // ---- 网格拼图（ImageMagick montage）----
      case 'tile': {
        if (inputs.length < 2 || inputs.length > 12) throw new Error('tile 需要 2-12 张图片')
        for (const f of inputs) {
          const fext = path.extname(f).toLowerCase()
          if (!fs.existsSync(f) || !IMAGE_EXTS.includes(fext)) throw new Error('tile 输入必须都是已存在的图片')
        }
        const defaultColumns = Math.max(1, Math.min(6, Math.round(Math.sqrt(inputs.length))))
        const columns = Math.max(1, Math.min(6, Math.round(clampNum(params.columns, 1, 6, defaultColumns))))
        const gap = Math.round(clampNum(params.gap, 0, 50, 0))
        const bg = String(params.background || 'white').toLowerCase()
        if (bg !== 'white' && bg !== 'black' && bg !== 'transparent') throw new Error('tile background 仅支持 white/black/transparent')
        const bgArg = bg === 'transparent' ? 'none' : bg
        const outFile = path.join(outRoot, 'tile.png')
        await execFileAsync('montage', [...inputs, '-tile', `${columns}x`, '-geometry', `+${gap}+${gap}`, '-background', bgArg, outFile])
        return ok([await publishFile(outFile, outRoot, 'image')])
      }

      // ---- 音频音量 ----
      case 'volume': {
        if (!AUDIO_EXTS.includes(ext)) throw new Error('volume 仅支持音频输入')
        const level = clampNum(params.level, 0, 3, 1)
        const outFile = path.join(outRoot, 'volume.mp3')
        await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', input0, '-af', `volume=${level.toFixed(3)}`, '-c:a', 'libmp3lame', '-q:a', '4', outFile])
        return ok([await publishFile(outFile, outRoot, 'audio')])
      }

      default:
        return { ok: false, files: [], durationMs: Date.now() - startedAt, errorCode: 'UNKNOWN_OPERATION', errorMessage: `未知操作：${op}` }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // ffmpeg 失败时清理半成品目录
    try { fs.rmSync(outRoot, { recursive: true, force: true }) } catch { /* ignore */ }
    return {
      ok: false, files: [], durationMs: Date.now() - startedAt,
      errorCode: /ffmpeg|Error/i.test(message) ? 'FFMPEG_FAILED' : 'EDIT_FAILED',
      errorMessage: message.slice(0, 300),
    }
  }
}

/** 服务器 ffmpeg 是否可用 */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync('which', ['ffmpeg'], 5_000)
    return true
  } catch {
    return false
  }
}