# 搜索工具优化 Spec：Bocha → 秘塔 + 移除 S2 + GitHub Token 可选

> **生成日期**：2026-06-29
> **状态**：Spec v2（已纳入秘塔 API 实测结果 + 对抗审查通过，可进入实施阶段）
> **依赖**：Phase S9（4 个搜索工具基础架构）、Phase S10（GitHub 中转下载 + ArXiv 最新论文 + 大文件代理）
> **预估**：2-3 天
> **作者**：基于用户决策 + 代码现状调研 + 秘塔 API 实测（2026-06-29）
> **引用**：
> - [ai-search-spec.md](ai-search-spec.md)（S9 spec，搜索引擎设计基础）
> - [phase-s10-spec.md](phase-s10-spec.md)（S10 spec，ArXiv 集成 + GitHub 代理）
> - [search-tools-audit-report.md](search-tools-audit-report.md)（搜索工具现状评估）
> - [multi-engine-search-spec.md](multi-engine-search-spec.md)（**已废弃**，本 spec 取代之）

---

## 一、背景与目标

### 1.1 问题

Phase S9 已完成 4 个 AI 搜索工具（local_search / web_search / academic_search / github_search），Phase S10 已追加 GitHub 整仓 zip 下载 + ArXiv 最新论文 + 大文件代理。但根据 [search-tools-audit-report.md](search-tools-audit-report.md) 实测，存在 3 个核心问题：

| # | 工具 | 问题 | 影响 |
|---|------|------|------|
| 1 | `github_search` | 强制要求 token，用户 token 已过期被撤销 | 工具完全不可用（401 Bad credentials） |
| 2 | `academic_search` | 同时调 Semantic Scholar (S2) + ArXiv，S2 索引慢、新论文覆盖差 | PhoneBuddy 论文 6/22 已发布在 ArXiv，S2 返回 0 篇 |
| 3 | `web_search` | 用 Bocha 搜索，中文/技术内容覆盖差 | 搜 "PhoneBuddy" 返回大量不相关结果，连腾讯混元这么热门的内容都搜不到 |

### 1.2 目标

3 个改造任务（按工具分组）：

| 工具 | 改造任务 | 用户决策 |
|------|---------|---------|
| `github_search` | token 改可选，无 token 也能用 | 60 req/hour 降级使用；代码搜索端点强制要 token，无 token 时报错提示；解析限额头友好提示 |
| `academic_search` | 完全移除 S2，只保留 ArXiv | academic_search 只保留 ArXiv 一条路径；移除 S2 相关代码/Key/路由 |
| `web_search` | 替换 Bocha 为秘塔（Metaso） | 用户已提供 Key `mk-6DABBFFA59192A50AFB26B100634A4BB`；端点 `POST https://metaso.cn/api/v1/search` |

### 1.3 非目标

- **不**做 DuckDuckGo / Tavily / Bing 多引擎 fallback 链（[multi-engine-search-spec.md](multi-engine-search-spec.md) 中方案已废弃，秘塔单引擎即可）
- **不**做 ArXiv RSS feed 集成（API query 已足够，RSS 无法按关键词过滤）
- **不**做 Unpaywall 集成（ArXiv 全开放，无需 Unpaywall 兜底）
- **不**做 GitHub App installation token 升级（仍用 PAT，但 PAT 改可选）
- **不**改 `local_search`（本地搜索与本次改造无关）
- **不**改 Phase S10 已完成的 `/api/github/proxy` 代理端点（与本次 token 可选改造无耦合）
- **不**改 Phase S10 已完成的 `download_repo_zip` mode
- **不**做 secret rotation / 自动 token 刷新机制（手动配置即可）

### 1.4 现状代码梳理（关键发现）

> **重要**：本 spec 不是从零设计，而是基于已有代码的增量改造。代码现状已部分完成 3 项改造中的部分内容，spec 必须如实标注"已完成"与"待完成"。

| 改造项 | 代码现状 | 状态 |
|--------|---------|------|
| **web_search 秘塔迁移** | `callMetaso` 已实现（searchApi.ts L231-283）但**实测发现 3 个 bug**：① L265 `data?.results ?? []` 应为 `data?.webpages ?? []`（秘塔返回 `webpages`，无 `results`）；② L268 `item.url` 应为 `item.link`（秘塔每条结果是 `link`，无 `url`）；③ L273-280 `data.answer` 前置逻辑应移除（秘塔无 `answer` 字段）；`webSearchTool` 已使用 `callMetaso` + `getSearchKey('metaso')`（searchTools.ts L26-59）；`SETTINGS_KEYS.SEARCH_KEY_METASO = 'search_key_metaso'` 已存在（aiSettingsStore.ts L16）；`SearchProvider` 已含 `'metaso'`；searchKeys.ts 已含 `testMetasoKey`；aiTools.ts 描述已提及"秘塔 AI 搜索" | ⚠️ **代码层 70% 已完成**（骨架已就位，callMetaso 字段映射 3 个 bug 待实施时修复，详见 2.7 节） |
| **academic_search 移除 S2** | `callSemanticScholar` 仍存在（searchApi.ts L323-404）；`callArxiv` 已实现（searchApi.ts L951-976）；`callAcademicSearch` 分发器仍按 `mode` 路由 S2/ArXiv（searchApi.ts L986-1001）；`academicSearchTool` 仍有 `mode` 参数（searchTools.ts L78-84）；`SETTINGS_KEYS.SEARCH_KEY_SEMANTIC_SCHOLAR` 仍存在；searchKeys.ts 仍含 `testSemanticScholarKey` | ❌ **未完成**，需移除 S2 整条路径 |
| **github_search token 可选** | `callGitHub(params, key?: string)` 已支持可选 key（searchApi.ts L481）；`githubHeaders(key?: string)` 无 token 时不发 Authorization 头（searchApi.ts L450-459）；`githubSearchTool.execute` 用 `(await getSearchKey('github')) ?? undefined`（searchTools.ts L152） | ✅ **token 可选已完成** |
| **github_search search_code 特殊处理** | 无 token 时直接调 `/search/code` 会收到 401，但当前代码无特殊捕获与友好提示 | ❌ **未完成**，需新增 |
| **github_search 限额友好提示** | 当前 `fetchWithRetry` 仅识别 429，不解析 `X-RateLimit-Remaining` / `X-RateLimit-Reset` / `Retry-After` 头做友好提示 | ❌ **未完成**，需新增 |
| **github_search 启动日志** | 无 token 模式 / token 模式启动时无明确日志 | ❌ **未完成**，需新增 |

### 1.5 与既有 spec 的关系

- 本 spec 取代 [multi-engine-search-spec.md](multi-engine-search-spec.md)（多引擎 fallback 方案废弃，改为秘塔单引擎）
- 本 spec 是 [ai-search-spec.md](ai-search-spec.md) 第四章（web_search）、第五章（academic_search）、第六章（github_search）的增量改造，不重写原文
- 本 spec 是 [phase-s10-spec.md](phase-s10-spec.md) 第四章（ArXiv 集成）的延伸——S10 已为 ArXiv 铺好路（callArxiv + 节流器 + XML 解析），本 spec 仅移除 S2 旁路

---

## 二、web_search 改造：Bocha → 秘塔（Metaso）

### 2.1 现状评估

**代码层 90% 已完成**，需对照用户调研结果验证 API 契约 + 完成数据迁移清理 + 实测字段映射。

| 文件 | 现状 | 待完成 |
|------|------|--------|
| `server/src/utils/searchApi.ts` | `callMetaso` 已实现（L231-283），请求体含 `q`/`scope`/`includeSummary`/`size`/`includeRawContent`/`conciseSnippet` | 实测响应字段，确认 `webpages` vs `results` 字段名差异 |
| `server/src/utils/searchTools.ts` | `webSearchTool` 已用 `callMetaso` + `getSearchKey('metaso')`（L26-59） | 无 |
| `server/src/db/aiSettingsStore.ts` | `SEARCH_KEY_METASO = 'search_key_metaso'` 已存在（L16）；`SearchProvider` 已含 `'metaso'`（L156）；`SEARCH_KEY_MAP.metaso` 已存在（L159） | 无 |
| `server/src/routes/searchKeys.ts` | `VALID_PROVIDERS` 含 `'metaso'`（L24）；`PROVIDER_DISPLAY_NAMES.metaso = '秘塔搜索'`（L28）；`testMetasoKey` 已实现（L189-218） | 无 |
| `server/src/utils/aiTools.ts` | `web_search` description 已含"秘塔 AI 搜索，metaso.cn"（L58） | 无 |
| 数据库 `ai_settings` 表 | 生产 DB 可能仍残留旧 `searchKey.bocha` 行 | 需清理（见 2.5） |

### 2.2 秘塔 API 契约（**实测确认**，2026-06-29）

**端点**：`POST https://metaso.cn/api/v1/search`

**请求头**：
```
Authorization: Bearer mk-xxx
Accept: application/json
Content-Type: application/json
```

**请求体**（当前 `callMetaso` 实现已采用）：

| 字段 | 类型 | 必填 | 当前实现 | 说明 |
|------|------|------|---------|------|
| `q` | string | 是 | ✅ `params.query` | 搜索词 |
| `scope` | string | 否 | ✅ `'webpage'` | 范围：webpage/document/paper/image/video/podcast |
| `size` | string | 否 | ✅ `String(Math.min(params.count ?? 10, 20))` | 返回条数，默认 10 |
| `includeSummary` | boolean | 否 | ✅ `true` | 网页摘要提升召回（实测：true 时首条结果通常返回 AI 生成的 `summary`，其余仍是 `snippet`） |
| `includeRawContent` | boolean | 否 | ✅ `false` | 抓取原文 |
| `conciseSnippet` | boolean | 否 | ✅ `true` | 精简片段 |

**响应字段映射**（**实测确认**，详见 2.7 节实测结果）：

| 秘塔实际返回字段 | 当前实现解析字段 | 统一 `WebSearchHit` 字段 | 状态 |
|------------|----------------|----------------------|------|
| `webpages[]` | `results[]` | `results` | ❌ **字段名不一致，实测确认秘塔返回 `webpages`**，需修 L265 |
| `webpages[].title` | `results[].title` | `title` | ✅ 一致 |
| `webpages[].link` | `results[].url` | `url` | ❌ **字段名不一致（link vs url），实测确认秘塔返回 `link`**，需修 L268 |
| `webpages[].snippet` | `results[].snippet` | `snippet` | ✅ 一致（普通结果用 snippet） |
| `webpages[].summary` | 未解析 | `summary` | ❌ **实测确认秘塔部分结果返回 AI 生成的 `summary`**（与 `snippet` 互斥，`includeSummary:true` 时首条通常用 `summary`），需新增解析 |
| `webpages[].position` | 未解析 | — | ⚠️ 未使用（可选） |
| `webpages[].date` | 未解析 | `datePublished?` | ⚠️ **实测确认返回中文格式 `"2025年05月16日"`**，需正则 `/(\d{4})年(\d{2})月(\d{2})日/` 解析为 ISO `YYYY-MM-DD`，可选补充 |
| `webpages[].authors` | 未解析 | — | ⚠️ 实测确认部分结果有（如 Google），可选补充 |
| `webpages[].score` | 未解析 | — | ⚠️ 实测确认是字符串 `"high"`/`"medium"`/`"low"`，未使用 |
| —（**无 `answer` 字段**） | `data.answer` | `summary`（前置首条） | ❌ **实测确认秘塔无 `answer` 字段**，当前 L273-280 前置逻辑恒不触发，需移除 |
| `credits`（顶层） | 未解析 | — | ⚠️ 实测新增字段，疑似剩余配额或本次消耗量（本次 size=3 与 credits=3 吻合，待二次调用确认语义），需记录到 apiUsageLog（见 2.4 节） |
| `searchParameters.format`（顶层） | 未解析 | — | ⚠️ 实测新增字段，默认 `"chat_completions"`（请求体未传但响应回填），无需处理 |
| `total`（顶层） | `results.length` | `total` | ⚠️ 实测确认秘塔返回 `total`（如 51），当前实现用 `results.length` 不准，应改用 `data.total` |

