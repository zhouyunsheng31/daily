// ============================================================================
// webOS Agent 工作区（AI 即系统）
// ----------------------------------------------------------------------------
// 每个用户（principal）拥有独立的磁盘工作区，AI 通过 agent_fs_* 工具
// 读写工作区内的文件。工作区是「AI 的家」：草稿、素材、壁纸、笔记、
// 备份都放在这里；系统桌面（system.desktop App）在 DB 中版本化，
// AI 通过 update_webos_app 修改并发布。
//
// 目录结构：
//   <SANDBOX_DIR>/webos/<key>/
//   ├── meta.json          # 工作区元信息（workspaceId 编号、创建时间；AI 不可修改）
//   ├── README.md          # 工作区说明（AI 首次进入时读取）
//   ├── logs/              # AI 执行日志（系统追加写入，AI 只读不可改；排查用）
//   │   └── execution.log  # JSON Lines：每次 agent_fs_* / webOS App 工具调用的记录
//   ├── home/              # 用户可见区（未来文件 App 展示；AI 写入需用户意图）
//   ├── system/            # 系统资源区（壁纸、主题、配置草稿）
//   └── agent/             # agent 私有区（草稿、中间产物、笔记）
// ============================================================================

import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getSandboxRoot } from '../sandbox/index.js'
import { getPool } from '../db/connection.js'
// 2026-08-14 MiniMax-M3 视觉桥接（AI 的眼睛）：agent_fs_read 读图片文件时
// 自动调 M3 生成文字描述（DeepSeek 非视觉）；用量落 webos_vision_usage
import {
  describeImageFile,
  visionModelName,
} from '../vision/m3Vision.js'

const MAX_READ_BYTES = 2 * 1024 * 1024 // 2MB（agent_fs_read 回显上限，非上传限制）
const MAX_LIST_ENTRIES = 1000
const MAX_SEARCH_RESULTS = 500
const MAX_PATH_LENGTH = 512

// 2026-08-16 用户上传图片公开副本：桌面 sandbox iframe（opaque origin）加载 <img>/CSS
// 背景图不携带 cookie，鉴权端点 401 会被 Chrome ORB 拦截。这里沿用生图公开目录模式：
// 仅将 home/ 下用户上传的图片按不可枚举 UUID 复制到 PUBLIC_IMAGES_DIR，并维护
// 路径 -> 公开文件名的映射，供 AI 工具（agent_fs_list/stat/read）返回 publicUrl。
// 不开放 /workspace/files/raw 免鉴权（path 可枚举工作区文件）。
export const PUBLIC_IMAGES_DIR = path.join(process.cwd(), 'data', 'webos-public-images')
const PUBLIC_UPLOAD_MAP_FILE = path.join(process.cwd(), 'data', 'webos-public-uploads.json')
const PUBLIC_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const PUBLIC_UPLOAD_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,160}$/

interface PublicImageRef {
  name: string
  size: number
  mtimeMs: number
}

function readPublicUploadMap(): Record<string, PublicImageRef> {
  try {
    const raw = fs.readFileSync(PUBLIC_UPLOAD_MAP_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, PublicImageRef>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writePublicUploadMap(map: Record<string, PublicImageRef>): void {
  try {
    fs.mkdirSync(path.dirname(PUBLIC_UPLOAD_MAP_FILE), { recursive: true })
    const tmp = `${PUBLIC_UPLOAD_MAP_FILE}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf-8')
    fs.renameSync(tmp, PUBLIC_UPLOAD_MAP_FILE)
  } catch {
    // 映射写失败不阻断主流程；最坏情况是下次重新生成一个新公开副本
  }
}

/** 为工作区图片生成/复用不可枚举公开 URL（仅图片；失败返回 null） */
export function ensurePublicImageCopy(fullPath: string): string | null {
  try {
    const abs = path.resolve(fullPath)
    const stat = fs.statSync(abs)
    if (!stat.isFile()) return null
    const ext = path.extname(abs).toLowerCase()
    if (!PUBLIC_IMAGE_EXTENSIONS.has(ext)) return null
    const map = readPublicUploadMap()
    const ref = map[abs]
    if (ref && ref.size === stat.size && Math.floor(ref.mtimeMs) === Math.floor(stat.mtimeMs)) {
      const existing = path.join(PUBLIC_IMAGES_DIR, ref.name)
      if (fs.existsSync(existing) && PUBLIC_UPLOAD_NAME_PATTERN.test(ref.name)) {
        return `/webos/api/imagegen/file/${ref.name}`
      }
    }
    const name = `up-${Date.now()}-${crypto.randomUUID()}${ext}`
    fs.mkdirSync(PUBLIC_IMAGES_DIR, { recursive: true })
    fs.copyFileSync(abs, path.join(PUBLIC_IMAGES_DIR, name))
    if (ref) {
      try { fs.unlinkSync(path.join(PUBLIC_IMAGES_DIR, ref.name)) } catch { /* 旧副本可能已不存在 */ }
    }
    map[abs] = { name, size: stat.size, mtimeMs: stat.mtimeMs }
    writePublicUploadMap(map)
    return `/webos/api/imagegen/file/${name}`
  } catch {
    return null
  }
}

/** 删除某工作区文件的公开副本（用户删除文件时清理，避免孤儿文件） */
export function removePublicImageCopy(fullPath: string): void {
  try {
    const abs = path.resolve(fullPath)
    const map = readPublicUploadMap()
    const ref = map[abs]
    if (!ref) return
    try { fs.unlinkSync(path.join(PUBLIC_IMAGES_DIR, ref.name)) } catch { /* 忽略 */ }
    delete map[abs]
    writePublicUploadMap(map)
  } catch { /* 忽略 */ }
}

/** 判断文件是否位于用户可见区 home/ 下（只有这里的图片才自动生成 publicUrl） */
export function isUserHomeFile(key: string, fullPath: string): boolean {
  try {
    const homeRoot = path.join(getWorkspaceRoot(key), 'home')
    const resolved = path.resolve(fullPath)
    return resolved.startsWith(homeRoot + path.sep)
  } catch {
    return false
  }
}

/** principal.key → 安全的目录名（保留可读性，去掉危险字符） */
export function workspaceDirName(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 96)
  return safe || 'default'
}

/** 工作区编号：ws-<sha256(key) 前 8 位>，确定性、稳定、可读 */
export function workspaceId(key: string): string {
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)
  return `ws-${hash}`
}

/** 不可被 AI 修改的系统文件/目录（相对路径前缀） */
const PROTECTED_PREFIXES = ['logs', 'meta.json']

/** 校验路径是否受保护（AI 不可写/删/建），相对路径基于工作区根 */
function assertMutable(relative: string): void {
  const normalized = relative.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized === '' || normalized === '.') return
  for (const prefix of PROTECTED_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      throw new Error(`路径受保护（仅系统可写）：${prefix}`)
    }
  }
}

/** 追加 AI 执行日志（系统写入，AI 只读）。line: { ts, ws, tool, params, ok, note } */
export function logAgentAction(
  key: string,
  tool: string,
  params: Record<string, unknown>,
  ok: boolean,
  note?: string,
): void {
  try {
    const root = getWorkspaceRoot(key)
    const logsDir = path.join(root, 'logs')
    fs.mkdirSync(logsDir, { recursive: true })
    const entry = {
      ts: new Date().toISOString(),
      ws: workspaceId(key),
      tool,
      params: summarize(params),
      ok,
      ...(note ? { note } : {}),
    }
    const file = path.join(logsDir, 'execution.log')
    // 简单轮转：超过 20MB 时保留旧文件为 execution.log.1 后重开
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 20 * 1024 * 1024) {
        fs.copyFileSync(file, `${file}.1`)
        fs.writeFileSync(file, '', 'utf-8')
      }
    } catch { /* 轮转失败不阻断 */ }
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf-8')
  } catch {
    // 日志失败绝不能影响工具本身
  }
}

/** 参数摘要：避免把大文件内容/HTML 全文写进日志 */
function summarize(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string') {
      out[key] = value.length > 200 ? `${value.slice(0, 200)}…(${value.length} 字符)` : value
    } else {
      out[key] = value
    }
  }
  return out
}

/** 获取用户工作区根目录（不存在则创建） */
export function getWorkspaceRoot(key: string): string {
  const sandboxRoot = getSandboxRoot()
  if (!sandboxRoot) throw new Error('Sandbox not initialized')
  const root = path.join(sandboxRoot, 'webos', workspaceDirName(key))
  ensureWorkspace(root, key)
  return root
}

function ensureWorkspace(root: string, key: string): void {
  const created = !fs.existsSync(root)
  if (created) fs.mkdirSync(root, { recursive: true })
  for (const dir of ['home', 'system', 'agent', 'logs', 'apps', 'shared', 'skills', 'packages']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
  }
  fs.mkdirSync(path.join(root, 'system', 'tools'), { recursive: true })
  ensureSystemToolDocs(root, created)
  // 默认设计资产（2026-08-06）：系统级默认设计参考，AI 改坏视觉后从这里恢复
  ensureSystemDesignDocs(root, created)
  // 2026-08-11 用户级 skills（myself 记忆等）：每个用户独立，与全局系统 skill（design 等）分离。
  // 首次创建时从全局模板复制默认 myself 模板（若全局存在），此后用户各自演进互不共享。
  ensureUserSkills(root, key, created)
  // meta.json：工作区编号（仅首次创建时写入；已存在不覆盖）
  const metaPath = path.join(root, 'meta.json')
  if (!fs.existsSync(metaPath)) {
    try {
      fs.writeFileSync(
        metaPath,
        JSON.stringify({
          workspaceId: workspaceId(key),
          principalKey: key,
          createdAt: Date.now(),
        }, null, 2),
        'utf-8',
      )
    } catch {
      // meta 写失败不阻断
    }
  }
  // README.md：工作区说明（仅首次创建时写入；AI 之后可自由改写说明）
  if (created) {
    try {
      fs.writeFileSync(
        path.join(root, 'README.md'),
        [
          `# Agent 工作区（${workspaceId(key)}）`,
          '',
          '这是 AI 助手（agent）的私有工作区，AI 可以通过文件工具自由读写这里的文件。',
          '',
          '## 目录约定',
          '- `home/`：用户可见区。用户明确要求保存的内容（文档、导出物）放在这里。home/ 下的图片可通过 agent_fs_list / agent_fs_stat / agent_fs_read 返回的 publicUrl 在桌面/App 沙箱中免鉴权引用（不要用 /webos/api/workspace/files/raw?path=... 或相对路径）。',
          '- `system/`：系统资源区。壁纸（SVG）、主题配置、系统相关素材放在这里。',
          '- `agent/`：agent 私有草稿区。中间产物、临时文件放在这里。',
          '- `apps/<appId>/`：App 私有文件区。**文件夹即 App**：在 apps/ 下新建文件夹并写 index.html 即创建新 App（系统自动注册到桌面）；App 图标 = 文件夹内 icon.svg（SVG 文本）或 icon.png 等图片；图片/CSS/JS 素材放文件夹内，App HTML 里用相对路径（assets/xxx.png、css/style.css）直接引用即可显示。',
          '- `apps/.trash/`：回收站。被删除 App 的文件夹在这里（可读取；把文件夹复制回 apps/ 下即自动恢复重新注册；彻底删除 = 删除回收站内目录）。',
          '- `packages/<id>/`：包目录。**文件夹即包（W1）**：在 packages/ 下新建文件夹并写 daily.pkg.json（manifest）即注册一个非 app 类型的包（theme/skill/api 等；app 请仍用 apps/）；系统自动静态校验并建立不可变版本，校验错误会随写文件结果回流，你按提示修正即可。删除包 = 移入 packages/.trash/（复制回原目录自动恢复）。',
          '- `shared/`：跨 App 共享区。多个 App 之间共享的数据（如 todo.json）放在这里，App 与 AI 都可读写。',
          '- `logs/execution.log`：AI 执行日志（系统自动记录，AI 只读不可修改）。',
          '',
          '## 注意',
          '- 系统桌面由 system.desktop App 承载（版本化、可回滚），不要试图直接修改它；',
          '  如需改桌面，请用 agent_fs_edit 改工作区 apps/system.desktop/index.html 或 update_webos_app 工具。',
          '- App 之间的联动：共享数据放 shared/，跳转用 App 内 `DailyWebOs.apps.open(\'app-id\')`。',
          '',
        ].join('\n'),
        'utf-8',
      )
    } catch {
      // README 写失败不阻断
    }
  }
}
// ---------------------------------------------------------------------------
// 用户级 skills（2026-08-11）：每个用户独立技能/记忆目录。
// 背景：此前所有用户共享全局 .pi/skills-webos/（含 myself 记忆），游客间
// 记忆串扰（A 的记忆 B 能看到）。修复：用户级 skills 放工作区 skills/ 下，
// 全局 .pi/skills-webos/ 仅保留系统级只读 skill（design 等）。
// ---------------------------------------------------------------------------

