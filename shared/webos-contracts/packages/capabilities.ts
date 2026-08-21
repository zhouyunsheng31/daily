// ============================================================================
// 能力词汇表（web 版 v1 · 单一事实源）
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/03-package-system.md §6（web 路线 v1 词汇表）。
// 与移动端共享同一套能力词；设备专属词在移动端登记为可用、web 端登记
// 为 unavailable；新增词汇必须：登记本表 + 写进 03 文档 + 双端实现，缺一不可上线。
// web 端红线（R5）：process.spawn / compute.exec 标 unavailable（不开终端/任意进程）。
// ============================================================================

/** 能力可用性：web 端是否可放行（移动端求交时按端侧能力另行判定） */
export type WebOsCapabilityAvailability = 'available' | 'unavailable' | 'mobile-only'

export interface WebOsCapabilityDef {
  /** 能力词（全小写点分命名空间） */
  id: string
  /** 当前 web 路线可用性 */
  web: WebOsCapabilityAvailability
  /** 一句话说明 */
  desc: string
  /** 对应里程碑（P0/W1/W2/W3/W4/W5 等） */
  phase?: string
}

/** 能力词汇表（只读，单一事实源）——新增能力必须先加这里 */
export const WEBOS_CAPABILITIES: readonly WebOsCapabilityDef[] = [
  // ---- 已有（P0）----
  { id: 'app.storage.private', web: 'available', desc: 'App 私有 KV 存储', phase: 'P0' },
  { id: 'app.fs', web: 'available', desc: 'App 私有文件区', phase: 'P0' },
  { id: 'app.fs.shared', web: 'available', desc: '跨 App 共享文件区', phase: 'P0' },
  { id: 'system.apps.create', web: 'available', desc: '在 App 内创建新 App', phase: 'P0' },
  // ---- App API（W2/W3）----
  { id: 'app.api.invoke', web: 'available', desc: '调用其他 App 的 API', phase: 'W2' },
  // ---- 文件工作区（W-F）----
  { id: 'files.workspace.read', web: 'available', desc: '文件工作区读（粒度到目录）', phase: 'W-F' },
  { id: 'files.workspace.write', web: 'available', desc: '文件工作区写（粒度到目录）', phase: 'W-F' },
  // ---- 网络（须配合 network.domains 白名单）----
  { id: 'network.outbound', web: 'available', desc: '出站网络（须白名单域名）', phase: 'W2' },
  // ---- UI 包化（W4；安全 UI 例外不可挂载）----
  { id: 'ui.extend', web: 'available', desc: 'UI 扩展（安全 UI 例外除外）', phase: 'W4' },
  { id: 'ui.layout', web: 'available', desc: 'UI 布局调整（非安全 UI）', phase: 'W4' },
  { id: 'ui.component', web: 'available', desc: 'UI 组件挂载（非安全 UI）', phase: 'W4' },
  { id: 'ui.theme', web: 'available', desc: '主题（design tokens 覆盖包）', phase: 'W4' },
  // ---- Provider（W5）----
  { id: 'provider.switch', web: 'available', desc: '切换能力 Provider', phase: 'W5' },
  // ---- sub-agent（W5）----
  { id: 'subagent.spawn', web: 'available', desc: '派发 sub-agent', phase: 'W5' },
  { id: 'subagent.manage', web: 'available', desc: '管理 sub-agent 会话', phase: 'W5' },
  // ---- 预留 unavailable（红线：能力不满足只报 unavailable）----
  { id: 'media.tts', web: 'unavailable', desc: '语音合成（预留）', phase: '预留' },
  { id: 'media.asr', web: 'unavailable', desc: '语音识别（预留）', phase: '预留' },
  { id: 'room.join', web: 'unavailable', desc: '联机房间加入（后置）', phase: '后置' },
  { id: 'room.host', web: 'unavailable', desc: '联机房间托管（后置）', phase: '后置' },
  { id: 'process.spawn', web: 'unavailable', desc: '任意进程（R5 不开终端）', phase: '红线' },
  { id: 'compute.exec', web: 'unavailable', desc: '任意代码执行（R5 预留）', phase: '红线' },
  // ---- mobile-only（web 端登记不可用；移动端求交）----
  { id: 'overlay.spawn', web: 'mobile-only', desc: '悬浮窗形态（移动端）', phase: 'M2' },
  { id: 'device.screen.read', web: 'mobile-only', desc: '屏幕读取（移动端）', phase: 'M0' },
  { id: 'device.ui.automate', web: 'mobile-only', desc: 'UI 自动化（移动端）', phase: 'M0' },
  { id: 'device.shizuku', web: 'mobile-only', desc: 'Shizuku 增强（移动端）', phase: 'M0' },
  { id: 'pet-layer.overlay', web: 'mobile-only', desc: '桌宠悬浮形态（移动端，暂缓）', phase: 'M2-5' },
]

/** 能力 id 的只读集合（校验用） */
export const WEBOS_CAPABILITY_IDS: readonly string[] = WEBOS_CAPABILITIES.map((c) => c.id)

/** 静态类型：允许的完整能力 id 联合 */
export type WebOsCapabilityId = (typeof WEBOS_CAPABILITIES)[number]['id']

/** 静态类型：当前 web 可放行的能力 id 联合（available 才可求交放行） */
export type WebOsAvailableCapabilityId = Extract<
  (typeof WEBOS_CAPABILITIES)[number],
  { web: 'available' }
>['id']

/** 判断某个词是否在词汇表内 */
export function isWebOsCapability(id: string): boolean {
  return WEBOS_CAPABILITY_IDS.includes(id)
}

/** 判断某个词在 web 端当前是否可放行 */
export function isWebOsCapabilityAvailable(id: string): boolean {
  const def = WEBOS_CAPABILITIES.find((c) => c.id === id)
  return def?.web === 'available'
}

/** 校验一组能力声明：逐词校验，返回不合法/不可用的词语列表 */
export function validateCapabilities(
  caps: readonly string[],
): { invalid: string[]; unavailable: string[] } {
  const invalid: string[] = []
  const unavailable: string[] = []
  for (const c of caps) {
    if (!isWebOsCapability(c)) invalid.push(c)
    else if (!isWebOsCapabilityAvailable(c)) unavailable.push(c)
  }
  return { invalid, unavailable }
}
