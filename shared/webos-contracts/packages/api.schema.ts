// ============================================================================
// api.json —— App API 声明格式（单一事实源）
// ----------------------------------------------------------------------------
// 依据：docs/routes/web/04-app-api.md §1（owner + public 技术管道）。
// API 用声明式 api.json 描述，系统自动把它变成：服务端代理端点 +
// AI 的 pi 工具 + 用户文档页 + 可上架的 api 包。
// 本文件用 TypeBox 定义 schema 并导出：
//   - API_SCHEMA      : TypeBox 类型（TS 一侧直接使用）
//   - API_JSON_SCHEMA : 序列化后的纯 JSON Schema（跨端消费）
// 新增字段必须：本表 + 04 文档 + 双端实现同步（R6），缺一不可。
// ============================================================================

import { Type, type Static } from 'typebox'

export const API_VISIBILITIES = ['owner', 'public'] as const
export const API_METHODS = ['GET', 'POST'] as const
export const API_SCHEMA_VERSION = 1 as const

// ---- 端点可复用字段 ----

/** 端点级 JSON Schema 参数（宽松：接受任意 JSON Schema object） */
const JsonSchemaObject = Type.Object(
  {
    type: Type.Literal('object'),
    properties: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
)

/** 单端点声明 */
const Endpoint = Type.Object(
  {
    /** 端点名：小写下划线，→ 工具名 appapi_<namespace>_<name> */
    name: Type.String({ pattern: '^[a-z][a-z0-9_]*$', minLength: 1, maxLength: 64 }),
    /** GET=只读；POST=有副作用 */
    method: Type.Optional(Type.Union(API_METHODS.map((m) => Type.Literal(m)))),
    /** 端点路径（相对命名空间基） */
    path: Type.String({ pattern: '^/[a-zA-Z0-9/_-]*$', maxLength: 256 }),
    description: Type.Optional(
      Type.Object(
        {
          zh: Type.Optional(Type.String({ maxLength: 500 })),
          en: Type.Optional(Type.String({ maxLength: 500 })),
        },
        { minProperties: 1 },
      ),
    ),
    /** 请求参数 JSON Schema（供 AI 工具化 + 文档页 + 在线调试） */
    params: Type.Optional(JsonSchemaObject),
    /** 允许的 storage 前缀（读；权限四交集求交） */
    storage: Type.Optional(
      Type.Object(
        {
          read: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 })),
          write: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 })),
        },
        { additionalProperties: false },
      ),
    ),
    /** handler 文件相对路径（服务端受限 vm 执行；只暴露 async main(ctx)） */
    handler: Type.String({ pattern: '^[a-zA-Z0-9_./-]+\\.js$', maxLength: 256 }),
    /** 返回值 JSON Schema（校验 handler 输出） */
    returns: Type.Optional(Type.Object({}, { additionalProperties: true })),
    /** 可见性：owner=仅本人+其 AI（默认）；public=任何安装者（web 先行） */
    visibility: Type.Optional(Type.Union(API_VISIBILITIES.map((v) => Type.Literal(v)))),
  },
  { additionalProperties: true, required: ['name', 'path', 'handler'] },
)

// ---- 顶层 api.json ----

export const API_SCHEMA = Type.Object(
  {
    schema_version: Type.Literal(API_SCHEMA_VERSION),
    /** 命名空间：全局唯一，建议 = 包 id 末段；→ 端点前缀 /webos/api/appapi/:namespace/:endpoint */
    namespace: Type.String({ pattern: '^[a-z][a-z0-9.-]*$', minLength: 1, maxLength: 64 }),
    display_name: Type.Optional(
      Type.Object(
        {
          zh: Type.Optional(Type.String({ maxLength: 200 })),
          en: Type.Optional(Type.String({ maxLength: 200 })),
        },
        { minProperties: 1 },
      ),
    ),
    /** 出站网络白名单（可选；handler 的 ctx.http 仅允许这些域名） */
    network: Type.Optional(
      Type.Object(
        {
          domains: Type.Optional(
            Type.Array(Type.String({ pattern: '^(\\*\\.)?[a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)+$' }), { maxItems: 64 }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    /** 用户在包设置页填写的密钥名（值仅存服务端加密；永不进日志/AI 上下文） */
    secrets: Type.Optional(Type.Array(Type.String({ pattern: '^[A-Z][A-Z0-9_]*$', maxLength: 64 }), { maxItems: 16 })),
    endpoints: Type.Array(Endpoint, { minItems: 1, maxItems: 64 }),
  },
  { additionalProperties: true, required: ['schema_version', 'namespace', 'endpoints'] },
)

/** 推导出的 TS 静态类型 */
export type WebOsApiSpec = Static<typeof API_SCHEMA>

/** 序列化纯 JSON Schema */
export const API_JSON_SCHEMA = JSON.parse(JSON.stringify(API_SCHEMA)) as Record<string, unknown>

/** handler 受限运行时参数（栈侧常量，单一事实源） */
export const API_HANDLER_LIMITS = {
  /** 单次 handler 执行超时（毫秒） */
  timeoutMs: 5000,
  /** handler 输出截断上限（字节） */
  maxOutputBytes: 64 * 1024,
  /** ctx.http 响应上限（字节） */
  maxHttpResponseBytes: 256 * 1024,
  /** ctx.http 超时（毫秒） */
  maxHttpTimeoutMs: 30_000,
  /** 单会话动态 API 工具上限 */
  maxDynamicToolsPerSession: 60,
} as const