**实测结论**：详见 2.7 节"秘塔 API 实测确认结果"，含完整响应 JSON 结构和 10 项关键发现。

### 2.3 字段映射（统一 results 格式）

`callMetaso` 必须输出统一的 `WebSearchResult` 格式（基于 2.7 节实测确认）：

```typescript
export interface WebSearchHit {
  title: string
  url: string
  snippet: string
  summary?: string         // 实测：秘塔部分结果返回 AI 生成 summary（与 snippet 互斥）
  datePublished?: string   // 实测：秘塔返回中文格式 "2025年05月16日"，解析为 ISO YYYY-MM-DD
}

export interface WebSearchResult {
  results: WebSearchHit[]
  total: number            // 实测：用 data.total（如 51），不用 results.length
}
```

**`callMetaso` 改造后字段映射实现**（修复 3 个 bug + 新增 summary/date/total 解析）：

```typescript
// 改造后 callMetaso 解析逻辑（替换 L264-282）
const rawWebpages = data?.webpages ?? []   // 修复 bug 1：results → webpages
const results: WebSearchHit[] = rawWebpages.map((item: any) => {
  const hit: WebSearchHit = {
    title: item.title ?? '',
    url: item.link ?? '',                  // 修复 bug 2：url → link
    snippet: item.snippet ?? item.summary ?? '',  // summary 兜底 snippet（实测 summary/snippet 互斥）
  }
  // 新增：summary 字段（实测：includeSummary:true 时部分结果有 AI 生成 summary）
  if (item.summary) hit.summary = item.summary
  // 新增：datePublished 字段（实测：中文格式 "2025年05月16日" → ISO "2025-05-16"）
  if (item.date) {
    const m = String(item.date).match(/(\d{4})年(\d{2})月(\d{2})日/)
    if (m) hit.datePublished = `${m[1]}-${m[2]}-${m[3]}`
  }
  return hit
})

// 修复 bug 3：移除 data.answer 前置逻辑（实测秘塔无 answer 字段）
// AI 总结通过首条结果的 summary 字段体现（includeSummary:true 时首条通常含 summary）

return { results, total: typeof data?.total === 'number' ? data.total : results.length }
```

**关键改造点**：
- ① L265 `data?.results ?? []` → `data?.webpages ?? []`
- ② L268 `item.url` → `item.link`
- ③ L273-280 `data?.answer` 前置逻辑整段移除（秘塔无 `answer` 字段）
- ④ L282 `total: results.length` → `total: data.total`（实测秘塔返回 `total` 顶层字段）
- ⑤ 新增 `summary` 字段解析（与 `snippet` 互斥，优先用 `summary` 兜底 `snippet`）
- ⑥ 新增 `datePublished` 字段解析（中文格式正则解析为 ISO）

**注意**：秘塔的 AI 总结机制与 Bocha/Tavily 不同——秘塔无顶层 `answer` 字段，AI 总结通过 `includeSummary:true` 时部分结果（通常首条）返回 `summary` 字段体现。客户端展示时若 `results[0].summary` 存在，可视为 AI 总结。

### 2.4 错误处理

| 错误场景 | 检测 | 返回 |
|---------|------|------|
| Key 缺失 | `getSearchKey('metaso')` 返回 null | `throw new Error('未配置秘塔搜索 API Key，请在设置中填写（metaso.cn 获取）')`（当前实现已采用） |
| Key 无效（401/403） | HTTP 4xx | `fetchWithRetry` 抛 `HttpError`，最终消息 `Metaso API 返回错误 {status}: {body}` |
| 配额超限（429） | HTTP 429 | `fetchWithRetry` 自动重试（指数退避），最终消息 `Metaso API 返回 429：请求过于频繁...` |
| 网络错误 | fetch 抛异常 | `fetchWithRetry` 重试 3 次，最终消息 `网络错误：{detail}` |
| 响应解析失败 | JSON.parse 抛异常 | 抛 `Metaso API 响应解析失败：{detail}` |
| 余额不足 | HTTP 4xx + body 含"余额"字样 | 透传错误消息（用户可读） |
| **配额监控（新增）** | 响应 body 含 `credits` 字段（实测确认） | 记录到 `api_usage_log` 表的 `credits_consumed` 列（详见 2.7.3 节） |

**配额监控说明**：实测发现秘塔响应**无 `X-RateLimit-*` / `Retry-After` 响应头**，限流信息只能从 body 的 `credits` 字段推断。`credits` 字段语义待二次调用确认（疑似剩余配额或本次消耗量，本次 size=3 与 credits=3 吻合）。无论语义如何，记录到 `api_usage_log` 表用于配额监控都是合理的——若 `credits` 持续递减可推断为剩余配额，若 `credits` 始终等于 `size` 可推断为本次消耗量。

### 2.5 数据迁移：旧 Bocha Key 清理

**现状**：当前代码已无 `SEARCH_KEY_BOCHA` 常量、无 `callBocha` 函数、无 `'bocha'` provider。但生产数据库 `ai_settings` 表可能仍残留以下历史行：

| 历史 key 字段值 | 处理 |
|---------------|------|
| `searchKey.bocha`（S9 spec 原始命名） | DELETE |
| `search_key_bocha`（如有此命名变体） | DELETE |

**迁移脚本**（实施时执行一次）：

```sql
-- 删除历史 Bocha Key 残留
DELETE FROM ai_settings WHERE key IN ('searchKey.bocha', 'search_key_bocha');
```

**验证查询**：

```sql
-- 应返回 0 行
SELECT key FROM ai_settings WHERE key LIKE '%bocha%';
```

**无需迁移项**：

- `searchKey.github` / `searchKey.semanticScholar` 历史行**保留不动**（semanticScholar 在第三章清理，github 在第四章改可选）
- `search_key_metaso` 已是新 Key 名，无需变更

### 2.6 web_search 改造任务清单

| # | 任务 | 状态 | 验收 |
|---|------|------|------|
| 2.6.1 | 实测秘塔 API 真实响应结构 | ✅ **已完成**（2026-06-29 实测，详见 2.7 节） | 实测响应字段已记录：`webpages[]` / `link` / `summary`(与 snippet 互斥) / `score`(字符串) / `date`(中文格式) / `credits` / `total` |
| 2.6.2 | 修复 `callMetaso` 字段映射 3 个 bug + 新增 summary/date/total 解析 | 待完成（实施时修复，方案见 2.3 节） | `callMetaso` 能正确解析真实响应，`results.length > 0`，每条含 `title`/`url`/`snippet` |
| 2.6.3 | 数据库清理旧 `searchKey.bocha` 残留行 | 待完成 | `SELECT key FROM ai_settings WHERE key LIKE '%bocha%'` 返回 0 行 |
| 2.6.4 | 配置生产环境秘塔 Key | 待完成 | `PUT /api/search/keys/metaso` body `{"key":"mk-6DABBFFA59192A50AFB26B100634A4BB"}` |
| 2.6.5 | 真实 Key 端到端验证 | 待完成 | 搜 "PhoneBuddy" 能搜到腾讯混元相关结果 |
| 2.6.6 | **新增** `api_usage_log` 表新增 `credits_consumed` 列 + 修改 `logApiUsage` 函数 + `callMetaso` 内记录 `credits` | 待完成（方案见 2.7.3 节） | 秘塔调用后 `api_usage_log` 表 `credits_consumed` 列有值 |

### 2.7 秘塔 API 实测确认结果（2026-06-29）

#### 2.7.1 实测调用详情

- **端点**：`POST https://metaso.cn/api/v1/search`
- **Key**：`mk-6DABBFFA59192A50AFB26B100634A4BB`
- **查询词**：`transformer 模型`
- **size**：`3`
- **HTTP 状态**：200（成功）

#### 2.7.2 实际返回 JSON 结构（已确认）

```json
{
  "credits": 3,
  "searchParameters": {
    "q": "transformer 模型",
    "scope": "webpage",
    "size": 3,
    "searchFile": false,
    "includeSummary": true,
    "conciseSnippet": true,
    "format": "chat_completions"
  },
  "webpages": [
    {
      "title": "...",
      "link": "https://...",
      "score": "high",
      "summary": "...",
      "snippet": "...",
      "position": 1,
      "date": "2025年05月16日",
      "authors": ["Google"]
    }
  ],
  "total": 51
}
```

#### 2.7.3 关键实测发现（10 项）

| # | 发现 | 影响 |
|---|------|------|
| 1 | 顶层是 `webpages`（不是 `results`） | 现有代码 L265 `data?.results ?? []` 恒返回空数组，**bug** |
| 2 | 单条结果是 `link`（不是 `url`） | 现有代码 L268 `item.url` 恒为 undefined，**bug** |
| 3 | `score` 是字符串 `"high"`/`"medium"`/`"low"`（不是数字） | 当前未解析，无 bug，可选补充 |
| 4 | `date` 是中文格式 `"2025年05月16日"`（非 ISO 8601） | 需正则 `/(\d{4})年(\d{2})月(\d{2})日/` 解析为 ISO `YYYY-MM-DD` |
| 5 | `summary` 与 `snippet` 互斥：`includeSummary:true` 时部分结果（通常首条）返回 AI 生成的 `summary`，其余仍是 `snippet` | 需新增 `summary` 字段解析，优先用 `summary` 兜底 `snippet` |
| 6 | **没有 `answer` 字段** | 现有代码 L273-280 `data.answer` 前置逻辑恒不触发，**bug**，应移除 |
| 7 | **没有 `results` 字段** | 同发现 1，`data?.results ?? []` 恒返回空数组 |
| 8 | **没有限流响应头**（无 `X-RateLimit-*`、无 `Retry-After`） | 限流信息只能从 body 的 `credits` 字段推断 |
| 9 | 顶层新增 `credits` 字段（疑似剩余配额或本次消耗量，本次 size=3 与 credits=3 吻合，待二次调用确认语义） | 需记录到 `api_usage_log` 表用于配额监控 |
| 10 | 顶层新增 `searchParameters.format` 默认 `"chat_completions"`（请求体未传但响应回填） | 无需处理，仅记录 |

#### 2.7.4 现有 `callMetaso` 实现的 3 个 bug（实施时必须修复）

| Bug # | 位置 | 现状代码 | 修复后 | 理由 |
|-------|------|---------|--------|------|
| 1 | searchApi.ts L265 | `data?.results ?? []` | `data?.webpages ?? []` | 秘塔返回 `webpages`，无 `results` |
| 2 | searchApi.ts L268 | `item.url` | `item.link` | 秘塔每条结果是 `link`，无 `url` |
| 3 | searchApi.ts L273-280 | `if (data?.answer) { results.unshift(...) }` | 整段移除 | 秘塔无 `answer` 字段，前置逻辑恒不触发 |

**额外修复**（非 bug，但实测后需调整）：
- L282 `total: results.length` → `total: typeof data?.total === 'number' ? data.total : results.length`（实测秘塔返回 `total` 顶层字段，如 51）

