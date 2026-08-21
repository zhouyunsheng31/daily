// ============================================================================
// daily.pkg.json v2 —— 统一包 Manifest（单一事实源）
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/03-package-system.md §2（web 执行语义）
//       + docs/android/03-package-system.md §2（同源，组合式包 D19）
// 本文件用 TypeBox 定义 schema 并导出：
//   - PACKAGE_SCHEMA      : TypeBox 类型（TS 一侧直接用于校验/推导类型）
//   - PACKAGE_JSON_SCHEMA : 序列化后的纯 JSON Schema（跨端消费：服务端校验器 /
//                           移动端 Kotlin DTO 生成 / 文档）
// 新增字段必须：本表 + 03 文档 + 双端实现同步（R6），缺一不可。
// ============================================================================

import { Type, type Static } from 'typebox'

// ---- 基础标量 ----

/** 包 id：Unicode 字母/数字/`._-`；排除路径分隔符与 `..`（APP_ID_PATTERN 放宽决策） */
const PackageId = Type.String({
  title: 'PackageId',
  description:
    '包全局唯一 id。允许 Unicode 字母/数字/`._-`，禁止路径分隔符与 `..`（防穿越）。',
  pattern: '^[\\p{L}\\p{N}._ -]+$',
  minLength: 1,
  maxLength: 128,
})

/** 版本号：合法 semver（x.y.z，可带 -pre 后缀） */
const SemVer = Type.String({
  pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$',
  description: '合法 semver，如 1.2.0 / 1.2.0-beta.1',
})

/** 多语言短文本（至少一语言） */
const Localized = Type.Object(
  {
    zh: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    en: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { minProperties: 1, description: '多语言文本，至少一种语言非空' },
)

/** 出站网络白名单域名（允许 `*.example.com` 子域通配） */
const DomainList = Type.Array(Type.String({ pattern: '^(\\*\\.)?[a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)+$' }), {
  maxItems: 64,
})

// ---- 组合式包内容（D19：skills/mcp/tools/tokens/assets） ----

const PackageContents = Type.Object(
  {
    skills: Type.Optional(
      Type.Array(Type.String({ description: '内置 skill 相对路径，如 skills/ui-guide/SKILL.md' }), {
        maxItems: 64,
      }),
    ),
    mcp: Type.Optional(
      Type.Array(
        Type.Object({
          server: Type.String({ description: 'MCP server 标识：json-rpc | stdio | sse | remote' }),
          entry: Type.String({ description: 'server 入口相对路径' }),
          env: Type.Optional(Type.Record(Type.String(), Type.String(), { description: 'env 模板（值可含 ${SECRET} 引用）' })),
        }),
      ),
    ),
    tools: Type.Optional(Type.Array(Type.String({ description: '内置工具相对路径' }), { maxItems: 128 })),
    tokens: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: '主题 tokens（theme/ui 包）' })),
    assets: Type.Optional(Type.Array(Type.String({ description: '资源相对路径（壁纸/图标/音频等）' }), { maxItems: 256 })),
  },
  { additionalProperties: false },
)

// ---- 顶层 Manifest ----

export const PACKAGE_TYPES = [
  'app',
  'pet-layer',
  'api',
  'skill',
  'theme',
  'toolpkg',
  'mcp',
  'workflow',
  'model-pack',
  'url-app',
  'provider',
  'subagent',
  'bundle',
] as const

export const PACKAGE_SCHEMA = Type.Object(
  {
    schema_version: Type.Literal(2, { description: 'Manifest 版本：当前组合式包 v2（D19）' }),
    id: PackageId,
    type: Type.Union(PACKAGE_TYPES.map((t) => Type.Literal(t)), { description: '包类型（13 种）' }),
    version: SemVer,
    /** 类型相关入口：app/pet-layer→html；api→api.json；skill→SKILL.md；toolpkg→main.js；url-app/bundle→可空 */
    entry: Type.Optional(Type.String({ minLength: 1, maxLength: 512, description: '类型相关入口（相对路径）' })),
    display_name: Type.Optional(Localized),
    description: Type.Optional(
      Type.Object(
        {
          zh: Type.Optional(Type.String({ maxLength: 1000 })),
          en: Type.Optional(Type.String({ maxLength: 1000 })),
        },
        { minProperties: 1 },
      ),
    ),
    icon: Type.Optional(Type.String({ maxLength: 512, description: '图标相对路径（缺省系统生成）' })),
    /** 能力声明（白名单词汇表见 shared/webos-contracts/packages/capabilities.ts） */
    capabilities: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 })),
    /** 出站网络白名单（默认空=禁网）——红线：域名必须在词汇表且禁内网段 */
    network: Type.Optional(
      Type.Object(
        {
          domains: Type.Optional(DomainList),
        },
        { additionalProperties: false },
      ),
    ),
    /** 包依赖（安装时按 id+range 解析；跨 App 组合核心） */
    dependencies: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: PackageId,
            range: Type.Optional(Type.String({ pattern: '^[\\^~><=*]?\\d+\\.\\d+\\.\\d+(\\s*\\|\\|\\s*[\\^~><=*]?\\d+\\.\\d+\\.\\d+)*$', description: 'semver range（默认 ^x.y.z）' })),
          },
          { additionalProperties: false },
        ),
        { maxItems: 128 },
      ),
    ),
    /** type=pet-layer 专属段 */
    pets: Type.Optional(
      Type.Object(
        {
          maxInstances: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
          physics: Type.Optional(Type.String({ maxLength: 32 })),
        },
        { additionalProperties: false },
      ),
    ),
    /** type=api 专属段：指定 api.json 路径（见 api.schema.ts） */
    api: Type.Optional(
      Type.Object(
        {
          spec: Type.String({ description: 'api.json 相对路径，默认 api.json' }),
        },
        { additionalProperties: false },
      ),
    ),
    /** type=url-app 专属段 */
    url: Type.Optional(
      Type.Object(
        {
          startUrl: Type.String({ description: '外部网页 URL（https）' }),
          mode: Type.Optional(Type.Union([Type.Literal('live'), Type.Literal('snapshot')])),
        },
        { additionalProperties: false, required: ['startUrl'] },
      ),
    ),
    // ===== v2 组合式包（D19）=====
    contents: Type.Optional(PackageContents),
    /** 子包 id（嵌套 ≤3 层，且引用已注册且未被占用的包 id） */
    children: Type.Optional(Type.Array(PackageId, { maxItems: 64, uniqueItems: true, description: '子包 id（嵌套 ≤3 层）' })),
    /** 需要的最低 Shell/服务端契约版本 */
    minShell: Type.Optional(Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+$' })),
  },
  { additionalProperties: false, required: ['schema_version', 'id', 'type', 'version'] },
)

/** 推导出的 TS 静态类型 */
export type WebOsPackageManifest = Static<typeof PACKAGE_SCHEMA>

/** 序列化纯 JSON Schema（跨端消费：服务端校验器 / 移动端 DTO 生成） */
export const PACKAGE_JSON_SCHEMA = JSON.parse(JSON.stringify(PACKAGE_SCHEMA)) as Record<string, unknown>

/** children 嵌套最大层数（D19 硬约束） */
export const PACKAGE_CHILDREN_MAX_DEPTH = 3
/** 单包体积配额（静态拒绝：超配额直接拒绝） */
export const PACKAGE_MAX_BYTES = 10 * 1024 * 1024