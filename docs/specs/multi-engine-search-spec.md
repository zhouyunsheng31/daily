# Multi-Engine Web Search 改造 Spec

## 1. 目标

Phase S9 当前 `web_search` 仅绑定 Bocha（质量差），改为多引擎架构，支持 DuckDuckGo / Tavily / Bing / Bocha 4 个搜索引擎，自动 fallback。同时 GitHub 搜索改为 token 可选模式。

## 2. 引擎矩阵

| 引擎 | 类型 | 免费可用 | 需要 Key | 默认启用 | 优先级 |
|------|------|---------|----------|---------|--------|
| DuckDuckGo | 通用网页 | ✅ 免费 | ❌ 无需 | ✅ 默认启用 | 1（最高） |
| Tavily | AI 专用 | ✅ 1000次/月 | ✅ 需要 | ❌ 需配置Key | 2 |
| Bing | 通用网页 | ✅ 1000次/月 | ✅ 需要 | ❌ 需配置Key | 3 |
| Bocha | 通用网页 | ❌ 付费 | ✅ 需要 | ❌ 需配置Key | 4（兜底） |
| GitHub | 代码搜索 | ✅ 60次/时 | ❌ 可选 | ✅ 默认启用 | - |

## 3. API 设计

### 3.1 web_search 工具参数扩展

```typescript
// 现有参数保持不变
{
  query: string          // 搜索关键词
  count?: number         // 返回条数，默认 10，最大 50
  freshness?: 'day'|'week'|'month'|'year'
  summary?: boolean      // 是否返回 AI 总结（仅 Bocha/Tavily 支持）
  // 新增参数
  engine?: 'auto'|'duckduckgo'|'tavily'|'bing'|'bocha'  // 默认 'auto'
}
```

### 3.2 auto 模式 fallback 链

```
DuckDuckGo（免费，无需 Key，总是可用）
  → 失败/无结果/解析失败 → Tavily（有 Key 且未超配额）
  → 失败/无结果 → Bing（有 Key 且未超配额）
  → 失败/无结果 → Bocha（有 Key 且未超配额）
  → 全部失败 → 返回错误 "所有搜索引擎均不可用"
```

### 3.3 响应格式统一

所有引擎返回统一的 `WebSearchResult` 格式（**向后兼容**：新增字段 `engine`/`fromFallback` 为可选，旧客户端忽略即可）：

```typescript
{
  results: WebSearchHit[]   // { title, url, snippet, summary?, siteName?, siteIcon?, datePublished? }
  total: number
  engine?: string           // 新增：实际使用的引擎，如 'duckduckgo'
  fromFallback?: boolean    // 新增：是否经过 fallback（非首选引擎）
}
```

## 4. 各引擎实现方案

### 4.1 DuckDuckGo（免费，无需 Key）

- **方案**：直接 fetch `https://html.duckduckgo.com/html/?q=...`（DDG 非 JS 版本，纯 HTML）+ cheerio 解析
- **为什么不用 npm 包**：`duckduckgo-search` 等相关 npm 包质量参差不齐、维护不稳定；直接 HTTP 请求 + cheerio 解析更可控
- **端点**：`GET https://html.duckduckgo.com/html/?q={query}`
- **参数**：q（查询词）
- **解析**：cheerio 提取 `.result` 元素 → `a.result__a`（title + url）+ `a.result__snippet`（snippet）
- **限速**：内置节流器，≥1.5s 间隔（与 ArXiv 节流模式一致）
- **User-Agent**：`LivingDashboard/1.0 (web-search)`（避免被识别为爬虫）
- **反爬应对**：如果 HTML 解析失败（结构变化/验证码），返回空结果触发 fallback 到下一引擎
- **返回字段**：title, url, snippet（description）
- **不支持**：freshness, summary
- **新增依赖**：`cheerio`（HTML 解析库）

### 4.2 Tavily（免费层 1000次/月，需 Key）

- **端点**：`POST https://api.tavily.com/search`
- **认证**：Header `Authorization: Bearer {key}`
- **Body**：`{ query, search_depth: "basic"|"advanced", max_results: number }`
- **响应**：`{ results: [{ title, url, content, score, raw_content, favicon }], answer, query, response_time }`
- **免费层**：1000 次/月，1 req/s
- **字段映射**：`content` → `snippet`, `answer` → `summary`
- **支持**：summary（Tavily 的 answer 字段），但不支持 freshness

### 4.3 Bing（免费层 1000次/月，需 Key）