#### 2.7.5 `credits` 字段记录到 `api_usage_log` 方案（配额监控）

**背景**：实测发现秘塔响应无 `X-RateLimit-*` 响应头，限流信息只能从 body 的 `credits` 字段推断。为支持配额监控，需将 `credits` 记录到 `api_usage_log` 表。

**数据库迁移**（幂等，可重复执行）：

```sql
-- api_usage_log 表新增 credits_consumed 列（NULLABLE，向后兼容）
ALTER TABLE api_usage_log ADD COLUMN IF NOT EXISTS credits_consumed INTEGER;
```

**`ApiUsageLogEntry` 接口扩展**（apiUsageLog.ts L8-15）：

```typescript
export interface ApiUsageLogEntry {
  provider: string
  endpoint: string
  count?: number
  latencyMs?: number
  status: 'ok' | 'error'
  errorMsg?: string
  creditsConsumed?: number  // 新增：秘塔 credits 字段（其他 provider 不传）
}
```

**`logApiUsage` 函数改造**（apiUsageLog.ts L18-31）：

```typescript
export async function logApiUsage(entry: ApiUsageLogEntry): Promise<void> {
  try {
    const pool = getPool()
    const now = Date.now()
    await pool.query(
      `INSERT INTO api_usage_log (provider, endpoint, count, latency_ms, status, error_msg, credits_consumed, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entry.provider, entry.endpoint, entry.count ?? 1, entry.latencyMs ?? null, entry.status, entry.errorMsg ?? null, entry.creditsConsumed ?? null, now]
    )
  } catch (err) {
    console.warn('[ApiUsageLog] Failed to log API usage:', err instanceof Error ? err.message : String(err))
  }
}
```

**`callMetaso` 内记录 `credits`**（searchApi.ts，改造后 `callMetaso` 末尾返回前）：

```typescript
// 改造后 callMetaso 末尾（return 前）
const creditsConsumed = typeof data?.credits === 'number' ? data.credits : undefined
return { results, total: ..., _credits: creditsConsumed }  // 通过内部字段传递
```

**`webSearchTool.execute` 内传递 `credits` 到 `logApiUsage`**（searchTools.ts L40-45）：

```typescript
const result = await callMetaso(params as WebSearchParams, key)
await logApiUsage({
  provider: 'metaso',
  endpoint: 'web-search',
  latencyMs: Date.now() - start,
  status: 'ok',
  creditsConsumed: (result as any)._credits,  // 秘塔 credits 字段
})
// 注意：返回给客户端前移除 _credits 内部字段
const { _credits, ...clientResult } = result as any
return { content: [{ type: 'text', text: JSON.stringify(clientResult) }], details: {} }
```

**配额监控查询示例**（运维用）：

```sql
-- 查询秘塔最近 24 小时 credits 消耗
SELECT SUM(credits_consumed) AS total_credits, COUNT(*) AS call_count
FROM api_usage_log
WHERE provider = 'metaso' AND created_at >= EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours') * 1000;
```

**`credits` 字段语义待二次调用确认**：
- 若 `credits` 持续递减 → 剩余配额
- 若 `credits` 始终等于 `size` → 本次消耗量
- 无论语义如何，记录到 `api_usage_log` 都是合理的（监控配额趋势）

---

## 三、academic_search 改造：移除 S2，只保留 ArXiv

### 3.1 改造范围

**目标**：完全移除 Semantic Scholar (S2) 路径，academic_search 只保留 ArXiv 一条搜索源。

**移除清单**：

| 移除项 | 文件 | 行号（参考） |
|--------|------|------------|
| `callSemanticScholar` 函数 | `server/src/utils/searchApi.ts` | L323-404 |
| `SETTINGS_KEYS.SEARCH_KEY_SEMANTIC_SCHOLAR` 常量 | `server/src/db/aiSettingsStore.ts` | L17 |
| `SearchProvider` 类型中的 `'semanticScholar'` | `server/src/db/aiSettingsStore.ts` | L156 |
| `SEARCH_KEY_MAP.semanticScholar` 映射 | `server/src/db/aiSettingsStore.ts` | L160 |
| `VALID_PROVIDERS` 中的 `'semanticScholar'` | `server/src/routes/searchKeys.ts` | L24 |
| `PROVIDER_DISPLAY_NAMES.semanticScholar` | `server/src/routes/searchKeys.ts` | L29 |
| `testSemanticScholarKey` 函数 | `server/src/routes/searchKeys.ts` | L221-252 |
| `getTestEndpoint` 的 `semanticScholar` 分支 | `server/src/routes/searchKeys.ts` | L175 |
| `testSearchKey` 的 `semanticScholar` 分支 | `server/src/routes/searchKeys.ts` | L183 |
| `callAcademicSearch` 分发函数 | `server/src/utils/searchApi.ts` | L986-1001（整函数移除） |
| `academicSearchTool.parameters.mode` 参数 | `server/src/utils/searchTools.ts` | L78-84 |
| `academicSearchTool.execute` 中的 mode 分支逻辑 | `server/src/utils/searchTools.ts` | L88-92 |
| `import { callSemanticScholar, callAcademicSearch }` | `server/src/utils/searchTools.ts` | L12-13（仅保留 `callArxiv`） |
| `aiTools.ts` 中 academic_search description "Semantic Scholar 相关性" | `server/src/utils/aiTools.ts` | L59 |
| 数据库 `ai_settings` 表残留 `searchKey.semanticScholar` 行 | DB | DELETE |

### 3.2 ArXiv 客户端实现（**已存在，保留不动**）

`callArxiv` 函数已在 Phase S10 实现（searchApi.ts L951-976），本 spec 不重写。核心能力：

- 端点：`https://export.arxiv.org/api/query`（HTTPS）
- 节流：`arxivThrottledFetch` ≥3s 间隔，并发安全（预留时间槽模式）
- XML 解析：`fast-xml-parser` + `parseArxivAtomXml`
- 默认 `sortBy=submittedDate` + `sortOrder=descending`

### 3.3 XML 解析（**已存在，保留不动**）

`parseArxivAtomXml` 函数已在 Phase S10 实现（searchApi.ts L884-937），配置 `removeNSPrefix: true`（实际代码用 `attributeNamePrefix: '@_'` + `ignoreAttributes: false`，效果等同）。

**entry → AcademicPaper 字段映射**（当前实现，保留）：

> **注意**：当前 `parseArxivAtomXml` 实现已**不设置** `tldr`/`openAccessPdf.license`/`externalIds.DOI`（这三个字段只有 S2 路径会设置）。本 spec 3.5 节"改造前"代码示例展示的是 `AcademicPaper` 接口定义（含此三字段），ArXiv 路径返回的 paper 本就不含此三字段。

| ArXiv Atom 字段 | AcademicPaper 字段 | 说明 |
|----------------|-------------------|------|
| `id`（URL 形式 `http://arxiv.org/abs/2401.12345v1`） | `paperId`（提取 `2401.12345`） | `extractArxivId` 函数 |
| `title` | `title`（空白字符合并） | `.replace(/\s+/g, ' ').trim()` |
| `summary` | `abstract`（空白字符合并） | 同上 |
| `author[].name` | `authors` | 兼容单个 author 对象 |
| `published`（ISO 8601） | `publicationDate`（取 `T` 前日期） | `published.split('T')[0]` |
| `published` 年份 | `year` | `parseInt(publicationDate.split('-')[0], 10)` |
| `link[rel=related][type=application/pdf]` | `openAccessPdf.url`（不含 license） | 兜底 `https://arxiv.org/pdf/{id}.pdf` |
| `category[].term` | **未映射** | ⚠️ 见 3.5 节新增 `categories` 字段 |
| `arxiv:primary_category` | **未映射** | ⚠️ 见 3.5 节新增 `primaryCategory` 字段 |
| `id`（URL） | **未映射** | ⚠️ 见 3.5 节新增 `absUrl` 字段 |
| —（无 venue 字段） | `venue`（固定 `'ArXiv'`） | ArXiv 无 venue 概念 |
| —（无 citationCount） | `citationCount`（固定 `0`） | ArXiv 不提供引用数 |
| —（无 tldr） | `tldr`（**接口定义含但 ArXiv 路径不设**） | S2 路径会设置，ArXiv 路径不设；3.5 节从接口定义移除 |
| —（无 license） | `openAccessPdf.license`（**接口定义含但 ArXiv 路径不设**） | 同上 |
| —（无 DOI） | `externalIds.DOI`（**接口定义含但 ArXiv 路径不设**） | 同上 |

### 3.4 限流（**已存在，保留不动**）

`arxivThrottledFetch` 已实现 ≥3s 间隔的"预留时间槽"模式（searchApi.ts L845-868）。本 spec 不修改。

### 3.5 字段映射与 AcademicPaper 接口调整

**移除 S2 后，`AcademicPaper` 接口需要精简**——移除 S2 特有字段，新增 ArXiv 特有字段：

```typescript
// 改造前（S9 + S10 混合，含 S2 字段）
export interface AcademicPaper {
  paperId: string
  title: string
  abstract: string
  authors: string[]
  year: number
  venue: string                    // S2 字段，ArXiv 固定 'ArXiv'，无意义 → 保留但固定
  citationCount: number            // S2 字段，ArXiv 不提供，固定 0 → 保留但固定
  openAccessPdf?: { url: string; status: string; license?: string }
  externalIds?: { ArXiv?: string; DOI?: string }  // S2 字段，ArXiv 只有 ArXiv id → 简化
  tldr?: { text: string }          // S2 字段，ArXiv 无 → 移除
  publicationDate?: string
}

// 改造后（ArXiv only，简化）
export interface AcademicPaper {
  paperId: string                  // = arxivId，保留以兼容客户端
  title: string
  abstract: string
  authors: string[]
  year: number
  venue: string                    // 固定 'ArXiv'，保留以兼容客户端
  citationCount: number            // 固定 0，保留以兼容客户端
  openAccessPdf?: { url: string; status: string }  // status 固定 'GREEN'
  externalIds?: { ArXiv?: string }  // 仅保留 ArXiv，移除 DOI
  publicationDate?: string         // ISO YYYY-MM-DD
  // 新增 ArXiv 特有字段
  absUrl?: string                  // ArXiv abs 页面 URL，如 https://arxiv.org/abs/2606.23049
  categories?: string[]            // ArXiv 分类列表，如 ['cs.AI', 'cs.CL']
  primaryCategory?: string         // ArXiv 主分类，如 'cs.AI'
  // 移除字段
  // tldr?: { text: string }       // S2 特有，移除
}
```

**字段保留决策**：

| 字段 | 决策 | 理由 |
|------|------|------|
| `paperId` | 保留（=arxivId） | 客户端可能引用，避免破坏性变更 |
| `venue` | 保留（固定 `'ArXiv'`） | 客户端可能展示，避免破坏性变更 |
| `citationCount` | 保留（固定 `0`） | 客户端可能展示，避免破坏性变更 |
| `openAccessPdf.status` | 保留（固定 `'GREEN'`） | 客户端可能展示 OA 状态 |
| `openAccessPdf.license` | 移除 | S2 特有概念，ArXiv 全 CC-BY，无意义 |
| `externalIds.DOI` | 移除 | ArXiv 不返回 DOI |
| `tldr` | 移除 | S2 特有功能 |
| `absUrl` | 新增 | ArXiv abs 页面 URL（区别于 pdfUrl），方便用户点击查看详情 |
| `categories` | 新增 | ArXiv 分类列表，便于客户端筛选/展示 |
| `primaryCategory` | 新增 | ArXiv 主分类，便于客户端归类 |