/** 全局系统 skills 目录（只读系统级 skill：design 等；AI 可读不可写） */
export function resolveGlobalSkillsDir(): string {
  const cwd = process.cwd()
  const candidates = [
    path.join(cwd, '.pi', 'skills-webos'),
    path.join(cwd, '..', '.pi', 'skills-webos'),
  ]
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch { /* 继续尝试下一个 */ }
  }
  return candidates[0]!
}

/** 用户级 skills 目录（工作区 skills/；myself 记忆等用户专属 skill 放这里） */
export function getUserSkillsDir(key: string): string {
  const root = getWorkspaceRoot(key)
  return path.join(root, 'skills')
}

/** 首次创建工作区时初始化用户级 skills：复制全局 myself 模板（若全局有） */
function ensureUserSkills(root: string, key: string, created: boolean): void {
  const skillsDir = path.join(root, 'skills')
  try {
    fs.mkdirSync(skillsDir, { recursive: true })
    // 全局模板（myself 的 SKILL.md + references）复制到用户级——仅当用户级还没有
    const myselfDir = path.join(skillsDir, 'myself')
    const globalSkills = resolveGlobalSkillsDir()
    const globalMyself = path.join(globalSkills, 'myself')
    if (!fs.existsSync(path.join(myselfDir, 'SKILL.md')) && fs.existsSync(path.join(globalMyself, 'SKILL.md'))) {
      fs.mkdirSync(myselfDir, { recursive: true })
      fs.copyFileSync(path.join(globalMyself, 'SKILL.md'), path.join(myselfDir, 'SKILL.md'))
      const globalRefs = path.join(globalMyself, 'references')
      if (fs.existsSync(globalRefs)) {
        const refsDir = path.join(myselfDir, 'references')
        fs.mkdirSync(refsDir, { recursive: true })
        for (const file of fs.readdirSync(globalRefs)) {
          const src = path.join(globalRefs, file)
          if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(refsDir, file))
        }
      }
    }
  } catch { /* 初始化失败不阻断工作区创建 */ }
}

// ---------------------------------------------------------------------------
// 系统工具文档（system/tools/）：FFmpeg / ImageMagick / 生图 / 图片编辑能力说明
// AI 可读（agent_fs_read），用于直接调用这些能力做素材与 App；仅系统首次写入，
// AI 之后可自由改写/扩充文档。
// ---------------------------------------------------------------------------

const SYSTEM_TOOL_DOCS: Record<string, string> = {
  'ffmpeg.md': `# FFmpeg 工具手册（系统内置，版本 6.x）

FFmpeg 是系统可调用的音视频/图像处理工具（服务器已安装）。AI 可以直接在
App、桌面、素材制作中使用这些能力；本文件是用法速查。

## 图像处理（常用）
- 格式转换：ffmpeg -i in.png -q:v 2 out.jpg  （png→jpg；q:v 2-31，越小质量越高）
- 缩放：     ffmpeg -i in.png -vf scale=512:512 out.png   （等比：scale=512:-1）
- 裁剪：     ffmpeg -i in.png -vf crop=400:400:100:100 out.png （宽:高:x:y）
- 旋转：     ffmpeg -i in.png -vf rotate=90*PI/180 out.png
- 加水印：   ffmpeg -i in.png -vf drawtext=text='Daily':fontsize=36:fontcolor=white:x=w-tw-12:y=h-th-12 out.png
- 去白底：   ffmpeg -i in.png -filter_complex "colorkey=white:0.08:0.1" out.png
- 拼图：     ffmpeg -i a.png -i b.png -filter_complex hstack out.png （左右拼接；vstack 上下）
- 调色：     ffmpeg -i in.png -vf eq=brightness=0.05:saturation=1.5 out.png
- 模糊：     ffmpeg -i in.png -vf gblur=sigma=5 out.png

## GIF / 视频
- 视频转 GIF：ffmpeg -i in.mp4 -vf fps=10,scale=480:-1 out.gif
- 多图合成动图：ffmpeg -framerate 2 -i img%02d.png out.gif
- 提取封面：ffmpeg -i in.mp4 -frames:v 1 out.png

## 音视频
- 裁剪：ffmpeg -i in.mp4 -ss 00:00:05 -t 10 out.mp4
- 转码：ffmpeg -i in.mov -c:v libx264 -crf 23 out.mp4
- 音频提取：ffmpeg -i in.mp4 -vn out.mp3

> 注意：在 webOS 里这些能力通过 edit_image 工具/宿主服务调用；写 HTML App 时
> 不能直接在浏览器里执行 ffmpeg——需要素材时先让 AI 用 edit_image 处理，
> 或把处理好的文件放 apps/<appId>/assets/ 由 App 引用。
`,
  'imagemagick.md': `# ImageMagick 手册（系统内置，convert 命令）

ImageMagick（IM6，convert）是图像批处理利器，尤其适合抠图与批量变换。

## 去白底（最常用，效果优于 ffmpeg colorkey）
- 基础：convert in.png -fuzz 8% -transparent white out.png
- 调整容差：-fuzz 5%（严）~ 15%（宽）；对纯白底 8% 足够
- 深色图调色：convert in.png -modulate 100,120,100 out.png

## 批量处理
- 批量缩放：for f in *.png; do convert "$f" -resize 512x512 "out_$f"; done
- 批量转格式：convert *.png -quality 90 out.jpg（同尺寸多图转 jpg）

## 常用
- 缩放：convert in.png -resize 512x512 out.png（等比：512x 或 x512）
- 裁剪：convert in.png -crop 400x400+100+100 +repage out.png
- 旋转：convert in.png -rotate 90 out.png
- 水印：convert in.png -gravity southeast -pointsize 36 -fill white -annotate +12+12 "Daily" out.png
- 拼接：convert a.png b.png +append out.png（横向；-append 纵向）
- 格式：convert in.png -quality 90 out.webp

> 与 ffmpeg 的关系：去底/批量图像首选 ImageMagick；音视频、GIF 动图用 ffmpeg。
`,
  'imagegen.md': `# 生图能力说明（generate_image 工具）

系统内置 AI 生图能力，AI 可通过 generate_image 工具直接生成图片到工作区。

## 当前模型（唯一提供）
- 模型：gpt-image-2-super（"image2 最好版本"）
- 端点：聚合网关 /v1/images/generations
- 输出：1024x1024 或 1254x1254 PNG（b64 返回，服务端自动落盘）

## 定价（管理后台展示，token 配额扣减）
- 输入：¥16 / 百万 token
- 输出：¥60 / 百万 token
- 按 API 真实 usage 扣减用户 token 配额

## 用法
- 单张：generate_image(prompt="...")
- 批量：generate_image(prompt="...", n=2~4) 或多次调用（不同 prompt）
- 图生图：generate_image(prompt="把背景改成渐变", reference_image="agent/images/xxx.png")——基于参考图生成变体/修改（走 /v1/images/edits）
- 尺寸：size 参数强制生效（服务端缩放），如 512x512 / 768x1024 / 1280x720；默认 1024x1024
- 输出目录：默认 agent/images/（AI 私有区）；可用 output_dir 参数直接指定任意目录（如 home/素材/、apps/<appId>/assets/），用户明确要求保存到某文件夹时指定 output_dir
- 生成后可用 agent_fs_* 管理；App 素材放 apps/<appId>/assets/

## 限制
- 一次最多 4 张；prompt 最长 8000 字符
- 生成结果必须立即使用（本地已落盘，无临时 URL 失效问题）
- 失败/超时会明确返回错误（不伪造成功）

## 内容边界（⚠️ 2026-08-20，OpenAI 系审查）
- 底层 gpt-image-2-super 把「人物/动漫角色」题材审查得极严，**动漫/女性角色图生图最易触发**，
  被拒时错误码为 SAFETY_REJECTED（违规类别多为 sexual）——这是上游内容审查的确定性策略，
  非系统故障、不扣费，同提示词+同类参考图会持续命中。
- 生成人物/动漫题材时避免：anime girl、少女/女仆/校服、身材或衣着描写、人物特写参考图。
- 遇 SAFETY_REJECTED：主动改写题材（改场景/物品/动物等非人物主体）或更换参考图后重试，
  **不要用同一触雷提示词反复重试**（会持续被拒）。
`,
  'edit-image.md': `# 图片编辑能力说明（edit_image 工具）

edit_image 对工作区图片做批处理，产物写回工作区（默认 agent/images/）。

## 支持的操作
- remove-background：去白底（纯 JS 实现，零依赖，阈值默认 40 可调 0-200）
- convert：格式转换（png/jpg/webp，quality 1-100）
- resize：缩放（"50%" 或 "512x512" / "512x" / "x512"）
- crop：裁剪（"宽x高+x+y"，如 "400x400+100+100"）
- rotate：旋转（90/180/270）
- watermark：文字水印（text + gravity: nw/n/ne/w/center/e/sw/s/se）

## 批量
- inputs 数组 + 同一操作 = 批量处理（每张图独立输出）
- 示例：edit_image(inputs=["agent/images/a.png","agent/images/b.png"],
  operation="remove-background")

## 引擎
- remove-background：纯 JS（任何环境可用）
- 其他操作：优先 ImageMagick，其次 ffmpeg；都没装时返回明确错误

## 用这些能力做 App 的流程
1. 需要素材 → generate_image 生成（或用户提供）
2. 处理素材 → edit_image（去底/缩放/转格式）
3. 把素材放 apps/<appId>/assets/ → App HTML 里 <img src="assets/xxx.png">
4. App 运行时用 DailyWebOs.fs.read 读文件（二进制→dataURL）也可
`,
}

