// ============================================================================
// Phase 6：官方社区列表（spec §9.3 节）
// Phase 7：shadowshubs 内置官方社区面板（spec §14 节）
//
// 联邦式社区模型：每个 Daily 部署 = 一个独立社区实例。
// 官方社区列表是 Daily 项目维护的"推荐社区"清单，部署者/用户可一键添加。
//
// 申请机制（spec §9.3 "开发者提交申请，默认通过"）：
// - 开发者在自己部署的 Daily 实例上运行后，向 Daily 官方仓库提 PR 加入此清单
// - 默认通过（不审核内容，仅校验地址可达）
// - 详见 docs/developer-guide.md "官方社区申请"章节
//
// Phase 7 §14：shadowshubs 做成 Daily 的内置官方社区面板（不是独立部署的项目）。
// - isBuiltin=true 标记为内置，前端可直接进入（不需要"添加"）
// - apiUrl 为空字符串（内置，不需要外部 API）
// ============================================================================

export interface OfficialCommunity {
  /** 稳定标识（用于去重，不随地址变化） */
  id: string
  name: string
  description: string
  /** 该官方社区的 Daily API 地址（联邦入口）。内置社区为空字符串 */
  apiUrl: string
  /** 图标 URL（可选） */
  icon?: string
  /** 是否为官方社区（默认 true，列在官方清单中） */
  isOfficial?: boolean
  /** 是否为内置社区（无需"添加"，可直接进入）。Phase 7 §14 */
  isBuiltin?: boolean
}

/**
 * 官方社区清单（硬编码）。
 *
 * Phase 7：shadowshubs 作为第一个官方社区，标记为内置（isBuiltin=true）。
 * 其余为联邦式示例社区，apiUrl 为占位地址，真实部署后由各社区运营者填写。
 */
export const OFFICIAL_COMMUNITIES: OfficialCommunity[] = [
  // Phase 7 §14：shadowshubs 内置官方社区面板
  {
    id: 'shadowshubs-official',
    name: 'shadowshubs',
    description: 'Daily 官方社区面板 - 游戏/Skill/素材',
    apiUrl: '', // 内置，不需要外部 API
    icon: '/daily/icon.png',
    isOfficial: true,
    isBuiltin: true,
  },
  {
    id: 'official-daily',
    name: 'Daily 官方社区',
    description: '官方维护的公共社区，发布 Daily 项目动态与示例面板',
    apiUrl: 'https://community.daily.dev/api',
    icon: 'https://community.daily.dev/icon.png',
    isOfficial: true,
  },
  {
    id: 'official-game-dev',
    name: '游戏开发者社区',
    description: 'HTML5 游戏开发交流，分享游戏组件与素材',
    apiUrl: 'https://gamedev.daily.dev/api',
    icon: 'https://gamedev.daily.dev/icon.png',
    isOfficial: true,
  },
  {
    id: 'official-design',
    name: '设计师社区',
    description: 'UI/UX 设计分享，展示设计稿与交互原型',
    apiUrl: 'https://design.daily.dev/api',
    icon: 'https://design.daily.dev/icon.png',
    isOfficial: true,
  },
]