**`parseArxivAtomXml` 改造**：

```typescript
// 新增 categories / primaryCategory / absUrl 解析
const paper: AcademicPaper = {
  paperId: arxivId,
  title: (entry.title ?? '').replace(/\s+/g, ' ').trim(),
  abstract: (entry.summary ?? '').replace(/\s+/g, ' ').trim(),
  authors,
  year,
  venue: 'ArXiv',
  citationCount: 0,
  publicationDate,
}

// 新增 absUrl（id 字段就是 abs URL）
if (id) paper.absUrl = id

// 新增 categories（entry.category 可能是数组或单个对象）
const categoryArr = Array.isArray(entry.category) ? entry.category : (entry.category ? [entry.category] : [])
paper.categories = categoryArr.map((c: any) => c?.['@_term'] ?? '').filter(Boolean)

// 新增 primaryCategory（arxiv:primary_category 带前缀）
const primaryCat = entry['arxiv:primary_category']?.['@_term']
if (primaryCat) paper.primaryCategory = primaryCat

if (pdfUrl) {
  paper.openAccessPdf = { url: pdfUrl, status: 'GREEN' }  // 移除 license 字段
}
if (arxivId) {
  paper.externalIds = { ArXiv: arxivId }  // 移除 DOI 字段
}
// 移除 tldr 字段设置
```

### 3.6 ai_settings 表 Key 名变更

**移除**：

```typescript
// aiSettingsStore.ts 改造前
export const SETTINGS_KEYS = {
  // ...
  SEARCH_KEY_METASO: 'search_key_metaso',
  SEARCH_KEY_SEMANTIC_SCHOLAR: 'searchKey.semanticScholar',  // ← 移除此行
  SEARCH_KEY_GITHUB: 'searchKey.github',
} as const

export type SearchProvider = 'metaso' | 'semanticScholar' | 'github'
//                                      ^^^^^^^^^^^^^^^^ 移除

const SEARCH_KEY_MAP: Record<SearchProvider, string> = {
  metaso: SETTINGS_KEYS.SEARCH_KEY_METASO,
  semanticScholar: SETTINGS_KEYS.SEARCH_KEY_SEMANTIC_SCHOLAR,  // ← 移除此行
  github: SETTINGS_KEYS.SEARCH_KEY_GITHUB,
}
```

**改造后**：

```typescript
export const SETTINGS_KEYS = {
  // ...
  SEARCH_KEY_METASO: 'search_key_metaso',
  SEARCH_KEY_GITHUB: 'searchKey.github',
  // 移除 SEARCH_KEY_SEMANTIC_SCHOLAR
} as const

export type SearchProvider = 'metaso' | 'github'  // 移除 'semanticScholar'

const SEARCH_KEY_MAP: Record<SearchProvider, string> = {
  metaso: SETTINGS_KEYS.SEARCH_KEY_METASO,
  github: SETTINGS_KEYS.SEARCH_KEY_GITHUB,
  // 移除 semanticScholar
}
```

**ArXiv 无需 Key**：ArXiv API 公开免费，无需认证，所以 `SearchProvider` 不含 `'arxiv'`，`SEARCH_KEY_MAP` 不含 `arxiv` 项。

**数据库清理**：

```sql
-- 删除历史 S2 Key 残留
DELETE FROM ai_settings WHERE key = 'searchKey.semanticScholar';
```

### 3.7 academic_search 工具参数变化

**移除参数**：

| 参数 | 移除理由 |
|------|---------|
| `mode?: 'relevance' \| 'latest'` | S2 移除后无 relevance 路径，mode 失去意义 |
| `openAccessOnly?: boolean` | ArXiv 全开放获取，此参数恒为 true，无意义 |
| `year?: string` | S2 特有过滤，ArXiv 不支持按年份范围过滤（仅能按 submittedDate 排序） |
| `fieldsOfStudy?: string` | S2 特有过滤，ArXiv 用 `category` 替代 |

**新增参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `category?: string` | string | ArXiv 分类过滤，如 `cs.AI`；构造 `search_query` 时追加 `AND cat:{category}` |
| `sortBy?: 'relevance' \| 'lastUpdatedDate' \| 'submittedDate'` | string | 排序方式，默认 `submittedDate`（最新优先） |
| `sortOrder?: 'ascending' \| 'descending'` | string | 排序方向，默认 `descending` |

**保留参数**：

| 参数 | 保留理由 |
|------|---------|
| `query` | 必填，搜索关键词 |
| `limit?` | 保留，默认 10，硬上限 100 |
| `offset?` | 保留，分页 |

**改造后 `AcademicSearchParams` 接口**：

```typescript
export interface AcademicSearchParams {
  query: string
  limit?: number        // 默认 10，最大 100
  offset?: number       // 分页偏移
  category?: string     // ArXiv 分类，如 'cs.AI'
  sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate'  // 默认 'submittedDate'
  sortOrder?: 'ascending' | 'descending'  // 默认 'descending'
  // 移除：mode, openAccessOnly, year, fieldsOfStudy
}
```

**改造后 `academicSearchTool.parameters`**：

```typescript
parameters: Type.Object({
  query: Type.String({ description: '搜索关键词' }),
  limit: Type.Optional(Type.Number({ description: '返回条数，默认 10，最大 100' })),
  offset: Type.Optional(Type.Number({ description: '偏移量，用于分页' })),
  category: Type.Optional(Type.String({
    description: 'ArXiv 分类过滤，如 cs.AI / cs.LG / cs.CL / stat.ML；不传则全分类搜索',
  })),
  sortBy: Type.Optional(Type.Union(
    [
      Type.Literal('relevance'),
      Type.Literal('lastUpdatedDate'),
      Type.Literal('submittedDate'),
    ],
    { description: '排序方式：relevance（相关性）/ lastUpdatedDate（最后更新）/ submittedDate（提交日期，默认）' },
  )),
  sortOrder: Type.Optional(Type.Union(
    [Type.Literal('ascending'), Type.Literal('descending')],
    { description: '排序方向，默认 descending' },
  )),
  // 移除：mode, openAccessOnly, year, fieldsOfStudy
}),
```

**改造后 `academicSearchTool.execute`**：

```typescript
execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
  const start = Date.now()
  try {
    // 直接调 callArxiv（无需 Key）
    // 注：AcademicSearchParams 与 ArxivSearchParams 改造后结构一致（query/limit/offset/category/sortBy/sortOrder），
    // 实施时可选择合并为同一 interface，或保留两个 interface 用结构化类型兼容
    const result = await callArxiv(params as ArxivSearchParams)
    await logApiUsage({
      provider: 'arxiv',
      endpoint: 'api/query',
      latencyMs: Date.now() - start,
      status: 'ok',
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    await logApiUsage({
      provider: 'arxiv',
      endpoint: 'api/query',
      latencyMs: Date.now() - start,
      status: 'error',
      errorMsg: errMsg,
    })
    throw err
  }
}
```

### 3.8 `callArxiv` 函数签名扩展

**改造前**（Phase S10 实现，支持 query/category/limit/offset）：

```typescript
export interface ArxivSearchParams {
  query: string
  category?: string     // 已存在
  limit?: number
  offset?: number
}
```

**改造后**（追加 sortBy/sortOrder）：

```typescript
export interface ArxivSearchParams {
  query: string
  category?: string
  limit?: number
  offset?: number
  sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate'  // 新增，默认 'submittedDate'
  sortOrder?: 'ascending' | 'descending'  // 新增，默认 'descending'
}
```

**`callArxiv` 实现改造**：

```typescript
export async function callArxiv(params: ArxivSearchParams): Promise<AcademicSearchResult> {
  // 1. 构造 search_query
  const searchQuery = params.category
    ? `all:"${params.query}" AND cat:${params.category}`
    : `all:"${params.query}"`

  const urlParams = new URLSearchParams({
    search_query: searchQuery,
    sortBy: params.sortBy ?? 'submittedDate',       // 改造点：默认 submittedDate
    sortOrder: params.sortOrder ?? 'descending',    // 改造点：默认 descending
    start: String(params.offset ?? 0),
    max_results: String(Math.min(params.limit ?? 10, 100)),
  })

  const url = `${ARXIV_API}?${urlParams.toString()}`
  const xmlText = await arxivThrottledFetch(url)
  const { papers, total } = parseArxivAtomXml(xmlText)
  return { papers, total }
}
```

> **注意**：`callAcademicSearch` 分发函数在 S10 引入用于路由 S2/ArXiv，本 spec 移除 S2 后该函数失去意义，**整函数移除**。`searchTools.ts` 直接 import `callArxiv`。

### 3.9 academic_search 改造任务清单

| # | 任务 | 状态 | 验收 |
|---|------|------|------|
| 3.9.1 | 移除 `callSemanticScholar` 函数 | 待完成 | searchApi.ts 中无 `callSemanticScholar` |
| 3.9.2 | 移除 `callAcademicSearch` 分发函数 | 待完成 | searchApi.ts 中无 `callAcademicSearch` |
| 3.9.3 | 移除 `SETTINGS_KEYS.SEARCH_KEY_SEMANTIC_SCHOLAR` 常量 | 待完成 | aiSettingsStore.ts 中无此常量 |
| 3.9.4 | 移除 `SearchProvider` 中 `'semanticScholar'` | 待完成 | `SearchProvider` 类型仅含 `'metaso' \| 'github'` |
| 3.9.5 | 移除 `SEARCH_KEY_MAP.semanticScholar` | 待完成 | SEARCH_KEY_MAP 仅含 metaso/github |
| 3.9.6 | 移除 searchKeys.ts 中 `semanticScholar` 相关代码 | 待完成 | VALID_PROVIDERS / PROVIDER_DISPLAY_NAMES / testSemanticScholarKey / getTestEndpoint / testSearchKey 均无 semanticScholar |
| 3.9.7 | 移除 `academicSearchTool.parameters.mode` 参数 | 待完成 | parameters 中无 mode |
| 3.9.8 | 移除 `openAccessOnly` / `year` / `fieldsOfStudy` 参数 | 待完成 | parameters 中无此三项 |
| 3.9.9 | 新增 `category` / `sortBy` / `sortOrder` 参数 | 待完成 | parameters 中含此三项 |
| 3.9.10 | 改造 `academicSearchTool.execute` 直接调 `callArxiv` | 待完成 | execute 中无 mode 分支，无 S2 Key 检查 |
| 3.9.11 | 改造 `callArxiv` 支持 `sortBy` / `sortOrder` 参数 | 待完成 | urlParams 中 sortBy/sortOrder 来自参数 |
| 3.9.12 | 改造 `parseArxivAtomXml` 解析 `categories` / `primaryCategory` / `absUrl` | 待完成 | AcademicPaper 含此三字段 |
| 3.9.13 | 改造 `AcademicPaper` 接口（移除 tldr/license/DOI，新增三字段） | 待完成 | 接口定义符合 3.5 节 |
| 3.9.14 | 改造 `searchTools.ts` import（移除 callSemanticScholar/callAcademicSearch，仅保留 callArxiv） | 待完成 | import 行仅含 callArxiv |
| 3.9.15 | 改造 `aiTools.ts` academic_search description | 待完成 | description 改为 `'检索 ArXiv 学术论文（按提交日期倒序，支持开放获取 PDF）'` |
| 3.9.16 | 数据库清理 `searchKey.semanticScholar` 残留行 | 待完成 | `SELECT key FROM ai_settings WHERE key = 'searchKey.semanticScholar'` 返回 0 行 |
| 3.9.17 | 确认无 S2 残留（全局 grep `semanticScholar` / `callSemanticScholar` / `SEARCH_KEY_SEMANTIC_SCHOLAR`） | 待完成 | grep 0 命中 |