/** 写入系统工具文档（仅首次创建工作区时；已存在不覆盖，AI 可自行演进） */
function ensureSystemToolDocs(root: string, created: boolean): void {
  if (!created) return
  const toolsDir = path.join(root, 'system', 'tools')
  try {
    for (const [name, content] of Object.entries(SYSTEM_TOOL_DOCS)) {
      const file = path.join(toolsDir, name)
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, content, 'utf-8')
      }
    }
  } catch {
    // 文档写入失败不阻断工作区创建
  }
}

/** 系统默认设计资产（2026-08-06）：design.md = 默认设计 tokens 与恢复指引。
 * 仅首次创建工作区时写入；已存在不覆盖（AI 可自行演进，但应保留恢复参照）。
 * 桌面视觉改坏了：① 看版本历史回滚 system.desktop；② 参照本文件的默认 tokens 复原。 */
const SYSTEM_DESIGN_DOCS: Record<string, string> = {
  'design.md': [
    '# 系统默认设计（Design Tokens）',
    '',
    '这是 webOS 的系统级默认设计参考。任何视觉改动（桌面、App、海报、动画）',
    '都应先读 design skill（.pi/skills-webos/design/SKILL.md），并以本文件的 tokens 为基准。',
    '如果某次改动把系统改难看了，从这里恢复默认值（改回去即可，不用重写）。',
    '',
    '## 颜色',
    '- 背景：--bg-1 #eef1f6（主）、--bg-2 #dfe6f3（渐变尾）；壁纸可用 system/wallpaper.svg 覆盖；用户上传的图片作壁纸时用 agent_fs_list/stat/read 返回的 publicUrl（免鉴权公开 URL）',
    '- 墨色：--ink #1c2333（正文）、--ink-soft #6b7280（次要）',
    '- 卡片：--card rgba(255,255,255,0.78)，边框 rgba(255,255,255,0.95)',
    '- 主色：--accent #4f6ef7（按钮/高亮/进度）',
    '- 危险：--danger #e5484d；商店橙：--amber #f59e0b；文件蓝：--sky #0ea5e9；桌面紫：--violet #8b5cf6',
    '',
    '## 字体与排版',
    '- 字体栈：-apple-system, BlinkMacSystemFont, "SF Pro SC", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Segoe UI", Roboto, sans-serif',
    '- 标题 15-20px / 正文 12-14px / 辅助 10-11px；行距 1.5',
    '',
    '## 圆角与阴影',
    '- 圆角：--radius 16px（图标 16px、卡片 18-20px、胶囊 999px）',
    '- 阴影：0 8px 24px rgba(30,41,59,0.10)；浮层 0 18px 50px rgba(15,23,42,0.25-0.28)',
    '',
    '## 动效',
    '- 淡入上浮 fadeUp 0.25s ease；按压缩放 0.92-0.96；模糊背景 backdrop-filter blur(16-18px)',
    '',
    '## App / 图标规范',
    '- App 图标：文件夹内 icon.svg（内联 SVG，≤32KB）或 icon.png（≤512KB）',
    '- 系统 App 基础图标：daily.ai 蓝星、system.desktop 紫色面板、system.files 蓝色文件夹、system.store 橙色商店（桌面 HTML 的 svgIcon fallback 里）',
    '- App 素材：apps/<appId>/assets/，HTML 相对路径引用；CSS/JS 拆分文件同样放文件夹内',
    '',
    '## 恢复指引（改坏了怎么办）',
    '- 桌面：system.desktop 是版本化 App——在对话里让 AI 回滚版本，或参考早期版本恢复',
    '- 全局视觉：按本文件 tokens 逐项改回',
    '- Logo/头像/加载页：删掉工作区 system/logo.*、system/avatar.*、system/boot.* 即回默认',
    '- 商店形态：system.store 同桌面，版本化可回滚',
  ].join('\n'),
}

/** 写入系统默认设计资产（仅首次创建工作区时；已存在不覆盖） */
function ensureSystemDesignDocs(root: string, created: boolean): void {
  if (!created) return
  const systemDir = path.join(root, 'system')
  try {
    for (const [name, content] of Object.entries(SYSTEM_DESIGN_DOCS)) {
      const file = path.join(systemDir, name)
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, content, 'utf-8')
      }
    }
  } catch {
    // 文档写入失败不阻断工作区创建
  }
}

/** 校验并解析工作区内路径（禁止逃逸） */
export function resolveWorkspacePath(key: string, inputPath: string): string {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.length > MAX_PATH_LENGTH) {
    throw new Error(`非法路径：长度必须在 1-${MAX_PATH_LENGTH} 之间`)
  }
  if (inputPath.includes('\0')) throw new Error('非法路径：包含空字符')
  const root = getWorkspaceRoot(key)
  // 允许相对路径与绝对路径（绝对路径也限制在工作区内）
  const trimmed = inputPath.trim().replace(/^\/+/, '')
  const resolved = path.resolve(root, trimmed)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`路径越界：${inputPath} 解析到工作区之外`)
  }
  return resolved
}

// ---------------------------------------------------------------------------
// App 文件系统（每个 App 一个文件夹 + 跨 App 共享区）
// ---------------------------------------------------------------------------
// 目录结构（用户工作区内）：
//   apps/<appId>/   App 私有文件区（App 运行时 fs API 与 AI 都可读写）
//   shared/         跨 App 共享区（多个 App 共享数据，App 与 AI 都可读写）
// App 在浏览器 iframe 里无法直接访问服务器磁盘，必须经宿主桥 + HTTP API；
// AI 的 agent_fs_* 直接作用同一工作区，天然可读写这些目录。

// 2026-08-06 允许冒号：商店安装的 App id 形如 store:s-xxx（source='store' 前缀）
// 2026-08-14 支持中文等 Unicode 文件夹名（「文件夹即 App」）：允许 Unicode 字母/数字/
// 中文/空格/._:-，仍排除路径分隔符（防穿越）；应用 id 由文件夹名生成（如 apps/无限跑酷/ → id=无限跑酷）。
// 注意：appFilesRoot 等路径拼接处另有 appId.includes('..') 二次防护（防 . 穿越）。
export const APP_ID_PATTERN = /^[\p{L}\p{N} ._:-]{1,128}$/u

/** App 文件系统根目录（scope: 'app' 私有 / 'shared' 共享） */
export function appFilesRoot(key: string, scope: 'app' | 'shared', appId?: string): string {
  const root = getWorkspaceRoot(key)
  if (scope === 'shared') return path.join(root, 'shared')
  if (scope === 'app') {
    if (!appId || !APP_ID_PATTERN.test(appId) || appId.includes('..')) throw new Error('非法 App id')
    return path.join(root, 'apps', appId)
  }
  throw new Error('appFilesRoot: 无效 scope（仅允许 app / shared）')
}