- **端点**：`GET https://api.bing.microsoft.com/v7.0/search`
- **认证**：`Ocp-Apim-Subscription-Key: {key}`
- **参数**：q, count, freshness, mkt
- **免费层**：1000 次/月，3 req/s
- **返回格式**：兼容 Bocha（`webPages.value` 结构），切换成本最低
- **返回字段**：name(title), url, snippet, datePublished, siteName
- **支持**：freshness（通过 freshness 参数）

### 4.4 Bocha（付费，需 Key，保留为兜底）

- 现有实现不变，作为 fallback 链最后一环

## 5. GitHub 搜索 Token 可选化

### 5.1 当前问题

`githubSearchTool.execute` 和 `callGitHub` 强制要求 Key，否则直接抛错。

### 5.2 改造方案

```typescript
// callGitHub 函数签名改为 key 可选
export async function callGitHub(params: GithubSearchParams, key?: string): Promise<GithubSearchResult>

// githubHeaders 函数：无 token 时不发送 Authorization 头
function githubHeaders(key?: string, accept = 'application/vnd.github+json'): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': accept,
    'User-Agent': 'LivingDashboard-Server',
  }
  if (key) headers['Authorization'] = `Bearer ${key}`
  return headers
}

// githubSearchTool.execute：不再强制要求 Key
// 无 Key 时也能搜索，但限速 60 req/hour，搜索 API 10 req/min
```

### 5.3 无 Token 限制

- 60 requests/hour（所有 GitHub API 合计）
- Search API: 10 requests/minute
- 适用于个人使用场景，足够

## 6. 数据库变更

### 6.1 SearchProvider 扩展

```typescript
// aiSettingsStore.ts
export type SearchProvider = 
  | 'bocha' | 'semanticScholar' | 'github'     // 现有
  | 'tavily' | 'bing'                            // 新增
```

### 6.2 新增 SETTINGS_KEYS

```typescript
SEARCH_KEY_TAVILY: 'search_key_tavily'
SEARCH_KEY_BING: 'search_key_bing'
```

### 6.3 路由白名单扩展

```typescript
// searchKeys.ts
const VALID_PROVIDERS: SearchProvider[] = [
  'bocha', 'semanticScholar', 'github', 'tavily', 'bing'
]
const PROVIDER_DISPLAY_NAMES: Record<SearchProvider, string> = {
  bocha: 'Bocha',
  semanticScholar: 'Semantic Scholar',
  github: 'GitHub',
  tavily: 'Tavily',
  bing: 'Bing',
}
```

### 6.4 Key 测试逻辑扩展

```typescript
// POST /api/search/keys/:provider/test
case 'tavily': return testTavilyKey(key)
case 'bing': return testBingKey(key)
```

## 7. 文件变更清单

| 文件 | 变更 | 说明 |
|------|------|------|
| `server/src/utils/searchApi.ts` | 新增 DuckDuckGo/Tavily/Bing 调用函数；GitHub 改 key 可选 | 核心搜索逻辑 |
| `server/src/utils/searchTools.ts` | web_search 加 engine 参数 + fallback 逻辑 | 工具定义 |
| `server/src/db/aiSettingsStore.ts` | SearchProvider 扩展 + 新增 SETTINGS_KEYS | DB 层 |
| `server/src/routes/searchKeys.ts` | 白名单 + 显示名 + 测试逻辑扩展 | API 路由 |
| `server/src/utils/aiTools.ts` | 工具元数据更新（描述文案） | 工具注册 |
| `server/package.json` | 新增 `cheerio` 依赖 | 依赖 |
| `server/test/search-web-test.ts` | 新增多引擎测试 | 测试 |
| `docs/roadmap_server_v1.md` | 新增 S9.5 多引擎改造记录 | 文档 |

## 8. 验收标准

- [ ] `web_search` 默认 engine='auto'，无任何 Key 配置时也能搜索（走 DuckDuckGo）
- [ ] DuckDuckGo 搜索返回正确结果（title, url, snippet）
- [ ] 配置 Tavily Key 后，DuckDuckGo 失败时自动 fallback 到 Tavily
- [ ] 配置 Bing Key 后，Bing 也在 fallback 链中
- [ ] `web_search` 响应包含 `engine` 和 `fromFallback` 字段
- [ ] `github_search` 无 token 时也能搜索（`search_repos` 验证）
- [ ] `github_search` 有 token 时优先使用 token
- [ ] `GET /api/search/keys` 返回 5 个 provider（含 tavily/bing）
- [ ] `POST /api/search/keys/:provider/test` 支持 tavily 和 bing
- [ ] 所有新增 Key 遵循"GET 不返回明文 Key"规则
- [ ] 不影响现有 academic_search 功能
- [ ] 所有现有测试通过（无回归）