---

## 四、github_search 改造：token 改可选 + 特殊处理

### 4.1 token 改可选策略（**已完成**）

**现状**：代码层已完成 token 可选改造：

- `callGitHub(params: GithubSearchParams, key?: string)`（searchApi.ts L481）
- `githubHeaders(key?: string)`：无 token 时不发 `Authorization` 头（searchApi.ts L450-459）
- `githubSearchTool.execute`：`const key = (await getSearchKey('github')) ?? undefined`（searchTools.ts L152）

**两种模式的配额对比**：

| 模式 | core 限额 | search 限额 | 适用端点 |
|------|----------|------------|---------|
| 有 token | 5000 req/hour | 30 req/min（search_repos/users/issues），9 req/min（search_code） | 全部端点可用 |
| 无 token | 60 req/hour | 10 req/min（通用 search） | **search_code 不可用**（401），其余可用 |

**本节无需新增代码改动**，token 可选已生效。

### 4.2 search/code 端点特殊处理（**未完成，需新增**）

**问题**：无 token 调 `/search/code` 会返回 `401 Unauthorized`，当前代码直接抛 `HttpError`，错误消息为 `GitHub API 返回错误 401: {"message":"Bad credentials","documentation_url":"https://docs.github.com/rest"}`（或 `Requires authentication`），用户/LLM 难以理解。

**改造方案**：在 `githubSearchCode` 函数中，调用 API 前检查 key 是否存在，若无 key 直接抛友好错误。

```typescript
async function githubSearchCode(params: GithubSearchParams, key?: string): Promise<GithubSearchResult> {
  // 改造点：search_code 端点强制要 token，无 token 时返回明确错误
  if (!key) {
    throw new Error(
      'GitHub 代码搜索（search_code）需要 Personal Access Token，未配置 token 时无法使用。' +
      '请在 设置 → 搜索 Key → GitHub 中配置 PAT（https://github.com/settings/tokens）。' +
      '其他模式（search_repos/search_users/search_issues/download_*）无 token 也可用（60 req/hour）。'
    )
  }

  // 以下为现有逻辑，保持不变
  let qStr = params.query ?? ''
  if (params.language) qStr += ` language:${params.language}`
  // ...（现有代码）
}
```

**为什么不在 `githubHeaders` 层做**：`githubHeaders` 是通用函数，被所有 GitHub 端点共用。只有 `search_code` 强制要 token，其他端点无 token 也能用。所以特殊处理必须在 `githubSearchCode` 函数内做。

**错误消息设计原则**：
- 说明问题（search_code 需要 token）
- 说明解决方法（在哪儿配置 token，附 GitHub PAT 申请链接）
- 说明替代方案（其他模式无 token 也可用）

### 4.3 统一限额处理（**未完成，需新增**）

**问题**：当前 `fetchWithRetry` 仅识别 429 状态码，不解析 GitHub 特有的限额头：

| 响应头 | 含义 | 当前处理 |
|--------|------|---------|
| `X-RateLimit-Remaining: 0` | 配额耗尽（即使返回 403 也表示限额） | ❌ 不解析 |
| `X-RateLimit-Reset: <unix>` | 配额重置时间（Unix 秒） | ❌ 不解析 |
| `Retry-After: <seconds>` | 二级限额（如 search API 单独限额） | ❌ 不解析 |

**现状**：GitHub 配额耗尽时返回 `403 Forbidden` + `X-RateLimit-Remaining: 0`，当前代码会抛 `GitHub API 返回错误 403: {"message":"API rate limit exceeded for ..."`，错误消息冗长且不友好。

**改造方案**：在 `githubJsonRequest` 函数中新增 GitHub 特有的限额头解析逻辑。

**方案 A（推荐）**：在 `githubJsonRequest` 内部包装一层限额检测：

```typescript
async function githubJsonRequest(url: string, headers: Record<string, string>): Promise<any> {
  try {
    return await fetchWithRetry(
      url,
      { method: 'GET', headers },
      'GitHub',
      async (response) => {
        try {
          return await response.json() as any
        } catch (e) {
          throw new Error(`GitHub API 响应解析失败：${e instanceof Error ? e.message : String(e)}`)
        }
      },
    )
  } catch (err) {
    // 改造点：GitHub 限额特殊处理
    if (err instanceof HttpError && (err.status === 403 || err.status === 429)) {
      // 注意：fetchWithRetry 已消费了 response，但 HttpError 携带 body 和 retryAfter
      // 此处无法再读 response.headers，所以方案 A 不可行，需改方案 B
    }
    throw err
  }
}
```

**方案 B（采纳）**：扩展 `fetchWithRetry` 让 `HttpError` 携带 `rateLimitRemaining` / `rateLimitReset` 字段，在 `githubJsonRequest` 的 catch 中识别并友好提示。

**实现**：

1. **扩展 `HttpError` 类**（searchApi.ts）：

```typescript
class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    public retryAfter?: string | null,
    public rateLimitRemaining?: string | null,  // 新增
    public rateLimitReset?: string | null,       // 新增
  ) {
    super(`HTTP ${status}: ${body}`)
    this.name = 'HttpError'
  }
}
```

2. **`fetchWithRetry` 内构造 `HttpError` 时传入限额头**：

```typescript
if (!response.ok) {
  const body = await response.text().catch(() => '')
  throw new HttpError(
    response.status,
    body,
    response.headers.get('retry-after'),
    response.headers.get('x-ratelimit-remaining'),  // 新增
    response.headers.get('x-ratelimit-reset'),       // 新增
  )
}
```

3. **`githubJsonRequest` 包装层识别限额**：

```typescript
async function githubJsonRequest(url: string, headers: Record<string, string>): Promise<any> {
  try {
    return await fetchWithRetry(/* 同现有 */)
  } catch (err) {
    // GitHub 限额特殊处理
    if (err instanceof HttpError && err.status === 403) {
      const remaining = err.rateLimitRemaining
      const reset = err.rateLimitReset
      if (remaining === '0' && reset) {
        const resetDate = new Date(parseInt(reset, 10) * 1000)
        const resetStr = resetDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        throw new Error(
          `GitHub API 配额已耗尽（60 req/hour 无 token 模式 / 5000 req/hour token 模式）。` +
          `配额将在 ${resetStr} 重置。` +
          `建议：1) 等待重置后重试；2) 在 设置 → 搜索 Key → GitHub 中配置 PAT 提升到 5000 req/hour。`
        )
      }
    }
    if (err instanceof HttpError && err.status === 429 && err.retryAfter) {
      throw new Error(
        `GitHub API 二级限额触发（如 search API 单独限额）。` +
        `建议 ${err.retryAfter} 秒后重试。`
      )
    }
    throw err
  }
}
```

> **注意**：`fetchWithRetry` 的 429 自动重试逻辑会先尝试重试 3 次，重试耗尽后才抛错到 `githubJsonRequest` 的 catch。所以 catch 中见到的 429 是"重试 3 次仍失败"的情况，友好提示是合理的。

### 4.4 启动日志显示当前模式（**未完成，需新增**）

**目标**：服务器启动时打印 GitHub 当前模式（有 token / 无 token），便于运维诊断。

**实现位置**：`server/src/index.ts` 启动序列中，在 `piBridge` 初始化前打印。

```typescript
// server/src/index.ts 启动日志（在 piBridge 初始化前）
const githubKey = await getSearchKey('github')
if (githubKey) {
  console.log('[Search] GitHub: token 模式（5000 req/hour，search_code 可用）')
} else {
  console.log('[Search] GitHub: 无 token 模式（60 req/hour，search_code 不可用，其余端点降级可用）')
}
```

**日志位置要求**：必须在 `/api` 路由组挂载后、`piBridge` 初始化前打印，确保 `getSearchKey` 可用（DB 已连接）。

### 4.5 ai_settings 表 Key 不变

**现状**：`SETTINGS_KEYS.SEARCH_KEY_GITHUB = 'searchKey.github'`（aiSettingsStore.ts L18）。

**改造**：Key 名不变，但语义改为可选。

- `getSearchKey('github')` 返回 `string | null`（不变）
- `githubSearchTool.execute` 中 `?? undefined`（不变）
- 不强制要求 Key 存在（不变）
- 启动日志显示模式（新增）

**数据库**：不删除 `searchKey.github` 行（如果存在）。用户可选配置 token，配置后享受 5000 req/hour，不配置则降级 60 req/hour。

### 4.6 github_search 改造任务清单

| # | 任务 | 状态 | 验收 |
|---|------|------|------|
| 4.6.1 | `githubSearchCode` 函数开头检查 token，无 token 抛友好错误 | 待完成 | 无 token 调 search_code 抛带"请在 设置 → 搜索 Key → GitHub 中配置 PAT"的错误 |
| 4.6.2 | 扩展 `HttpError` 类携带 `rateLimitRemaining` / `rateLimitReset` | 待完成 | HttpError 构造函数含此两参数 |
| 4.6.3 | `fetchWithRetry` 内构造 HttpError 时传入 `x-ratelimit-remaining` / `x-ratelimit-reset` 头 | 待完成 | HttpError 实例含限额头字段 |
| 4.6.4 | `githubJsonRequest` 包装层识别 403 + X-RateLimit-Remaining: 0 抛友好错误 | 待完成 | 配额耗尽时错误消息含"将在 {时间} 重置" |
| 4.6.5 | `githubJsonRequest` 包装层识别 429 + Retry-After 抛友好错误 | 待完成 | 二级限额错误消息含"建议 N 秒后重试" |
| 4.6.6 | `server/src/index.ts` 启动日志打印 GitHub token 模式 | 待完成 | 启动日志含 `[Search] GitHub: token 模式` 或 `无 token 模式` |
| 4.6.7 | 验证无 token 时 search_repos/search_users/search_issues/download_* 均可用 | 待完成 | 实测各端点 200 响应 |
| 4.6.8 | 验证有 token 时所有端点正常 | 待完成 | 实测 search_code 200 响应 |

---

## 五、依赖与配置变更

### 5.1 依赖变更

**无新增依赖**。

- `fast-xml-parser`：Phase S10 已新增（searchApi.ts L7），本 spec 复用
- 秘塔 API：纯 HTTP + JSON，无 SDK 依赖
- GitHub API：纯 HTTP + JSON，无 SDK 依赖
- ArXiv API：纯 HTTP + XML，复用 `fast-xml-parser`

**移除依赖**：无（S2 也是纯 HTTP，无 SDK 依赖）

### 5.2 aiSettingsStore.ts 改造（汇总）

```typescript
// 改造后最终形态
export const SETTINGS_KEYS = {
  MODEL: 'model',
  API_KEY: 'api_key',
  ENDPOINT: 'endpoint',
  SYSTEM_PROMPT: 'system_prompt',
  CANVAS_PROMPT: 'canvas_prompt',
  BROWSER_PROMPT: 'browser_prompt',
  SEARCH_KEY_METASO: 'search_key_metaso',
  // 移除：SEARCH_KEY_SEMANTIC_SCHOLAR
  SEARCH_KEY_GITHUB: 'searchKey.github',
} as const

export type SearchProvider = 'metaso' | 'github'  // 移除 'semanticScholar'

const SEARCH_KEY_MAP: Record<SearchProvider, string> = {
  metaso: SETTINGS_KEYS.SEARCH_KEY_METASO,
  // 移除：semanticScholar
  github: SETTINGS_KEYS.SEARCH_KEY_GITHUB,
}
```