/** 校验并解析 App 文件路径（禁止逃逸出对应根目录） */
export function resolveAppFilePath(key: string, scope: 'app' | 'shared', appId: string | undefined, inputPath: string): string {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.length > MAX_PATH_LENGTH) {
    throw new Error(`非法路径：长度必须在 1-${MAX_PATH_LENGTH} 之间`)
  }
  if (inputPath.includes('\0')) throw new Error('非法路径：包含空字符')
  const base = appFilesRoot(key, scope, appId)
  const trimmed = inputPath.trim().replace(/^\/+/, '')
  const resolved = path.resolve(base, trimmed)
  const relative = path.relative(base, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`路径越界：${inputPath} 解析到 ${scope} 根目录之外`)
  }
  return resolved
}

function errorResult(message: string, extra?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, ...extra }) }],
    details: {},
  }
}

function okResult(payload: unknown, details?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    details: details ?? {},
  }
}

function formatEntry(name: string, fullPath: string, key?: string): Record<string, unknown> {
  let stat: fs.Stats | null = null
  try {
    stat = fs.statSync(fullPath)
  } catch {
    return { name, type: 'unknown' }
  }
  const entry: Record<string, unknown> = {
    name,
    type: stat.isDirectory() ? 'dir' : 'file',
    size: stat.isDirectory() ? 0 : stat.size,
    modifiedAt: stat.mtimeMs,
  }
  // 仅给用户可见区 home/ 的图片附带免鉴权 publicUrl（桌面沙箱/App 内嵌使用）。
  if (key && stat.isFile() && isUserHomeFile(key, fullPath)) {
    try {
      const publicUrl = ensurePublicImageCopy(fullPath)
      if (publicUrl) entry.publicUrl = publicUrl
    } catch { /* 列表不因公开副本失败而中断 */ }
  }
  return entry
}

// ---------------------------------------------------------------------------
// agent_fs_* 工具
// ---------------------------------------------------------------------------

/**
 * 2026-08-13 「文件夹即 App」即时化钩子（用户需求：让 AI 自行创建文件夹，系统帮初始化）：
 * - onAppSourceChanged(appId, relPath)：apps/<appId>/index.html 内容被 AI 修改/写入/
 *   删除/覆盖后触发（write/edit/mkdir/copy/delete 命中时），webos.ts 注入做「即时
 *   建版本并切换 + push app_updated」——AI 改文件立即生效，不再等 bootstrap 懒同步；
 * - onAppFolderCreated(appId)：mkdir 命中 apps/<name>/ 时触发，webos.ts 注入做
 *   「自动注册为 App」——AI 只需建文件夹，系统负责初始化与注册。
 * 2026-08-20（W-F File Service 一阶段）新增：
 * - onFsFileWritten(fullPath)：任意工作区文件被写入/复制后触发，webos.ts 注入
 *   File Service 的 recordFileStats 做 files 元数据双写（AI 无感知）；
 * - onFsFileDeleted(fullPath)：文件/目录被删除后触发，注入 recordFileDeleted
 *   标记回收站语义（deleted_at 非空，保留版本历史）。
 * 钩子为异步且失败静默（不影响文件操作本身）。
 */
export interface WorkspaceFsHooks {
  onAppSourceChanged?: (appId: string, relPath: string) => Promise<unknown> | void
  onAppFolderCreated?: (appId: string) => Promise<unknown> | void
  /**
   * 任意工作区文件被写入/复制后触发（W-F：files 元数据双写；W1：包校验反馈）。
   * 返回值若为 `string`（人话校验反馈），工具会把它附到 agent_fs_write/edit/copy 的结果上，
   * 供 AI 即时修正（校验反馈回路）；无反馈返回 void。
   */
  onFsFileWritten?: (fullPath: string) => Promise<string | void> | string | void
  /** 文件/目录被删除后触发（W-F：回收站语义；W1：包失效提示同理） */
  onFsFileDeleted?: (fullPath: string) => Promise<string | void> | string | void
}

/** 解析相对路径是否命中 apps/<appId>/index.html（返回 appId，非则 null） */
function matchAppIndexHtml(root: string, relative: string): string | null {
  const normalized = relative.replace(/\\/g, '/')
  const match = normalized.match(/^apps\/([^/]+)\/index\.html$/)
  if (!match) return null
  return match[1] ?? null
}

/** 解析相对路径是否命中 apps/<appId>（任意一级，返回 appId，非则 null） */
function matchAppFolder(root: string, relative: string): string | null {
  const normalized = relative.replace(/\\/g, '/')
  const match = normalized.match(/^apps\/([^/]+)(?:\/|$)/)
  if (!match) return null
  return match[1] ?? null
}

/** mkdir 命中 apps/<name>/ 时系统自动初始化的最小 index.html 骨架（AI 之后覆盖完善） */
function appIndexSkeleton(appId: string): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">',
    '<title>新 App</title>',
    '<style>',
    'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","HarmonyOS Sans SC",sans-serif;background:#f8f7f3;color:#171918;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}',
    '</style>',
    '</head>',
    '<body>',
    '<div>',
    '<h2 style="margin:0 0 8px">✨ 新 App 已就绪</h2>',
    '<p style="color:#6b6f66;margin:0">AI 正在完善内容…（此页是系统自动生成的初始化骨架）</p>',
    '</div>',
    '</body>',
    '</html>',
  ].join('\n')
}

