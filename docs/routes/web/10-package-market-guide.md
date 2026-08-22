# 10 · 包体系与统一市场开发者指南（AI 与外部开发者规范）

> 依据：`shared/webos-contracts/packages/`、`03-package-system.md`、`04-app-api.md`、`05-market.md`。
> 本文作为 Daily webOS「一切皆包 · 组合式包」体系与统一市场的权威开发者指南。

---

## 1. 架构定位：AI 原生应用与能力包标准（AI-Native Package Spec）

Daily 包协议是一个**全栈能力封装规范**，不仅仅是类似 MCP 的单一 Tool RPC 协议，而是涵盖：
- **UI 展现**：基于沙箱 WebView / iframe 的版本化 HTML App；
- **能力与工具（Tool/API）**：基于 `api.json` 声明与受限 Node vm handler 的安全执行；
- **数据权界**：`app.storage.private` 私有持久化与 `storage.read/write` 严格前缀授权；
- **提示词与智能体**：内置 `SKILL.md` 与 `subagent` 声明；
- **安全与权限**：四交集求交（平台策略 ∩ 用户授权 ∩ Agent 权限 ∩ Capabilities 词汇表）+ 出站网络域名白名单；
- **版本不可变与生命周期**：每次变更产生 SemVer 不可变快照，支持原子切换与一键回滚。

---

## 2. 规范定义（Manifest & API Spec）

### 2.1 Manifest（`daily.pkg.json v2`）

```jsonc
{
  "schema_version": 2,
  "id": "com.developer.my-tool",
  "type": "app", // app|pet-layer|api|skill|theme|toolpkg|mcp|workflow|model-pack|url-app|provider|subagent|bundle
  "version": "1.0.0",
  "entry": "index.html",
  "display_name": { "zh": "我的应用", "en": "My App" },
  "description": { "zh": "应用描述", "en": "App Description" },
  "capabilities": ["app.storage.private"],
  "network": { "domains": ["api.example.com"] },
  "dependencies": [{ "id": "com.daily.auth-api", "range": "^1.0.0" }],
  "contents": {
    "skills": ["skills/guide/SKILL.md"],
    "mcp": [],
    "tools": [],
    "tokens": {},
    "assets": []
  },
  "children": []
}
```

### 2.2 App API 规范（`api.json`）

```jsonc
{
  "schema_version": 1,
  "namespace": "mytool",
  "display_name": { "zh": "我的工具服务" },
  "network": { "domains": ["api.external.com"] },
  "secrets": ["API_KEY"],
  "endpoints": [
    {
      "name": "query_data",
      "method": "GET",
      "path": "/data",
      "description": { "zh": "查询结构化数据" },
      "params": { "type": "object", "properties": { "q": { "type": "string" } } },
      "storage": { "read": ["data/*"] },
      "handler": "handlers/query.js",
      "returns": { "type": "object" },
      "visibility": "owner"
    }
  ]
}
```

---

## 3. 统一市场（Market）交互接口

### 3.1 REST API

- `GET /webos/api/market?type=&q=`：查询市场包
- `GET /webos/api/market/:id`：获取包详情与数据权限说明
- `POST /webos/api/market/publish`：上架发布包（触发安全扫描）
- `POST /webos/api/market/:id/unpublish`：下架包
- `POST /webos/api/market/:id/install`：安装包并自动安装依赖闭包
- `GET /webos/api/market/mine`：获取当前用户已安装包

### 3.2 市场（`system.store`）自身托管机制

1. **托管形态**：`apps/system.store/index.html`，以普通 HTML App 包的形式运行在沙箱容器中，遵循版本不可变，UI 与交互完全支持 AI 和用户自由定制与回滚；
2. **权威支撑**：通过 `StoreSDK` 调用服务端 `/webos/api/market`，底层的全局审核、依赖解析、下载计数和创作者激励由平台服务端权威存储保障。