### 5.3 searchKeys.ts 路由改造（汇总）

```typescript
// 改造后最终形态
const VALID_PROVIDERS: SearchProvider[] = ['metaso', 'github']  // 移除 'semanticScholar'
const PROVIDER_SET = new Set<string>(VALID_PROVIDERS)

const PROVIDER_DISPLAY_NAMES: Record<SearchProvider, string> = {
  metaso: '秘塔搜索',
  // 移除：semanticScholar: 'Semantic Scholar'
  github: 'GitHub',
}

function getTestEndpoint(provider: SearchProvider): string {
  switch (provider) {
    case 'metaso': return 'web-search'
    // 移除：case 'semanticScholar': return 'paper-search'
    case 'github': return 'rate-limit'
  }
}

async function testSearchKey(provider: SearchProvider, key: string): Promise<TestResult> {
  switch (provider) {
    case 'metaso': return testMetasoKey(key)
    // 移除：case 'semanticScholar': return testSemanticScholarKey(key)
    case 'github': return testGitHubKey(key)
  }
}

// 整函数移除：testSemanticScholarKey
```

### 5.4 aiTools.ts 元数据更新

```typescript
// 改造前
{ name: 'academic_search', label: '学术搜索', description: '检索学术论文（Semantic Scholar 相关性 / ArXiv 最新提交），支持开放获取 PDF', category: 'search', canDisable: true },
{ name: 'github_search', label: 'GitHub 搜索', description: 'GitHub 仓库/代码/用户/Issue 搜索 + 文件/Release/整仓 zip 下载', category: 'search', canDisable: true },

// 改造后
{ name: 'academic_search', label: '学术搜索', description: '检索 ArXiv 学术论文（按提交日期倒序，支持开放获取 PDF，无需 API Key）', category: 'search', canDisable: true },
{ name: 'github_search', label: 'GitHub 搜索', description: 'GitHub 仓库/代码/用户/Issue 搜索 + 文件/Release/整仓 zip 下载（token 可选，无 token 60 req/hour，search_code 需 token）', category: 'search', canDisable: true },
// web_search description 不变（已含"秘塔 AI 搜索，metaso.cn"）
```

### 5.5 环境变量

**无新增环境变量**。

- `SERVER_BASE_URL`：Phase S10 已新增，本 spec 复用
- 秘塔 Key 走 `ai_settings` 表，不走环境变量
- GitHub Key 走 `ai_settings` 表，不走环境变量

---

## 六、验收标准

### 6.1 web_search 验收

- [ ] 6.1.1 用真实 Key `mk-6DABBFFA59192A50AFB26B100634A4BB` 调 `callMetaso({query:'PhoneBuddy'})` 返回非空 `results` 数组
- [x] 6.1.2 ~~实测秘塔 API 真实响应字段名~~ **已确认**（2026-06-29 实测，详见 2.7 节）：顶层是 `webpages`（非 `results`）、每条是 `link`（非 `url`）、无 `answer` 字段、有 `credits`/`total`/`summary`/`date`(中文格式) 字段
- [ ] 6.1.3 搜 "PhoneBuddy" 能搜到腾讯混元相关结果（验证搜索引擎覆盖度）
- [ ] 6.1.4 搜 "PhoneBuddy GitHub" 能搜到 https://github.com/PhoneBuddyAI/phonebuddy
- [ ] 6.1.5 `includeSummary:true` 时首条结果含 `summary` 字段（实测确认秘塔无 `answer` 字段，AI 总结通过首条 `summary` 体现）
- [ ] 6.1.6 Key 缺失时抛 `未配置秘塔搜索 API Key，请在设置中填写（metaso.cn 获取）`
- [ ] 6.1.7 Key 无效时抛 `Metaso API 返回错误 401: ...`
- [ ] 6.1.8 429 错误透传 `请求过于频繁` + retry-after 提示
- [ ] 6.1.9 数据库 `SELECT key FROM ai_settings WHERE key LIKE '%bocha%'` 返回 0 行
- [ ] 6.1.10 `GET /api/search/keys` 返回 `providers: [{provider:'metaso',...}, {provider:'github',...}]`（无 semanticScholar）
- [ ] 6.1.11 `POST /api/search/keys/metaso/test` 能正确判断 Key 有效性
- [ ] 6.1.12 **新增** 秘塔调用后 `api_usage_log` 表新增 `credits_consumed` 列有值（实测秘塔返回 `credits` 字段）
- [ ] 6.1.13 **新增** `callMetaso` 返回的 `total` 来自 `data.total`（如实测 51），不是 `results.length`
- [ ] 6.1.14 **新增** `callMetaso` 返回的部分结果含 `datePublished` 字段（中文格式 "2025年05月16日" 解析为 ISO "2025-05-16"）

### 6.2 academic_search 验收

- [ ] 6.2.1 调 `academic_search({query:'large language model'})` 返回 ArXiv 论文列表
- [ ] 6.2.2 每篇论文含 `paperId` / `title` / `abstract` / `authors` / `year` / `publicationDate` / `openAccessPdf.url` / `externalIds.ArXiv`
- [ ] 6.2.3 每篇论文含新增的 `absUrl` / `categories` / `primaryCategory` 字段
- [ ] 6.2.4 论文不含 `tldr` / `openAccessPdf.license` / `externalIds.DOI` 字段（S2 特有字段已移除）
- [ ] 6.2.5 `paperId` 是 ArXiv id 格式（如 `2401.12345`），不是 S2 paperId
- [ ] 6.2.6 `openAccessPdf.url` 是 `https://arxiv.org/pdf/{id}.pdf` 格式
- [ ] 6.2.7 `absUrl` 是 `http://arxiv.org/abs/{id}v{n}` 格式（ArXiv 原始 abs URL）
- [ ] 6.2.8 默认排序按 `submittedDate` 倒序（第 1 篇 publicationDate ≥ 第 2 篇）
- [ ] 6.2.9 `sortBy: 'relevance'` 参数生效（ArXiv 返回相关性排序结果）
- [ ] 6.2.10 `category: 'cs.AI'` 参数生效（返回论文全部含 `cs.AI` 分类）
- [ ] 6.2.11 连续调用间隔 ≥ 3 秒（节流器生效）
- [ ] 6.2.12 并发 2 个调用，两个返回间隔 ≥ 3 秒（节流器并发安全）
- [ ] 6.2.13 **无 S2 残留**：全局 grep `semanticScholar` / `callSemanticScholar` / `SEARCH_KEY_SEMANTIC_SCHOLAR` / `callAcademicSearch` 0 命中
- [ ] 6.2.14 数据库 `SELECT key FROM ai_settings WHERE key = 'searchKey.semanticScholar'` 返回 0 行
- [ ] 6.2.15 `GET /api/search/keys` 返回结果中无 `semanticScholar` provider
- [ ] 6.2.16 `POST /api/search/keys/semanticScholar/test` 返回 400 `INVALID_PROVIDER`
- [ ] 6.2.17 `academic_search` 工具参数中无 `mode` / `openAccessOnly` / `year` / `fieldsOfStudy`
- [ ] 6.2.18 `academic_search` 工具参数中含 `category` / `sortBy` / `sortOrder`
- [ ] 6.2.19 `aiTools.ts` 中 academic_search description 含 "ArXiv"，不含 "Semantic Scholar"

### 6.3 github_search 验收

- [ ] 6.3.1 **无 token 可用**：删除 `searchKey.github` 后调 `github_search({mode:'search_repos', query:'phonebuddy'})` 返回 200 + 非空 items
- [ ] 6.3.2 **无 token 可用**：调 `github_search({mode:'search_users', query:'phonebuddy'})` 返回 200
- [ ] 6.3.3 **无 token 可用**：调 `github_search({mode:'search_issues', query:'phonebuddy'})` 返回 200
- [ ] 6.3.4 **无 token 可用**：调 `github_search({mode:'download_file', owner:'microsoft', repo:'vscode', path:'README.md'})` 返回 200 + base64 content
- [ ] 6.3.5 **无 token 不可用**：调 `github_search({mode:'search_code', query:'phonebuddy'})` 抛错，错误消息含 `GitHub 代码搜索（search_code）需要 Personal Access Token` 和 `https://github.com/settings/tokens`
- [ ] 6.3.6 **有 token 可用**：配置 `searchKey.github` 后调 `github_search({mode:'search_code', query:'phonebuddy'})` 返回 200 + 非空 items
- [ ] 6.3.7 **限额友好提示**：模拟配额耗尽（403 + `X-RateLimit-Remaining: 0` + `X-RateLimit-Reset: <unix>`），错误消息含 `配额已耗尽` 和 `将在 {时间} 重置`
- [ ] 6.3.8 **二级限额友好提示**：模拟二级限额（429 + `Retry-After: 60`），错误消息含 `二级限额触发` 和 `建议 60 秒后重试`
- [ ] 6.3.9 **启动日志**：服务器启动时打印 `[Search] GitHub: token 模式` 或 `[Search] GitHub: 无 token 模式`
- [ ] 6.3.10 `HttpError` 类构造函数含 `rateLimitRemaining` / `rateLimitReset` 参数
- [ ] 6.3.11 `fetchWithRetry` 内构造 HttpError 时传入 `x-ratelimit-remaining` / `x-ratelimit-reset` 头

### 6.4 数据迁移验收

- [ ] 6.4.1 `SELECT key FROM ai_settings WHERE key LIKE '%bocha%'` 返回 0 行
- [ ] 6.4.2 `SELECT key FROM ai_settings WHERE key = 'searchKey.semanticScholar'` 返回 0 行
- [ ] 6.4.3 `SELECT key FROM ai_settings WHERE key = 'search_key_metaso'` 返回 1 行（生产 Key 已配置）
- [ ] 6.4.4 `GET /api/search/keys` 返回 `{providers: [{provider:'metaso', hasKey:true, ...}, {provider:'github', hasKey:false, ...}]}`（无 semanticScholar）
- [ ] 6.4.5 `PUT /api/search/keys/metaso` body `{"key":"mk-6DABBFFA59192A50AFB26B100634A4BB"}` 返回 `{ok:true, provider:'metaso', updatedAt:...}`
- [ ] 6.4.6 `DELETE /api/search/keys/metaso` 后 `GET /api/search/keys/metaso` 返回 `{provider:'metaso', hasKey:false, updatedAt:null}`
- [ ] 6.4.7 `POST /api/search/keys/metaso/test` body `{"key":"mk-6DABBFFA59192A50AFB26B100634A4BB"}` 返回 `{ok:true, latencyMs:..., provider:'metaso'}`
- [ ] 6.4.8 `POST /api/search/keys/semanticScholar/test` 返回 400 `INVALID_PROVIDER`（semanticScholar 已移除）

### 6.5 运行时验证