export function workspaceFsTools(key: string, hooks?: WorkspaceFsHooks): ToolDefinition[] {
  const resolve = (inputPath: string): string => resolveWorkspacePath(key, inputPath)
  const log = (tool: string, params: Record<string, unknown>, ok: boolean, note?: string): void => {
    logAgentAction(key, tool, params, ok, note)
  }

  const listTool: ToolDefinition = {
    name: 'agent_fs_list',
    label: '列出工作区目录',
    description: '列出 Agent 工作区中某个目录的内容（文件名、类型、大小）。path 相对工作区根，如 "home"、"system"、"agent" 或 "."。',
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: '目录路径（默认 "."，即工作区根）' })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const dir = resolve((params as { path?: string }).path ?? '.')
        const entries = fs.readdirSync(dir, { withFileTypes: true })
          .slice(0, MAX_LIST_ENTRIES)
          .map((entry) => formatEntry(entry.name, path.join(dir, entry.name), key))
        log('agent_fs_list', params as Record<string, unknown>, true)
        return okResult({ success: true, path: (params as { path?: string }).path ?? '.', entries })
      } catch (error) {
        log('agent_fs_list', params as Record<string, unknown>, false, error instanceof Error ? error.message : String(error))
        return errorResult('目录列表失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const readTool: ToolDefinition = {
    name: 'agent_fs_read',
    label: '读取工作区文件',
    description: '读取 Agent 工作区中的文件内容（UTF-8 文本），带行号。支持 offset/limit 按行读取。适合读取草稿、笔记、SVG 素材等文本文件。',
    parameters: Type.Object({
      path: Type.String({ description: '文件路径（相对工作区根，如 "agent/notes.md"）' }),
      offset: Type.Optional(Type.Number({ description: '起始行号（从 1 开始，默认 1）' })),
      limit: Type.Optional(Type.Number({ description: '读取行数（默认 2000）' })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const { path: filePath, offset, limit } = params as { path: string; offset?: number; limit?: number }
        const full = resolve(filePath)
        const stat = fs.statSync(full)
        if (!stat.isFile()) return errorResult('不是文件', { path: filePath })
        // 2026-08-14 M3 视觉桥接（AI 的眼睛）：读图片文件时自动调 MiniMax-M3 描述
        // （本模型无视觉；图片允许超过 2MB 文本上限，但不超过 10MB 图片上限）
        const readExt = path.extname(full).toLowerCase()
        if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(readExt)) {
          const vr = await describeImageFile({ filePath: full, userKey: key })
          if (vr.ok && vr.description) {
            log('agent_fs_read', { path: filePath, kind: 'image', describedBy: visionModelName() }, true)
            const publicUrl = isUserHomeFile(key, full) ? ensurePublicImageCopy(full) : null
            return okResult({
              success: true,
              path: filePath,
              kind: 'image',
              describedBy: visionModelName(),
              size: stat.size,
              ...(publicUrl ? { publicUrl } : {}),
              note: `这是图片文件，AI 主模型没有视觉能力，以下为视觉助手（${visionModelName()}）对该图片的描述：`,
              description: vr.description,
            })
          }
          log('agent_fs_read', { path: filePath, kind: 'image' }, false, vr.errorMessage ?? '视觉模型调用失败')
          return errorResult('图片分析失败', { path: filePath, message: vr.errorMessage ?? '视觉模型调用失败' })
        }
        if (stat.size > MAX_READ_BYTES) return errorResult('文件过大', { size: stat.size, max: MAX_READ_BYTES })
        const content = fs.readFileSync(full, 'utf-8')
        const lines = content.split('\n')
        const startLine = Math.max(1, offset ?? 1) - 1
        const lineCount = limit ?? 2000
        const selected = lines.slice(startLine, startLine + lineCount)
        const numbered = selected.map((line, i) => `${String(startLine + i + 1).padStart(6)}→${line}`).join('\n')
        log('agent_fs_read', { path: filePath, offset, limit }, true)
        return okResult(
          { success: true, path: filePath, totalLines: lines.length, shownLines: selected.length, content: numbered },
          { path: filePath, totalLines: lines.length },
        )
      } catch (error) {
        log('agent_fs_read', params as Record<string, unknown>, false, error instanceof Error ? error.message : String(error))
        return errorResult('读取失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const writeTool: ToolDefinition = {
    name: 'agent_fs_write',
    label: '写入工作区文件',
    description: '写入/覆盖 Agent 工作区中的文件（UTF-8 文本）。父目录不存在会自动创建。适合保存草稿、笔记、SVG 壁纸素材、配置等。注意：logs/ 与 meta.json 为系统文件，不可修改。',
    parameters: Type.Object({
      path: Type.String({ description: '文件路径（相对工作区根，如 "system/wallpapers/aurora.svg"）' }),
      content: Type.String({ description: '文件完整内容（UTF-8 文本）' }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const { path: filePath, content } = params as { path: string; content: string }
        if (typeof content !== 'string') return errorResult('content 必须为字符串')
        const bytes = Buffer.byteLength(content, 'utf-8')
        // 2026-08-12 取消单次写入大小限制：只受工作区总配额约束（下同总量检查）
        // 工作区总大小限制（游客 200MB / 登录 512MB / 月卡档位）：AI 写入与用户上传共享同一空间
        const full = resolve(filePath)
        const root = getWorkspaceRoot(key)
        const relative = path.relative(root, full)
        assertMutable(relative)
        // 仅新文件/覆盖变大时检查总量（小文件高频写入不做全量遍历，避免每次 AI 写文件都 O(n) 统计）
        const exists = fs.existsSync(full)
        const oldSize = exists && fs.statSync(full).isFile() ? fs.statSync(full).size : 0
        if (bytes > oldSize) {
          try {
            const used = workspaceUsedBytes(key)
            // 2026-08-12 异步解析配额（游客200MB/登录512MB/月卡档位10-100GB）
            const limit = await workspaceLimitResolved(key)
            if (used - oldSize + bytes > limit) {
              return errorResult('工作区空间不足，请先删除部分文件', { limit })
            }
          } catch { /* 统计失败不阻断写入（阈值靠上传端点兜底） */ }
        }
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, content, 'utf-8')
        log('agent_fs_write', { path: filePath, bytes }, true)
        // 2026-08-20（W-F）：任意工作区文件写入后落 files 元数据（双写，AI 无感知）；
        // 2026-08-21（W1）：若命中 packages/ 包目录，同步触发包校验并回流人话反馈
        let fsFeedback: string | undefined
        try {
          const feedback = await hooks?.onFsFileWritten?.(full)
          if (typeof feedback === 'string' && feedback) fsFeedback = feedback
        } catch { /* 双写失败静默 */ }
        // 2026-08-13 即时生效：命中 apps/<appId>/index.html → 触发建版本回调
        const appIdHit = matchAppIndexHtml(getWorkspaceRoot(key), path.relative(getWorkspaceRoot(key), full))
        if (appIdHit) {
          try { await hooks?.onAppSourceChanged?.(appIdHit, filePath) } catch { /* 回调失败不影响写入 */ }
        }
        return okResult({ success: true, path: filePath, bytes, ...(fsFeedback ? { note: fsFeedback } : {}) })
      } catch (error) {
        log('agent_fs_write', params as Record<string, unknown>, false, error instanceof Error ? error.message : String(error))
        return errorResult('写入失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const mkdirTool: ToolDefinition = {
    name: 'agent_fs_mkdir',
    label: '创建工作区目录',
    description: '在 Agent 工作区中创建目录（可递归）。注意：logs/ 为系统目录，不可创建。',
    parameters: Type.Object({
      path: Type.String({ description: '目录路径（相对工作区根）' }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const dir = resolve((params as { path: string }).path)
        const root = getWorkspaceRoot(key)
        const relative = path.relative(root, dir)
        assertMutable(relative)
        fs.mkdirSync(dir, { recursive: true })
        // 2026-08-13 系统初始化：mkdir 命中 apps/<name>/ 且无 index.html 时自动写骨架
        // （「让 AI 自行创建文件夹，系统帮它初始化」——AI 建文件夹即得到可运行 App）
        const createdApp = matchAppFolder(root, relative)
        let skeletonWritten = false
        if (createdApp && relative.split(/[\\/]/).length === 2) {
          const indexFile = path.join(dir, 'index.html')
          if (!fs.existsSync(indexFile)) {
            try {
              fs.writeFileSync(indexFile, appIndexSkeleton(createdApp), 'utf-8')
              skeletonWritten = true
              log('agent_fs_mkdir', { path: (params as { path: string }).path, initialized: true, skeleton: 'index.html' }, true)
            } catch { /* 骨架写失败不阻断 */ }
          }
        }
        // 2026-08-13 自动注册回调（webos.ts 注入：注册为 App + 推送 app_created）
        if (createdApp) {
          try { await hooks?.onAppFolderCreated?.(createdApp) } catch { /* 回调失败不影响 mkdir */ }
        }
        return okResult({
          success: true,
          path: (params as { path: string }).path,
          ...(skeletonWritten ? { initialized: true, note: '已在 apps/ 下自动创建 index.html 骨架，系统已初始化该 App（可继续写入内容完善）' } : {}),
        })
      } catch (error) {
        log('agent_fs_mkdir', params as Record<string, unknown>, false, error instanceof Error ? error.message : String(error))
        return errorResult('创建目录失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const deleteTool: ToolDefinition = {
    name: 'agent_fs_delete',
    label: '删除工作区文件/目录',
    description: '删除 Agent 工作区中的文件或空目录。注意：工作区根目录、home/system/agent/logs 顶层目录与 meta.json 不允许删除。',
    parameters: Type.Object({
      path: Type.String({ description: '文件或目录路径（相对工作区根）' }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const filePath = (params as { path: string }).path
        const root = getWorkspaceRoot(key)
        const full = resolve(filePath)
        const relative = path.relative(root, full)
        if (relative === '' || relative === 'home' || relative === 'system' || relative === 'agent' || relative === 'logs'
          || relative === 'apps' || relative === 'shared') {
          return errorResult('不允许删除工作区根或顶层目录')
        }
        assertMutable(relative)
        const stat = fs.statSync(full)
        if (stat.isDirectory()) fs.rmdirSync(full)
        else {
          removePublicImageCopy(full)
          fs.unlinkSync(full)
        }
        log('agent_fs_delete', { path: filePath }, true)
        // 2026-08-20（W-F）：删除后落 files 回收站语义（deleted_at 非空，保留版本历史）；
        // 2026-08-21（W1）：删除 packages/ 内文件时回流包状态提示
        let fsFeedback: string | undefined
        try {
          const feedback = await hooks?.onFsFileDeleted?.(full)
          if (typeof feedback === 'string' && feedback) fsFeedback = feedback
        } catch { /* 双写失败静默 */ }
        // 2026-08-13 删除命中 apps/<appId>/index.html → 触发回调（sync 会重建镜像/标记异常）
        const appIdHit = matchAppIndexHtml(root, relative)
        if (appIdHit) {
          try { await hooks?.onAppSourceChanged?.(appIdHit, filePath) } catch { /* 回调失败不影响删除 */ }
        }
        return okResult({ success: true, path: filePath, ...(fsFeedback ? { note: fsFeedback } : {}) })
      } catch (error) {
        log('agent_fs_delete', params as Record<string, unknown>, false, error instanceof Error ? error.message : String(error))
        return errorResult('删除失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const statTool: ToolDefinition = {
    name: 'agent_fs_stat',
    label: '查看工作区文件信息',
    description: '查看 Agent 工作区中文件/目录的信息（类型、大小、修改时间）。',
    parameters: Type.Object({
      path: Type.String({ description: '路径（相对工作区根）' }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const filePath = (params as { path: string }).path
        const full = resolve(filePath)
        const info = formatEntry(path.basename(full), full, key)
        log('agent_fs_stat', { path: filePath }, true)
        return okResult({ success: true, path: filePath, ...info })
      } catch (error) {
        log('agent_fs_stat', params as Record<string, unknown>, false, error instanceof Error ? error.message : String(error))
        return errorResult('获取信息失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const searchTool: ToolDefinition = {
    name: 'agent_fs_search',
    label: '搜索工作区文件',
    description: '按文件名模式搜索 Agent 工作区中的文件（glob 风格：* 匹配任意字符）。',
    parameters: Type.Object({
      pattern: Type.String({ description: '文件名模式，如 "*.svg"、"*note*"' }),
      path: Type.Optional(Type.String({ description: '搜索起始目录（默认 "."）' })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const { pattern, path: searchPath } = params as { pattern: string; path?: string }
        const base = resolve(searchPath ?? '.')
        const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
        const results: string[] = []
        const walk = (dir: string, depth: number): void => {
          if (depth > 6 || results.length >= MAX_SEARCH_RESULTS) return
          let entries: fs.Dirent[]
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
          } catch {
            return
          }
          for (const entry of entries) {
            if (results.length >= MAX_SEARCH_RESULTS) return
            const full = path.join(dir, entry.name)
            const rel = path.relative(base, full).replace(/\\/g, '/')
            if (entry.isFile() && regex.test(entry.name)) results.push(rel)
            if (entry.isDirectory()) walk(full, depth + 1)
          }
        }
        walk(base, 0)
        log('agent_fs_search', { pattern, path: searchPath ?? '.' }, true, `found ${results.length}`)
        return okResult({ success: true, pattern, results })
      } catch (error) {
        log('agent_fs_search', params as Record<string, unknown>, false, error instanceof Error ? error.message : String(error))
        return errorResult('搜索失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const grepTool: ToolDefinition = {
    name: 'agent_fs_grep',
    label: '搜索工作区文件内容',
    description: '在 Agent 工作区文件中搜索文本或正则表达式，返回 文件:行号:内容。递归搜索目录（默认整个工作区），自动跳过 logs/ 等系统目录与二进制/超大文件。适合定位配置项、关键词、代码片段。',
    parameters: Type.Object({
      pattern: Type.String({ description: '搜索关键词或正则表达式（如 "TODO"、"version.*1\\.0\\."）' }),
      path: Type.Optional(Type.String({ description: '搜索起始目录或文件（默认 "."，即整个工作区）' })),
      maxResults: Type.Optional(Type.Number({ description: '最多返回的匹配行数（默认 50，最大 200）' })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const { pattern, path: searchPath, maxResults } = params as { pattern: string; path?: string; maxResults?: number }
        if (typeof pattern !== 'string' || pattern.length === 0) return errorResult('pattern 必须为非空字符串')
        // 支持正则；正则无效时按纯文本转义搜索
        let regex: RegExp
        try {
          regex = new RegExp(pattern, 'i')
        } catch {
          regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        }
        const limit = Math.min(Math.max(1, maxResults ?? 50), 200)
        const base = resolve(searchPath ?? '.')
        const results: Array<{ file: string; line: number; content: string }> = []
        const walk = (dir: string, depth: number): void => {
          if (depth > 8 || results.length >= limit) return
          let entries: fs.Dirent[]
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
          } catch {
            return
          }
          for (const entry of entries) {
            if (results.length >= limit) return
            const full = path.join(dir, entry.name)
            const rel = path.relative(base, full).replace(/\\/g, '/')
            if (rel.startsWith('logs') || rel === 'meta.json') continue
            if (entry.isDirectory()) {
              walk(full, depth + 1)
            } else if (entry.isFile()) {
              try {
                const stat = fs.statSync(full)
                if (stat.size > MAX_READ_BYTES) continue
                const content = fs.readFileSync(full, 'utf-8')
                if (content.includes('\0')) continue
                const lines = content.split('\n')
                for (let i = 0; i < lines.length && results.length < limit; i++) {
                  if (regex.test(lines[i])) {
                    const text = lines[i].length > 300 ? `${lines[i].slice(0, 300)}…` : lines[i]
                    results.push({ file: rel, line: i + 1, content: text })
                  }
                }
              } catch {
                // 单个文件读取失败跳过
              }
            }
          }
        }
        walk(base, 0)
        log('agent_fs_grep', { pattern, path: searchPath ?? '.', maxResults }, true, `found ${results.length}`)
        return okResult({ success: true, pattern, matches: results.length, results })
      } catch (error) {
        log('agent_fs_grep', params as Record<string, unknown>, false, error instanceof Error ? error.message : String(error))
        return errorResult('搜索失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const editTool: ToolDefinition = {
    name: 'agent_fs_edit',
    label: '精确修改工作区文件',
    description: '在工作区文件中精确替换一段文本（oldText 必须与文件内容完全一致；默认要求唯一匹配，可用 replaceAll 替换全部）。适合局部修改配置、数据文件、App 文件而不重写全文。注意：logs/ 与 meta.json 为系统文件，不可修改。',
    parameters: Type.Object({
      path: Type.String({ description: '文件路径（相对工作区根）' }),
      oldText: Type.String({ description: '要替换的原文（必须与文件中内容逐字一致）' }),
      newText: Type.String({ description: '替换后的新文本' }),
      replaceAll: Type.Optional(Type.Boolean({ description: '是否替换所有匹配（默认 false，要求唯一匹配）' })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const { path: filePath, oldText, newText, replaceAll } = params as {
          path: string; oldText: string; newText: string; replaceAll?: boolean
        }
        if (typeof oldText !== 'string' || oldText.length === 0) return errorResult('oldText 必须为非空字符串')
        if (typeof newText !== 'string') return errorResult('newText 必须为字符串')
        const full = resolve(filePath)
        const stat = fs.statSync(full)
        if (!stat.isFile()) return errorResult('不是文件', { path: filePath })
        if (stat.size > MAX_READ_BYTES) return errorResult('文件过大', { size: stat.size, max: MAX_READ_BYTES })
        const relative = path.relative(getWorkspaceRoot(key), full)
        assertMutable(relative)
        const content = fs.readFileSync(full, 'utf-8')
        const matches = content.split(oldText).length - 1
        if (matches === 0) return errorResult('未找到匹配文本', { path: filePath })
        if (matches > 1 && !replaceAll) {
          return errorResult('oldText 匹配多处，请提供更长的唯一片段或设置 replaceAll=true', { matches })
        }
        const updated = replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, newText)
        fs.writeFileSync(full, updated, 'utf-8')
        log('agent_fs_edit', { path: filePath, matches, replaceAll: !!replaceAll }, true)
        // 2026-08-20（W-F）：编辑后落 files 元数据（双写，AI 无感知）；W1：包校验反馈回流
        let fsFeedback: string | undefined
        try {
          const feedback = await hooks?.onFsFileWritten?.(full)
          if (typeof feedback === 'string' && feedback) fsFeedback = feedback
        } catch { /* 双写失败静默 */ }
        // 2026-08-13 即时生效：命中 apps/<appId>/index.html → 触发建版本回调
        const appIdHit = matchAppIndexHtml(getWorkspaceRoot(key), path.relative(getWorkspaceRoot(key), full))
        if (appIdHit) {
          try { await hooks?.onAppSourceChanged?.(appIdHit, filePath) } catch { /* 回调失败不影响编辑 */ }
        }
        return okResult({ success: true, path: filePath, matches, bytes: Buffer.byteLength(updated, 'utf-8'), ...(fsFeedback ? { note: fsFeedback } : {}) })
      } catch (error) {
        log('agent_fs_edit', params as Record<string, unknown>, false, error instanceof Error ? error.message : String(error))
        return errorResult('编辑失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const copyTool: ToolDefinition = {
    name: 'agent_fs_copy',
    label: '复制工作区文件/目录',
    description: '在工作区内复制文件或目录（二进制安全，图片/音频/视频等任何文件都可复制；logs/ 与 meta.json 为系统文件，不可作为目标）。适合把生成的图片等素材放进 App（如复制 agent/images/xxx.png → apps/<appId>/assets/xxx.png）。目标路径已存在则报错，请先删或用新文件名。',
    parameters: Type.Object({
      source: Type.String({ description: '源路径（相对工作区根，如 "agent/images/xxx.png"）' }),
      target: Type.String({ description: '目标路径（相对工作区根，如 "apps/app-xxx/assets/xxx.png"；目录会被自动创建）' }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const { source, target } = params as { source: string; target: string }
        if (typeof source !== 'string' || typeof target !== 'string' || !source.trim() || !target.trim()) {
          return errorResult('source 和 target 都必须是非空字符串')
        }
        const srcFull = resolve(source)
        if (!fs.existsSync(srcFull)) return errorResult('源不存在', { source })
        const targetRel = target.trim().replace(/^\/+/, '')
        const dstFull = resolve(targetRel)
        const dstRel = path.relative(getWorkspaceRoot(key), dstFull)
        if (dstRel.startsWith('..') || path.isAbsolute(dstRel)) return errorResult('目标越界')
        try {
          assertMutable(dstRel)
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : '目标为系统保护路径')
        }
        if (fs.existsSync(dstFull)) return errorResult('目标已存在（请先删除或使用新文件名）', { target })
        fs.mkdirSync(path.dirname(dstFull), { recursive: true })
        const stat = fs.statSync(srcFull)
        if (stat.isDirectory()) {
          fs.cpSync(srcFull, dstFull, { recursive: true })
        } else {
          fs.copyFileSync(srcFull, dstFull)
        }
        const dstStat = fs.statSync(dstFull)
        log('agent_fs_copy', { source, target, bytes: dstStat.size }, true)
        // 2026-08-20（W-F）：复制后落 files 元数据（双写，AI 无感知；目录复制走到目标后逐文件登记）；
        // 2026-08-21（W1）：复制进 packages/ 时回流包校验反馈
        let fsFeedback: string | undefined
        try {
          if (stat.isDirectory()) {
            const walkDst = (dir: string): void => {
              for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const child = path.join(dir, entry.name)
                if (entry.isDirectory()) walkDst(child)
                else void hooks?.onFsFileWritten?.(child)
              }
            }
            walkDst(dstFull)
          } else {
            const feedback = await hooks?.onFsFileWritten?.(dstFull)
            if (typeof feedback === 'string' && feedback) fsFeedback = feedback
          }
        } catch { /* 双写失败静默 */ }
        // 2026-08-13 即时生效：复制命中 apps/<appId>/index.html → 触发建版本回调
        const appIdHit = matchAppIndexHtml(getWorkspaceRoot(key), dstRel)
        if (appIdHit) {
          try { await hooks?.onAppSourceChanged?.(appIdHit, targetRel) } catch { /* 回调失败不影响复制 */ }
        }
        return okResult({ success: true, source, target, size: dstStat.size, type: stat.isDirectory() ? 'dir' : 'file', ...(fsFeedback ? { note: fsFeedback } : {}) })
      } catch (error) {
        log('agent_fs_copy', params as Record<string, unknown>, false, error instanceof Error ? error.message : String(error))
        return errorResult('复制失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  return [listTool, readTool, writeTool, mkdirTool, deleteTool, statTool, searchTool, grepTool, editTool, copyTool]
}

// ---------------------------------------------------------------------------
// 系统源码只读访问（「把源码给 AI」：AI 可读系统实现，理解能力边界）
// ---------------------------------------------------------------------------
// AI 可以通过 agent_src_list / agent_src_read 读取系统源码（只读）：
//   - server/src/         后端（webOS API、pi 会话、工具、工作区）
//   - client/shell-web/src/ 前端 Shell
//   - shared/             前后端共享契约
//   - AGENT.md            项目规则（含架构决策与运维说明）
// 禁止读取：node_modules、.env*、docs/（含部署手册与凭证）、data/、dist、.git 等。
// 只读，无写/删/建工具；运行中的 Shell 源码不允许 AI 修改（系统可恢复的安全带）。

const SYS_SOURCE_ALLOWED_ROOTS: Array<{ root: string; label: string }> = []

function getSysSourceRoots(): Array<{ root: string; label: string }> {
  if (SYS_SOURCE_ALLOWED_ROOTS.length > 0) return SYS_SOURCE_ALLOWED_ROOTS
  // 服务器运行目录：server/（pm2 cwd = /root/daily/server）
  const cwd = process.cwd()
  const projectRoot = path.resolve(cwd, '..')
  const candidates = [
    { root: path.resolve(projectRoot, 'server', 'src'), label: 'server/src' },
    { root: path.resolve(projectRoot, 'client', 'shell-web', 'src'), label: 'client/shell-web/src' },
    { root: path.resolve(projectRoot, 'shared'), label: 'shared' },
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate.root)) SYS_SOURCE_ALLOWED_ROOTS.push(candidate)
  }
  return SYS_SOURCE_ALLOWED_ROOTS
}

/**
 * 规范化系统源码路径输入（2026-08-04 修复：AI 按直觉传完整路径全部失败）：
 * 支持三种写法，统一映射到某个源码根下的相对路径：
 *   1. 相对路径："routes/webos.ts"、"App.tsx"、"webos-contracts/index.ts"
 *   2. 带根前缀的完整路径："server/src/routes/webos.ts"、"client/shell-web/src/App.tsx"、"shared/webos-contracts/index.ts"
 *   3. "../" 开头的路径（AI 常按项目根直觉写）："../client/shell-web/src/runtime.ts"
 * 返回 { label: 命中的源码根名（null=未指定，需遍历全部根）, rel: 相对该根的路径（''=根本身） }
 */
function normalizeSysSourceInput(input: string): { label: string | null; rel: string } {
  let trimmed = input.trim().replace(/^\/+/, '')
  while (trimmed.startsWith('../')) trimmed = trimmed.slice(3)
  for (const { label } of getSysSourceRoots()) {
    const prefix = `${label}/`
    if (trimmed === label || trimmed === `${label}/`) return { label, rel: '' }
    if (trimmed.startsWith(prefix)) return { label, rel: trimmed.slice(prefix.length) }
  }
  return { label: null, rel: trimmed }
}

/** 解析系统源码相对路径（如 "routes/webos.ts"、"App.tsx"、"webos-contracts/index.ts"），只读白名单 */
function resolveSysSourcePath(inputPath: string): { full: string; label: string } {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.length > MAX_PATH_LENGTH) {
    throw new Error('非法路径：长度必须在 1-512 之间')
  }
  if (inputPath.includes('\0')) throw new Error('非法路径：包含空字符')
  const { label: wantLabel, rel } = normalizeSysSourceInput(inputPath)
  if (!rel) throw new Error('需要指定文件路径（如 "routes/webos.ts" 或 "server/src/routes/webos.ts"）')
  for (const { root, label } of getSysSourceRoots()) {
    if (wantLabel && wantLabel !== label) continue
    const resolved = path.resolve(root, rel)
    const relative = path.relative(root, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue
    // 只允许常规文件（排除 node_modules、.env、dist 等）
    if (/node_modules|\.env|dist|\.git/.test(relative)) continue
    try {
      const stat = fs.statSync(resolved)
      if (stat.isFile() && stat.size <= MAX_READ_BYTES) return { full: resolved, label: `${label}/${relative}` }
    } catch {
      // 文件不存在，继续尝试下一个根
    }
  }
  throw new Error(`源码路径不可读：${inputPath}（支持相对路径如 "routes/webos.ts"，或完整路径如 "server/src/routes/webos.ts"；仅允许 server/src、client/shell-web/src、shared）`)
}

/** 系统源码只读工具（agent_src_list / agent_src_read） */
export function sysSourceTools(): ToolDefinition[] {
  const listSrc: ToolDefinition = {
    name: 'agent_src_list',
    label: '列出系统源码目录',
    description: '列出系统源码中某个目录的内容（只读）。根目录为 server/src、client/shell-web/src、shared。path 支持两种写法：相对路径（如 "routes"）或带根前缀的完整路径（如 "server/src/routes"）；不传则列出全部三个根目录。',
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: '源码目录路径（如 "routes" 或 "server/src/routes"，默认列出全部三个根目录）' })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const input = (params as { path?: string }).path
        const roots = getSysSourceRoots()
        if (!input || input.trim() === '' || input.trim() === '.') {
          const overview = roots.map(({ root, label }) => ({
            label,
            entries: fs.readdirSync(root, { withFileTypes: true })
              .slice(0, MAX_LIST_ENTRIES)
              .map((entry) => formatEntry(entry.name, path.join(root, entry.name))),
          }))
          return okResult({ success: true, roots: overview })
        }
        const { label: wantLabel, rel } = normalizeSysSourceInput(input)
        for (const { root, label } of roots) {
          if (wantLabel && wantLabel !== label) continue
          const resolved = rel ? path.resolve(root, rel) : root
          const relative = rel ? path.relative(root, resolved) : ''
          if (relative.startsWith('..') || path.isAbsolute(relative)) continue
          if (/node_modules|\.env|dist|\.git/.test(relative)) throw new Error(`路径不可读：${input}`)
          try {
            const entries = fs.readdirSync(resolved, { withFileTypes: true })
              .slice(0, MAX_LIST_ENTRIES)
              .map((entry) => formatEntry(entry.name, path.join(resolved, entry.name)))
            return okResult({ success: true, path: `${label}/${relative}`, entries })
          } catch {
            continue
          }
        }
        throw new Error(`目录不存在：${input}`)
      } catch (error) {
        return errorResult('源码目录列表失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const readSrc: ToolDefinition = {
    name: 'agent_src_read',
    label: '读取系统源码文件',
    description: '读取系统源码文件内容（只读，UTF-8，带行号）。用于理解系统能力与 API 实现。path 支持两种写法：相对路径（如 "routes/webos.ts"）或带根前缀的完整路径（如 "server/src/routes/webos.ts"、"client/shell-web/src/App.tsx"、"shared/webos-contracts/index.ts"）。',
    parameters: Type.Object({
      path: Type.String({ description: '源码文件路径（如 "server/src/routes/webos.ts"）' }),
      offset: Type.Optional(Type.Number({ description: '起始行号（从 1 开始，默认 1）' })),
      limit: Type.Optional(Type.Number({ description: '读取行数（默认 2000）' })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const { path: filePath, offset, limit } = params as { path: string; offset?: number; limit?: number }
        const { full, label } = resolveSysSourcePath(filePath)
        const content = fs.readFileSync(full, 'utf-8')
        const lines = content.split('\n')
        const startLine = Math.max(1, offset ?? 1) - 1
        const lineCount = limit ?? 2000
        const selected = lines.slice(startLine, startLine + lineCount)
        const numbered = selected.map((line, i) => `${String(startLine + i + 1).padStart(6)}→${line}`).join('\n')
        return okResult({
          success: true,
          path: label,
          totalLines: lines.length,
          shownLines: selected.length,
          content: numbered,
        })
      } catch (error) {
        return errorResult('读取源码失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const grepSrc: ToolDefinition = {
    name: 'agent_src_grep',
    label: '搜索系统源码内容',
    description: '在系统源码（server/src、client/shell-web/src、shared）中搜索文本或正则表达式，返回 文件:行号:内容（只读）。适合定位"哪里实现了 xxx"、找 API 定义、找常量、确认系统能力。path 可限定目录（如 "server/src/routes"）。',
    parameters: Type.Object({
      pattern: Type.String({ description: '搜索关键词或正则表达式（如 "store/apps"、"PROXY_SSRF"）' }),
      path: Type.Optional(Type.String({ description: '限定搜索目录（如 "server/src/routes"，默认全部源码根）' })),
      maxResults: Type.Optional(Type.Number({ description: '最多返回匹配行数（默认 40，最大 120）' })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const { pattern, path: srcPath, maxResults } = params as { pattern?: string; path?: string; maxResults?: number }
        if (typeof pattern !== 'string' || pattern.length === 0) return errorResult('pattern 必须为非空字符串')
        let regex: RegExp
        try {
          regex = new RegExp(pattern, 'i')
        } catch {
          regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        }
        const limit = Math.min(Math.max(1, maxResults ?? 40), 120)
        const roots = getSysSourceRoots()
        const results: Array<{ file: string; line: number; content: string }> = []
        const walk = (dir: string, root: string, label: string, depth: number): void => {
          if (depth > 10 || results.length >= limit) return
          let entries: fs.Dirent[]
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
          } catch {
            return
          }
          for (const entry of entries) {
            if (results.length >= limit) return
            const full = path.join(dir, entry.name)
            const rel = path.relative(root, full).replace(/\\/g, '/')
            if (entry.isDirectory()) {
              if (/node_modules|\.git|dist|\.cache/.test(rel)) continue
              walk(full, root, label, depth + 1)
            } else if (entry.isFile()) {
              if (/\.env|\.map$/.test(rel)) continue
              try {
                const stat = fs.statSync(full)
                if (stat.size > MAX_READ_BYTES) continue
                const content = fs.readFileSync(full, 'utf-8')
                if (content.includes('\0')) continue
                const lines = content.split('\n')
                for (let i = 0; i < lines.length && results.length < limit; i++) {
                  if (regex.test(lines[i])) {
                    const text = lines[i].length > 300 ? `${lines[i].slice(0, 300)}…` : lines[i]
                    results.push({ file: `${label}/${rel}`, line: i + 1, content: text })
                  }
                }
              } catch {
                // 单个文件读取失败跳过
              }
            }
          }
        }
        for (const { root, label } of roots) {
          if (typeof srcPath === 'string' && srcPath.trim()) {
            const { label: wantLabel, rel } = normalizeSysSourceInput(srcPath)
            if (wantLabel && wantLabel !== label) continue
            const resolved = rel ? path.resolve(root, rel) : root
            const relative = rel ? path.relative(root, resolved) : ''
            if (!relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
              walk(resolved, root, label, 0)
            }
          } else {
            walk(root, root, label, 0)
          }
        }
        return okResult({ success: true, pattern, matches: results.length, results })
      } catch (error) {
        return errorResult('源码搜索失败', { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  return [listSrc, readSrc, grepSrc]
}

// ============================================================================
// 用户文件上传区（2026-08-02）
// 用户通过文件 App / 上传端点把图片等文件放入工作区 home/（用户可见区），
// AI 可用 agent_fs_* 读取使用；home/ 是工作区的一部分，天然 per-user 隔离。
// 限制：工作区总大小（唯一闸门）+ 文件类型白名单（防可执行文件/脚本入库）；
// 2026-08-12 已取消单文件大小上限。
// ============================================================================

// 2026-08-12 已取消单文件上传大小限制：只受工作区总配额约束（workspaceLimitFor）。
/** 游客工作区总大小上限：200MB（不能上传文件，空间给 AI 生成物/App 素材用） */
export const MAX_WORKSPACE_BYTES = 200 * 1024 * 1024
/** 已登录用户工作区总大小上限：512MB（2026-08-12 用户决策；套餐用户更高档位见下） */
export const MEMBER_WORKSPACE_BYTES = 512 * 1024 * 1024

/**
 * 2026-08-12 付费套餐存储档位（与爱发电月卡对应）：
 * 轻量月卡 10GB / 中量月卡 30GB / 重量月卡 100GB；尝鲜用量包不含存储。
 */
export const WORKSPACE_TIER_BYTES: Record<string, number> = {
  // 2026-08-12 兑换码商品（新）：轻量/中量/重量月卡（付款拿兑换码 → 兑换激活）
  '2aeac1b692e211f1972b5254001e7c00': 10 * 1024 * 1024 * 1024, // 轻量月卡·兑换码（¥9.9）
  '2c0d304292e211f19b9f5254001e7c00': 30 * 1024 * 1024 * 1024, // 中量月卡·兑换码（¥29）
  '2d295a7892e211f1a2f85254001e7c00': 100 * 1024 * 1024 * 1024, // 重量月卡·兑换码（¥99）
  // 旧订阅月卡（兼容存量用户）
  db929ac0918411f1926052540025c377: 10 * 1024 * 1024 * 1024,
  f77af912918411f1923c52540025c377: 30 * 1024 * 1024 * 1024,
  '0f7ca114918511f1a34e52540025c377': 100 * 1024 * 1024 * 1024,
  // 2026-08-13 补漏：旧档「轻量支持」（¥9.9 月卡，LEGACY_SUBSCRIBE_TIERS）同样映射 10GB——
  // 此前不在映射表导致存量购买者（如站长 8-06 测试自充）兑换/发货后存储仍停留 512MB
  '1646bd9a8ea111f1ac995254001e7c00': 10 * 1024 * 1024 * 1024,
}

/** 按身份返回工作区总大小上限（游客 200MB / 已登录 512MB 基础值） */
export function workspaceLimitFor(key: string): number {
  return key.startsWith('user:') ? MEMBER_WORKSPACE_BYTES : MAX_WORKSPACE_BYTES
}

/** 按 StoredState 返回工作区配额（state.workspaceBytes 显式存储：月卡档位/管理员调整优先） */
export function workspaceLimitForState(state: { workspaceBytes?: number | null }): number {
  const stored = state.workspaceBytes
  return typeof stored === 'number' && stored > 0 ? stored : MEMBER_WORKSPACE_BYTES
}

/**
 * 2026-08-12 异步解析工作区配额（无 StoredState 上下文时用，如 agent_fs_write）：
 * 直接查 entities 表的 webos_state JSON 取 workspaceBytes（月卡档位），失败回退基础值。
 */
export async function workspaceLimitResolved(key: string): Promise<number> {
  try {
    const pool = getPool()
    const result = await pool.query(
      'SELECT data FROM entities WHERE id = $1 AND type = $2 AND scope = $3',
      [`webos-state:${key}`, 'webos_state', key],
    )
    const raw = result.rows[0]?.data
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw) as { workspaceBytes?: unknown }
      const bytes = Number(parsed?.workspaceBytes ?? 0)
      if (Number.isFinite(bytes) && bytes > 0) return bytes
    }
  } catch { /* 查询失败回退基础值 */ }
  return workspaceLimitFor(key)
}
/** 用户可上传的文件类型白名单（图片/文档/媒体/压缩包；禁止脚本与可执行文件） */
const UPLOAD_EXT_WHITELIST = new Set([
  // 图片
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
  // 文档
  'md', 'txt', 'json', 'csv', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'epub',
  // 网页/代码（仅存储，不执行；App 运行时另有 sandbox 校验）
  'html', 'htm', 'css', 'js', 'xml', 'yaml', 'yml', 'log', 'ini', 'conf', 'cfg',
  // 媒体
  'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac',
  'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv', '3gp', 'mpeg', 'mpg',
  // 压缩包 / 镜像 / 安装包（数据文件，服务器不执行）
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'img', 'dmg', 'pkg',
  'apk', 'msi', 'deb', 'rpm',
  // 二进制/数据
  'bin', 'dat', 'psd', 'ai', 'xmind', 'kml', 'kmz', 'dwg', 'dxf', 'cbr', 'cbz',
  // 其他常见安全格式
  'ics', 'vcf', 'srt', 'ttf', 'otf', 'woff', 'woff2', 'eot',
])

/** 用户可上传的文件名（去除路径分隔符，保留扩展名） */
export function sanitizeUploadName(fileName: string): string {
  const base = String(fileName ?? '').replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = base.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 120)
  return cleaned || `file-${Date.now()}`
}

/** 是否允许该文件名上传（白名单扩展名） */
export function isAllowedUploadName(fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  return UPLOAD_EXT_WHITELIST.has(ext)
}

/** 统计工作区总大小（遍历所有文件累加） */
export function workspaceUsedBytes(key: string): number {
  const root = getWorkspaceRoot(key)
  let total = 0
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      try {
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile()) total += fs.statSync(full).size
      } catch { /* 忽略单个文件错误 */ }
    }
  }
  walk(root)
  return total
}

/**
 * 校验用户可见区（home/）内路径：仅允许 home/ 下的文件（用户上传区），
 * 禁止访问 agent/ system/ apps/ logs/ 等区域（那些是 AI/系统内部区）。
 * 返回解析后的绝对路径。
 */
export function resolveUserHomePath(key: string, inputPath: string): string {
  const root = getWorkspaceRoot(key)
  const homeRoot = path.join(root, 'home')
  fs.mkdirSync(homeRoot, { recursive: true })
  if (typeof inputPath !== 'string' || inputPath.length > MAX_PATH_LENGTH) {
    throw new Error('非法路径')
  }
  if (inputPath.includes('\0')) throw new Error('非法路径：包含空字符')
  const trimmed = inputPath.trim().replace(/^\/+/, '')
  // 空路径 = 用户可见区根目录（home/）
  if (trimmed === '') return homeRoot
  const resolved = path.resolve(homeRoot, trimmed)
  const relative = path.relative(homeRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('路径越界：只能访问用户可见区（home/）')
  }
  return resolved
}

/**
 * 系统 Logo（2026-08-02）：AI 可替换的站点标识。
 * 工作区 system/logo.svg（优先）或 system/logo.png 存在时生效；
 * 前端未读到文件时显示默认文字标识「D」。
 * AI 用 agent_fs_write 修改该文件即可更换 Logo。
 */
export function logoFilePath(key: string): string | null {
  const root = getWorkspaceRoot(key)
  const svg = path.join(root, 'system', 'logo.svg')
  const png = path.join(root, 'system', 'logo.png')
  try {
    if (fs.existsSync(svg) && fs.statSync(svg).isFile()) return svg
    if (fs.existsSync(png) && fs.statSync(png).isFile()) return png
  } catch { /* 保持默认 */ }
  return null
}

/** 读取系统 Logo 文件内容（base64）；返回 null 表示未设置 */
export function readLogoFile(key: string): { mime: string; base64: string } | null {
  const file = logoFilePath(key)
  if (!file) return null
  try {
    const data = fs.readFileSync(file)
    if (data.length === 0 || data.length > 4 * 1024 * 1024) return null
    const mime = file.endsWith('.png') ? 'image/png' : 'image/svg+xml'
    return { mime, base64: data.toString('base64') }
  } catch {
    return null
  }
}

/**
 * 定制加载页（2026-08-02）：工作区 system/boot.html（自包含 HTML，AI 可写）
 * + system/boot.json（可选，{"durationMs": 500-10000} 加载页最短展示时长）。
 * 未设置时返回默认值（html=null、durationMs=1200）。
 */
export function readBootConfig(key: string): { html: string | null; durationMs: number } {
  const root = getWorkspaceRoot(key)
  const htmlPath = path.join(root, 'system', 'boot.html')
  let html: string | null = null
  try {
    if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isFile()) {
      const raw = fs.readFileSync(htmlPath, 'utf-8')
      if (raw.trim().length > 0 && raw.length <= 256 * 1024) html = raw
    }
  } catch { /* 保持默认 */ }
  let durationMs = 1200
  try {
    const jsonPath = path.join(root, 'system', 'boot.json')
    if (fs.existsSync(jsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { durationMs?: unknown }
      const value = Number(parsed.durationMs)
      if (Number.isFinite(value)) durationMs = Math.min(10_000, Math.max(300, Math.round(value)))
    }
  } catch { /* 解析失败用默认时长 */ }
  return { html, durationMs }
}

/**
 * 用户头像（2026-08-03）：工作区 system/avatar.svg（优先）或 system/avatar.png。
 * 用户/ AI 均可替换；未设置时前端显示首字母。与 Logo 同一机制。
 */
export function readAvatarFile(key: string): { mime: string; base64: string } | null {
  const root = getWorkspaceRoot(key)
  const svg = path.join(root, 'system', 'avatar.svg')
  const png = path.join(root, 'system', 'avatar.png')
  let file: string | null = null
  try {
    if (fs.existsSync(svg) && fs.statSync(svg).isFile()) file = svg
    else if (fs.existsSync(png) && fs.statSync(png).isFile()) file = png
  } catch { /* 保持默认 */ }
  if (!file) return null
  try {
    const data = fs.readFileSync(file)
    if (data.length === 0 || data.length > 4 * 1024 * 1024) return null
    const mime = file.endsWith('.png') ? 'image/png' : 'image/svg+xml'
    return { mime, base64: data.toString('base64') }
  } catch {
    return null
  }
}