- [ ] 6.5.1 服务器启动无报错，启动日志含 `[Search] GitHub: ... 模式`
- [ ] 6.5.2 服务器启动后 `GET /api/tools` 返回的 4 个 search 工具元数据 description 与本 spec 5.4 节一致
- [ ] 6.5.3 Pi Agent 在对话中能正确调用 `web_search` 搜 "PhoneBuddy" 并返回秘塔结果
- [ ] 6.5.4 Pi Agent 在对话中能正确调用 `academic_search` 搜 "large language model" 并返回 ArXiv 结果
- [ ] 6.5.5 Pi Agent 在对话中能正确调用 `github_search` mode=search_repos 搜 "phonebuddy" 并返回结果（无 token 也能用）
- [ ] 6.5.6 Pi Agent 调用 `github_search` mode=search_code 时（无 token 场景）返回友好错误提示
- [ ] 6.5.7 `api_usage_log` 表记录正常：
  - web_search 调用后 `provider='metaso'` 行 +1，且 `credits_consumed` 列有值（实测秘塔返回 `credits` 字段）
  - academic_search 调用后 `provider='arxiv'` 行 +1
  - github_search 调用后 `provider='github'` 行 +1
  - 无 `provider='semanticScholar'` 行（S2 移除后不应出现）
- [ ] 6.5.8 **新增** `api_usage_log` 表有 `credits_consumed` 列（`ALTER TABLE` 迁移成功）

---

## 七、测试计划

### 7.1 单元测试

**`server/test/search-metaso-test.ts`**（已存在，扩展）：

- Test 1（已存在）：空 Key 抛错
- Test 2（已存在）：无效 Key 抛错
- Test 3（新增）：真实 Key 调用 `callMetaso({query:'PhoneBuddy'})`，断言 `results.length > 0`，每条结果含 `title` / `url` / `snippet`
- Test 4（新增）：实测响应字段名（`webpages` vs `results`），若与实现不符输出诊断信息
- Test 5（新增）：`count` 参数生效（`count=5` 返回 ≤5 条）
- Test 6（新增）：`includeSummary=true` 时 `results[0].summary` 非空（AI 总结前置）
- Test 7（**新增**）：断言 `total` 字段来自 `data.total`（如 51），不是 `results.length`
- Test 8（**新增**）：断言部分结果含 `datePublished` 字段（中文格式 "2025年05月16日" 解析为 ISO "2025-05-16"）
- Test 9（**新增**）：断言 `_credits` 内部字段有值（秘塔返回 `credits` 字段）
- Test 10（**新增**）：断言秘塔响应**无** `answer` 字段（实测确认）

**`server/test/search-academic-test.ts`**（已存在，需更新）：

- Test 1（更新）：调 `callArxiv({query:'large language model'})` 返回非空 papers
- Test 2（更新）：每篇 paper 含 `publicationDate` / `openAccessPdf.url` / `externalIds.ArXiv` / `absUrl` / `categories` / `primaryCategory`
- Test 3（更新）：每篇 paper 不含 `tldr` / `externalIds.DOI` / `openAccessPdf.license`
- Test 4（更新）：`paperId` 是 ArXiv id 格式（`YYYY.NNNNNN`）
- Test 5（更新）：默认 `sortBy=submittedDate` 倒序，`papers[0].publicationDate >= papers[1].publicationDate`
- Test 6（新增）：`sortBy='relevance'` 参数生效
- Test 7（新增）：`category='cs.AI'` 参数生效，返回论文全部含 `cs.AI` 分类
- Test 8（更新）：节流器验证（连续 2 次调用间隔 ≥ 3s）
- Test 9（更新）：节流器并发安全（`Promise.all` 2 个调用，两个返回间隔 ≥ 3s）
- Test 10（新增）：**无 S2 残留**：尝试 import `callSemanticScholar` 应失败（编译错误）
- Test 11（新增）：**无 callAcademicSearch 残留**：尝试 import `callAcademicSearch` 应失败（编译错误）
- Test 12（新增）：`AcademicSearchParams` 不含 `mode` / `openAccessOnly` / `year` / `fieldsOfStudy` 字段（TS 类型校验）

**`server/test/search-github-test.ts`**（已存在，需更新）：

- Test 1（更新）：无 token 调 `search_repos` 返回 200 + 非空 items
- Test 2（新增）：无 token 调 `search_code` 抛错，错误消息含 `GitHub 代码搜索（search_code）需要 Personal Access Token` 和 `https://github.com/settings/tokens`
- Test 3（新增）：无 token 调 `search_users` 返回 200
- Test 4（新增）：无 token 调 `search_issues` 返回 200
- Test 5（新增）：无 token 调 `download_file` (path) <1MB 返回 base64 content
- Test 6（新增）：模拟 403 + `X-RateLimit-Remaining: 0` + `X-RateLimit-Reset: <unix>`，错误消息含 `配额已耗尽` 和 `将在 {时间} 重置`
- Test 7（新增）：模拟 429 + `Retry-After: 60`，错误消息含 `二级限额触发` 和 `建议 60 秒后重试`
- Test 8（新增）：启动日志含 `[Search] GitHub: ... 模式`（有 token / 无 token 两种场景）

### 7.2 集成测试

**`server/test/search-via-server-api.mjs`**（已存在，扩展）：

- 通过 HTTP API 调用 3 个搜索工具端到端：
  - `POST /api/ai/chat` 发消息 "搜 PhoneBuddy 网页信息" → Pi Agent 调 `web_search` → 返回秘塔结果
  - `POST /api/ai/chat` 发消息 "搜 large language model 学术论文" → Pi Agent 调 `academic_search` → 返回 ArXiv 结果
  - `POST /api/ai/chat` 发消息 "搜 phonebuddy GitHub 仓库" → Pi Agent 调 `github_search` mode=search_repos → 返回结果

**错误场景测试**：

- web_search：删除 metaso Key → 调用应抛"未配置秘塔搜索 API Key"
- academic_search：调 `search_code`（无 github Key）→ 抛"GitHub 代码搜索需要 Personal Access Token"
- github_search：删除 github Key → 调 `search_repos` 应正常（无 token 也能用）

### 7.3 真实 Key 端到端验证

| # | 场景 | Key 配置 | 验证步骤 | 期望结果 |
|---|------|---------|---------|---------|
| 7.3.1 | 秘塔搜索 | 配置 `mk-6DABBFFA59192A50AFB26B100634A4BB` | `POST /api/ai/chat` 发 "搜 PhoneBuddy 网页信息" | 返回腾讯混元相关结果 |
| 7.3.2 | ArXiv 搜索 | 无需 Key | `POST /api/ai/chat` 发 "搜 large language model 学术论文" | 返回 ArXiv 论文列表，按 submittedDate 倒序 |
| 7.3.3 | GitHub 无 token | 删除 github Key | `POST /api/ai/chat` 发 "搜 phonebuddy GitHub 仓库" | 返回仓库列表（60 req/hour 模式） |
| 7.3.4 | GitHub search_code 无 token | 删除 github Key | `POST /api/ai/chat` 发 "在 GitHub 搜 PhoneBuddy 代码" | 返回友好错误"需要 Personal Access Token" |
| 7.3.5 | GitHub search_code 有 token | 配置 PAT | 同 7.3.4 | 返回代码搜索结果 |
| 7.3.6 | 秘塔 Key 测试 | `POST /api/search/keys/metaso/test` | body `{"key":"mk-6DABBFFA59192A50AFB26B100634A4BB"}` | 返回 `{ok:true, latencyMs:...}` |
| 7.3.7 | GitHub Key 测试 | `POST /api/search/keys/github/test` | body `{"key":"<PAT>"}` | 返回 `{ok:true, latencyMs:...}` |
| 7.3.8 | 启动日志 | 重启服务器 | 查看启动日志 | 含 `[Search] GitHub: token 模式` 或 `无 token 模式` |

---

## 八、回滚方案

### 8.1 git tag 备份

实施前先打 tag：

```bash
git tag pre-search-tools-optimization
git push origin pre-search-tools-optimization
```

回滚步骤：

```bash
git reset --hard pre-search-tools-optimization
# 重启服务器
```

### 8.2 数据库迁移回滚

| 改造项 | 回滚 SQL |
|--------|---------|
| 删除 `searchKey.bocha` 行 | 不需回滚（旧 Key 已失效，无价值） |
| 删除 `searchKey.semanticScholar` 行 | `INSERT INTO ai_settings (key, value, updated_at) VALUES ('searchKey.semanticScholar', '<旧 S2 Key>', <timestamp>)`（需备份旧 Key 值） |
| 新增 `search_key_metaso` 行 | `DELETE FROM ai_settings WHERE key = 'search_key_metaso'`（若回滚到 Bocha 时代） |

**回滚注意**：

- 本 spec 改造后，`SearchProvider` 类型变为 `'metaso' | 'github'`，回滚到 S2 时代需恢复 `'semanticScholar'` 类型并恢复 `callSemanticScholar` 函数（git reset 自动恢复代码）
- 数据库行删除前先备份：`SELECT key, value, updated_at FROM ai_settings WHERE key IN ('searchKey.bocha', 'searchKey.semanticScholar')` 导出 SQL

### 8.3 分步回滚

若仅某一项改造需回滚（其他保留）：

| 改造项 | 回滚方式 |
|--------|---------|
| web_search 秘塔 → Bocha | git revert 相关 commit；但 Bocha 已废弃，建议不回滚 |
| academic_search ArXiv → S2 | git revert 相关 commit；恢复 `callSemanticScholar` 函数与 `mode` 参数 |
| github_search token 可选 → 强制 | git revert 相关 commit；恢复 `key: string` 必填签名 |

---

## 九、对抗审查关键点

> 本节列出 spec 中需要对抗审查重点验证的关键决策点，供独立审查 agent 参考。

### 9.1 关键决策点

| # | 决策点 | 风险 | 审查方式 |
|---|--------|------|---------|
| 1 | 秘塔 API 响应字段名 `webpages` vs `results`（2.2 节） | 字段名不一致导致解析失败 | ✅ **已实测确认**（2026-06-29）：秘塔返回 `webpages`，详见 2.7 节 |
| 2 | 秘塔 API `link` vs `url` 字段名（2.2 节） | 同上 | ✅ **已实测确认**：秘塔返回 `link`，详见 2.7 节 |
| 3 | `AcademicPaper` 接口移除 `tldr` 字段（3.5 节） | 客户端可能引用 tldr | grep 客户端代码 `tldr` 引用（注：ArXiv 路径本就未设置 tldr，仅接口定义含） |
| 4 | `AcademicPaper` 接口移除 `externalIds.DOI` 字段（3.5 节） | 客户端可能引用 DOI | grep 客户端代码 `externalIds.DOI` 引用（注：ArXiv 路径本就未设置 DOI） |
| 5 | `AcademicSearchParams` 移除 `mode`/`openAccessOnly`/`year`/`fieldsOfStudy`（3.7 节） | 客户端可能传这些参数 | grep 客户端代码 `openAccessOnly` 引用 |
| 6 | `callAcademicSearch` 分发函数移除（3.8 节） | 其他模块可能 import | grep `callAcademicSearch` 引用 |
| 7 | `search_code` 端点无 token 抛友好错误（4.2 节） | 错误消息是否够友好 | 实测错误消息可读性 |
| 8 | `HttpError` 扩展 `rateLimitRemaining`/`rateLimitReset`（4.3 节） | 是否影响其他 API（metaso/arxiv）的 HttpError 构造 | grep `new HttpError` 调用，确保都兼容新签名（实测：当前仅 searchApi.ts L126 一处 `new HttpError` 调用，扩展签名安全） |
| 9 | 启动日志位置（4.4 节） | 必须在 DB 连接后、piBridge 初始化前 | 检查 index.ts 启动序列顺序（实测：piBridge 初始化在 httpServer.listen 回调 L127，启动日志应在 L120 errorHandler 之前或 L124 httpServer.listen 之前打印） |
| 10 | 数据库清理 `searchKey.bocha` 残留行（2.5 节） | 生产 DB 是否真有此行需清理 | 实施前先 `SELECT` 查询确认 |
| 11 | 数据库清理 `searchKey.semanticScholar` 残留行（3.6 节） | 同上 | 同上 |
| 12 | `multi-engine-search-spec.md` 已废弃（1.5 节） | 是否需删除该文件 | 用户决策：保留作历史记录，但本 spec 取代之 |
| 13 | **新增** 秘塔 `credits` 字段记录到 `api_usage_log`（2.7.5 节） | `credits` 语义待二次调用确认 | 实施时二次调用秘塔 API，对比 `credits` 变化判断语义；无论语义如何，记录到 `api_usage_log` 都是合理的 |
| 14 | **新增** 秘塔无 `answer` 字段，AI 总结通过首条 `summary` 体现（2.3 节） | 客户端可能依赖 `data.answer` 字段 | grep 客户端代码 `.answer` 引用（实测：秘塔无 `answer`，当前 callMetaso L273-280 前置逻辑恒不触发） |

### 9.2 必须运行时验证的项（不能只读代码）

> 强制要求：以下各项必须用真实 API Key + 真实 HTTP 调用验证，不能仅靠代码 review 判定合格。

| # | 验证项 | 验证方式 | 通过标准 |
|---|--------|---------|---------|
| 1 | 秘塔 API 真实响应字段 | ✅ **已实测**（2026-06-29，详见 2.7 节）：`curl -X POST https://metaso.cn/api/v1/search -H "Authorization: Bearer mk-xxx" -H "Content-Type: application/json" -d '{"q":"transformer 模型","scope":"webpage","size":"3"}'` | ✅ 已确认：顶层是 `webpages`，每条是 `link`，无 `answer`，有 `credits`/`total`/`summary`/`date`(中文格式) |
| 2 | `callMetaso` 解析真实响应 | 跑 `search-metaso-test.ts` 用真实 Key | `results.length > 0`，每条含 `title`/`url`/`snippet` |
| 3 | `callArxiv` 节流器并发安全 | 跑 `search-academic-test.ts` Test 9 | `Promise.all` 2 个调用，两个返回间隔 ≥ 3s |
| 4 | GitHub 无 token 模式可用 | 跑 `search-github-test.ts` Test 1/3/4/5 | 各端点返回 200 |
| 5 | GitHub search_code 无 token 友好错误 | 跑 `search-github-test.ts` Test 2 | 错误消息含 `需要 Personal Access Token` 和 `github.com/settings/tokens` |
| 6 | GitHub 限额友好提示 | 模拟 403+`X-RateLimit-Remaining: 0` | 错误消息含 `配额已耗尽` 和 `将在 {时间} 重置` |
| 7 | 启动日志打印 GitHub 模式 | 重启服务器，查看日志 | 含 `[Search] GitHub: ... 模式` |
| 8 | 工具注册到 Pi Agent | `POST /api/ai/chat` 发 "搜 PhoneBuddy 网页信息" | Pi Agent 调用 `web_search` 返回秘塔结果 |
| 9 | api_usage_log 记录正常 | 各工具调用后查询 `SELECT * FROM api_usage_log ORDER BY created_at DESC LIMIT 10` | 含 `provider='metaso'`/`'arxiv'`/`'github'` 行，无 `'semanticScholar'` 行 |
| 10 | `GET /api/tools` 工具元数据 | `curl http://localhost:3456/api/tools` | 4 个 search 工具 description 与 spec 5.4 节一致 |

### 9.3 已知风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| ~~秘塔 API 响应字段名与实现不符~~ | ~~高~~ | ~~web_search 解析返回空 results~~ | ✅ **已实测确认**（2026-06-29），字段映射方案见 2.3 节，3 个 bug 修复方案见 2.7.4 节 |
| 秘塔 API 余额不足 | 低 | web_search 不可用 | 充值或换引擎（5000 点免费额度可能已用完）；通过 `api_usage_log.credits_consumed` 监控配额趋势 |
| 客户端代码引用已移除字段（tldr/DOI/mode 等） | 中 | 客户端运行时报错 | 实施前 grep 客户端代码，确认无引用（注：ArXiv 路径本就未设置 tldr/DOI，仅接口定义含） |
| GitHub 无 token 配额耗尽（60 req/hour） | 中 | 短时间内多次调用 github_search 失败 | 限额友好提示 + 建议配置 token（详见 4.3 节） |
| ArXiv API 节流不够被封 IP | 低 | academic_search 不可用 | 节流器 ≥3s 间隔 + 预留时间槽并发安全 |
| 数据库残留 Key 清理误删 | 低 | 用户 Key 丢失 | 删除前先 `SELECT` 查询确认，备份后删除 |
| **新增** ArXiv 3 秒间隔强制方案阻塞用户 | 中 | 连续两次 `academic_search` 调用会等 3 秒，用户体验下降 | 节流器在并发场景下用预留时间槽模式（不串行阻塞），单用户连续调用确实会等；可在工具描述中提示"学术搜索有 3 秒节流"；本 spec 接受此风险（ArXiv 官方建议 ≥3s） |
| **新增** GitHub 无 token 60 req/hour 在实际使用中可能不够用 | 中 | 短时间内多次调用 github_search 失败 | 限额友好提示 + 建议配置 token；本 spec 接受此风险（用户可选配 token 升级到 5000 req/hour） |
| **新增** 移除 S2 后 academic_search 只能搜 ArXiv 一个源，覆盖面受限 | 中 | ArXiv 主要覆盖 CS/Physics/Math，其他学科（生物/医学/社科）覆盖差 | 本 spec 接受此风险（用户决策明确移除 S2）；若需扩展可在未来 spec 中评估 OpenAlex/Crossref 等替代源 |
| **新增** 秘塔 `credits` 字段语义未确认 | 低 | 配额监控数据解读不准 | 实施时二次调用秘塔 API 对比 `credits` 变化判断语义；无论语义如何，记录到 `api_usage_log` 都是合理的 |

---

## 附录 A：秘塔 API 实测确认结果（2026-06-29）

> ✅ **已实测确认**（取代原"调研待实测"状态）。实测详情见 2.7 节。

- 端点：`POST https://metaso.cn/api/v1/search`
- 请求头：`Authorization: Bearer mk-xxx`、`Accept: application/json`、`Content-Type: application/json`
- 请求体：
  - `q`（必填）：搜索词
  - `scope`（可选）：webpage/document/paper/image/video/podcast
  - `size`（可选，默认 10）：返回条数
  - `includeSummary`（可选 bool）：网页摘要提升召回（实测：true 时首条结果通常返回 AI 生成的 `summary`，其余仍是 `snippet`）
  - `includeRawContent`（可选 bool）：抓取原文
  - `conciseSnippet`（可选 bool）：精简片段
- 返回 JSON 结构（**实测确认**，详见 2.7.2 节）：
  ```json
  {
    "credits": 3,
    "searchParameters": {
      "q": "transformer 模型",
      "scope": "webpage",
      "size": 3,
      "searchFile": false,
      "includeSummary": true,
      "conciseSnippet": true,
      "format": "chat_completions"
    },
    "webpages": [
      {
        "title": "...",
        "link": "https://...",
        "score": "high",
        "summary": "...",
        "snippet": "...",
        "position": 1,
        "date": "2025年05月16日",
        "authors": ["Google"]
      }
    ],
    "total": 51
  }
  ```
- **实测关键发现**（10 项，详见 2.7.3 节）：
  1. 顶层是 `webpages`（不是 `results`）
  2. 单条结果是 `link`（不是 `url`）
  3. `score` 是字符串 `"high"`/`"medium"`/`"low"`（不是数字）
  4. `date` 是中文格式 `"2025年05月16日"`（非 ISO 8601）
  5. `summary` 与 `snippet` 互斥
  6. **没有 `answer` 字段**
  7. **没有 `results` 字段**
  8. **没有限流响应头**（无 `X-RateLimit-*`、无 `Retry-After`）
  9. 顶层新增 `credits` 字段（疑似剩余配额或本次消耗量）
  10. 顶层新增 `searchParameters.format` 默认 `"chat_completions"`
- 价格：0.03 元/次 + 5000 点免费
- 官方文档：https://metaso.cn/search-api/playground

---

## 附录 B：GitHub API 调研结果（实测验证）

- 无 token：core 60 req/hour，search 10 req/min，下载类端点可用
- `/search/repositories`、`/search/users`、`/search/issues`：无 token 可用
- `/search/code`：**无 token 401 Unauthorized**，强制要 token
- `/repos/{owner}/{repo}/zipball/{ref}`、`/releases/assets/{id}`、`/git/blobs/{sha}`、`/contents/{path}`：无 token 可用
- 限额超额返回 403 + `X-RateLimit-Remaining: 0` + `X-RateLimit-Reset: <unix>`
- 二级限额带 `Retry-After` 头
- 建议：token 改可选，无 token 时降级使用 + 友好错误提示

---

## 附录 C：ArXiv API 调研结果（实测验证）

- 端点：`https://export.arxiv.org/api/query`（建议 HTTPS）
- 参数：`search_query`、`start`、`max_results`（≤2000）、`sortBy`（relevance/lastUpdatedDate/submittedDate）、`sortOrder`（ascending/descending）
- 搜索语法：`ti:`、`au:`、`abs:`、`cat:`、`all:`，布尔运算符 AND/OR/ANDNOT（必须大写）
- 返回格式：**Atom 1.0 XML**（无 JSON 端点）
- Rate limit：1 req per 3 seconds（硬性建议）
- entry 字段：id、title、summary、published、updated、link(rel=alternate/related title=pdf)、category(term)、arxiv:primary_category、arxiv:comment、arxiv:journal_ref、arxiv:doi、author/name
- OpenSearch 扩展：opensearch:totalResults、opensearch:startIndex、opensearch:itemsPerPage
- 解析方案：复用 Phase S10 已实现的 `fast-xml-parser`（约 100KB 无依赖），配置 `removeNSPrefix: true`
- 最新论文：`sortBy=submittedDate` + `sortOrder=descending` 可搜到最新论文

---

## 附录 D：与 multi-engine-search-spec.md 的差异

| 维度 | multi-engine-search-spec.md（已废弃） | 本 spec（取代之） |
|------|------------------------------------|------------------|
| web_search 引擎 | DuckDuckGo + Tavily + Bing + Bocha 4 引擎 fallback | 秘塔（Metaso）单引擎 |
| 是否需要 cheerio 依赖 | 是（DuckDuckGo HTML 解析） | 否 |
| GitHub token | 可选 | 可选（一致） |
| academic_search | 不动（S2 + ArXiv 双路径） | 移除 S2，仅 ArXiv |
| 复杂度 | 高（4 引擎 + fallback 链 + cheerio） | 低（单引擎 + 移除 S2） |
| 用户决策 | 用户未采纳 | 用户采纳 |

> [multi-engine-search-spec.md](multi-engine-search-spec.md) 保留作历史记录，但本 spec 取代之。实施时以本 spec 为准。

---

> 本 Spec 至此结束。实施前先读 [ai-search-spec.md](ai-search-spec.md) 第四/五/六章确认原始设计，再读 [phase-s10-spec.md](phase-s10-spec.md) 第四章确认 ArXiv 集成现状，最后按本 spec 第六/七章验收。
