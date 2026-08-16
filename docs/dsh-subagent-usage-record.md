# DSH Sub-Agent 使用记录：安全审计 + 问题分析 + App API 调研（2026-08-15/16）

> 本文档完整记录本次会话使用 dsh_subagent 包的**全流程、遇到的问题、规避方法、产出摘要**，供后续复用与排障参考。
> 关联产出：`docs/webos-app-api.md`（App API 设计草稿）、安全威胁建模（见文末摘要）。

---

## 1. 会话背景与任务清单

本次会话共委托 **9 个 DSH 任务**（3 批）：

| # | 任务 | taskId | preset | 结果 |
|---|---|---|---|---|
| 1 | 项目安全漏洞全量审计（初版，标准） | dsh-msumpixr-9lvmb4 | standard | ❌ 用户中途取消（嫌慢） |
| 2 | 项目安全漏洞全量审计（极简重跑） | dsh-msumrbg6-1auhck | minimal | ✅ 成功（99 步/98 次 bash，完整报告） |
| 3 | 公告一直显示 bug 分析 | dsh-msunxlhs-73cdyh | minimal | ⚠️ 结果串号（返回了任务 6 的答案） |
| 4 | 朋友账号存储空间扩容方案 | dsh-msunxm26-5flolg | minimal | ✅ 成功（独立会话，详细 SQL 方案） |
| 5 | 手势/滚动/新建按钮三问题分析 | dsh-msunxmh1-dyecve | minimal | ⚠️ 结果串号（返回了任务 6 的答案） |
| 6 | 表格吞首条 + 输入框不延展分析 | dsh-msunxmxd-f6w5ui | minimal | ✅ 成功（独立会话，根因精确到行号） |
| 7 | Web 端 App API 体系设计 | dsh-msuobukx-51njft | minimal | ✅ 成功（写入 docs/webos-app-api.md） |
| 8 | App API 安全威胁建模 | dsh-msuobv41-1c3fpv | minimal | ✅ 成功（7 大威胁 + 安全基线） |
| 9 | 手势问题单独重跑（async） | dsh-msuojc7p-97lo1f | minimal | ❌ 只跑 2 步就 done，无答案 |
| 10 | 手势问题单独重跑（sync） | dsh-msuokxwz-2bweuf | minimal | ❌ exitCode 130（SIGINT），失败 |

**结论：9 个任务中 5 个成功、2 个串号、2 个失败；串号/失败的任务最终由 Operit 直接读代码完成分析。**

---

## 2. 遇到的问题（按严重程度排序）

### 问题 1（最严重）：并发任务结果串号 —— 多个任务返回同一份答案

- **现象**：同一批并发启动的 async 任务（公告/存储/手势/表格），watch 或 status 时发现 3 个任务（公告 dsh-msunxlhs、手势 dsh-msunxmh1、表格 dsh-msunxmxd）**返回完全相同的 sessionId、steps、toolCalls、tokens 和 answer**——全都是表格任务的答案（session-5fd76dc5-a33d-4be2-87a2-3260a727bc30，63 步/62 次 bash/105418 tokens）。
- **推测根因**：DSH headless 会话复用问题——同一 `--profile headless` 在同一时刻只能有一个活跃会话，后启动的任务可能被**附加到已有会话**或**查询到了错误会话的结果**。存储任务（dsh-msunxm26）和表格任务恰好抢到了独立会话，所以成功。
- **影响**：公告、手势两个任务的分析结果永久丢失，需人工补救。
- **规避方法**：**同一时间只跑一个 DSH 任务**，跑完再启动下一个；需要并行时用 Operit 自己的工具（grep/read）分担。

### 问题 2：单任务重跑异常 —— 只执行 2 步就 done、无答案

- **现象**：串号后单独重跑手势任务（dsh-msuojc7p-97lo1f），结果只执行了 `pwd && ls -la && find ...` 2 个 bash 调用就 done，`answer: null`，tokens 仅 781。
- **推测**：前一批任务进程可能未完全清理（串号任务的 nohup 进程还活着占着 headless 会话），新任务启动即被错误复用/立即结束。
- **规避**：串号或失败后，先确认没有遗留 running 任务（dsh_subagent_list），必要时**重启 DSH Web 服务**（deepseek_harness:restart_deepseek_harness_server）再跑。

### 问题 3：sync 模式失败（exitCode 130）

- **现象**：手势任务改用 `mode=sync` 重跑，返回 exitCode 130（SIGINT），输出里混杂 nohup 后台启动信息。
- **推测**：sync 模式与前一批遗留任务冲突，或超时/信号处理问题。
- **规避**：优先 async + watch；sync 模式在并发/遗留任务存在时不可靠。

### 问题 4：watch 被中途取消后任务仍继续跑

- **现象**：任务 1 的 watch 被用户取消（`User cancelled`），但后台 nohup 进程仍继续执行到完成；后续 status 仍能查到结果。
- **注意**：取消 watch **不等于**取消任务（任务 1 最终由用户要求 cancel 才终止）。确认要停就调 dsh_subagent_cancel。

### 问题 5：工作区代码在会话期间被外部更新

- **现象**：会话开始时 grep 到公告代码在 `client/shell-web/src/App.tsx`（约 1199-1234 行）和 `styles.css`（约 52-73 行）；几分钟后整个 `client/` 目录搜 `announcement` **0 匹配**——公告代码已从工作区消失（疑似外部同步/更新）。
- **影响**：① 公告 agent 即使成功也基于旧代码；② 表格/输入框 agent 分析的行号（如 App.tsx:581/639/1649）基于更新后的代码，经抽查仍有效。
- **教训**：**agent 结论必须基于"当前"代码复核**；发现工作区被更新（文件大小/行数变化、grep 结果骤变）要重新确认关键行号再采信。

### 问题 6：极简模式（minimal）能力受限但不影响代码审计

- minimal preset 只有 `bash` + `str_replace_editor`，没有 Read/Web 工具。本次所有任务（安全审计、SQL 方案、代码分析）**全部用 bash（grep/sed/nl/awk/find）完成**，没有遇到工具不足的障碍。
- token 消耗：安全审计 ~34 万（含推理），问题分析 ~8-13 万，App API 设计 ~13 万，安全建模 ~11.5 万；缓存命中率 93-98%，成本可控。

### 问题 7：agent 输出可信度需人工抽查

- 安全审计 agent 的 5 条 Critical **全部**经 Operit grep 复核属实（C1 entities 越权、C2 dynamicWidgets 无 admin、C3 api-key 明文、C4 raw 免鉴权、C5 首用户 admin）。
- 表格 agent 的根因（`renderTable` 的 `rows.slice(2)` 假设含分隔行而构造时漏掉分隔行）经读源码复核**完全属实**。
- 存储 agent 的 SQL 方案基于 `workspaceLimitResolved`/`normalizeState` 实际代码，可信。
- **教训：agent 结论必须抽查验证（grep 关键行号），不能盲信；High 级以下条目标注【需人工确认】。**

---

## 3. 成功任务的关键参数（可复用模板）

### 任务 2：全量安全审计（minimal + async，99 步完成）

- 任务描述结构：项目位置 + 技术栈 + **按优先级分 8 个审计域**（认证授权/注入/沙箱XSS/敏感信息/支付计费/依赖/WS协议/其他）+ 输出格式要求（分级 + 文件:行号 + 攻击场景 + 修复建议 + Top5 + 诚实声明）。
- 实测产出质量：根因定位到函数/行号，且经抽查全部属实；未发现编造漏洞（SQL 注入明确说"未发现"）。

### 任务 4：存储配额分析（minimal + async，29 步完成）

- 关键：要求"**没有管理 API 就明说，不要编造**"——agent 诚实回答了"不存在 /api/admin/webos/workspace"，并给出 SQL 兜底方案 + 月卡过期重置风险。**诚实性约束能显著提高可信度。**

### 任务 7/8：设计类任务（minimal + async，52/31 步完成）

- 参考文档明确指定（docs/android/04-app-api.md、05-external-apps.md、07-permissions.md）+ 代码事实盘点 + 分阶段设计 + 待验证项标注。
- 任务 7 直接把设计写入 `docs/webos-app-api.md`（~450 行），任务 8 输出 7 大威胁 + 检查点清单 + 安全基线（必须做/可后置）。

---

## 4. 本次会话产出摘要（结论速查）

### 4.1 安全审计（Task 2，已人工验证）

- **Critical ×5（全部验证属实）**：C1 entities/scopes/export/import 全量越权（webos_state 含 App/积分/存储）；C2 dynamicWidgets 任意用户上传 + 前端 `new Function` 执行（存储型 RCE）；C3 `/api/ai/settings/api-key` 明文返回 + 任意用户可改全局 AI 配置；C4 raw 素材端点免鉴权 + 可执行 MIME 同源 XSS；C5 首个注册用户自动 admin。
- **High ×9**：JWT 不校验封禁/角色、deviceId 未绑定用户、SSRF（DNS rebinding/重定向绕过）、背景 SVG 存储型 XSS、分享落地页未转义、工具开关/搜索 Key 无 admin、主 DOM 渲染不可信 HTML、WS apiConfig 任意 endpoint、Panel/Widget 越权。
- **Medium ×5 / Low ×4**：兑换码并发重复兑换、SameSite=None 无 CSRF、bash 沙箱可读 env、本地服务无归属校验、全局资源无权限控制；真实密钥在 server/.env 与 tmp 硬编码（建议轮换）、依赖版本待 npm audit、XFF 信任、改密后旧 JWT 有效。
- **Top 5 修复优先级**：C1 > C2 > C3 > C4 > C5+H1。

### 4.2 问题分析（Task 4/6 + Operit 直接分析）

| 用户问题 | 根因（文件:行号） | 修复方向 |
|---|---|---|
| 表格吞第一条 | `App.tsx:639` 构造 rows 时漏掉分隔行，`App.tsx:581` `rows.slice(2)` 假设含分隔行 → 第一条数据被吞 | 在 639 行把 `lines[i+1].trim()` 放入 rows，或改 `rows.slice(1)` |
| 输入框不向上延展 | `App.tsx:1645` 与 `styles.css:72` 硬编码 `max-height:160px`；`resizeComposer` 只在 onChange 调用 | 提高上限（如 `min(45vh,320px)`）、draft 变化时 useEffect 重新 resize |
| 代码区右滑切桌面 | `App.tsx:1131-1148` `useSwipeNavigation` 挂在整个 assistant-screen；`.md-content pre`（styles.css:248）有 `overflow-x:auto`，横向滑动 dx≥64 即触发 `setView('desktop')` | 手势判定排除横向可滚动子元素（pre/table/LaTeX），或代码块内滑动不冒泡 |
| 切回对话不滚到最新 | `App.tsx` scroll 跟随 useEffect 只在 `[messages, streaming]` 变化且 `nearBottomRef` 为 true 时滚到底；切页回来 messages 没变 → 不滚动 | 在 activeView 切回 assistant 时强制滚到底（尊重 nearBottom 上滑阅读） |
| 新建对话入口太深 | 新建入口在 composer ➕菜单 →「会话列表」→ 侧栏内新建（`ChatSidebar`，App.tsx:1434+；`createConversation` 在 store.ts） | 在 composer 加号旁直接加新建按钮，调用 `useShellStore.getState().createConversation()` |
| 公告一直显示 | **当前工作区代码已无公告功能**（会话期间被移除）；线上仍在显示 = 部署版本未更新或 Service Worker 缓存 | 确认线上部署新版本；清 SW 缓存 |

### 4.3 App API 体系（Task 7/8）

- **现状盘点**：`sdk.http` 是通用代理雏形但无域名白名单/secrets 托管；`sdk.api.register/call` 仅内存级桥接（目标 App 必须打开）；服务端**无** api.json 解析、无 /appapi、无 vm handler 沙箱；`server/src/sandbox/` 只是 shell 白名单执行器；shared/webos-contracts 无完整 AppManifest 类型。
- **分阶段**：P1 外部 API 接入（manifest.network.domains + secrets 服务端托管 + `/webos/api/apps/:appId/http`）；P2 App 间 API（api.json + `/webos/api/appapi/:namespace/:endpoint` + node:vm handler + sdk.useApi + pi 动态工具 + kind='api' 计费审计）；P3 系统级 API（sdk.ai.chat 复用 /chat/stream，不暴露 key；App 内工具 = api.json 动态工具）。
- **安全基线（必须做）**：SSRF 完整防护（域名白名单/IP 黑名单含 IPv6/DNS rebinding/重定向逐跳校验）；secrets AES-256-GCM 托管且不可达前端；服务端 appRuntimeToken 识别调用方；storage 前缀声明强制；API 调用计费+限流+审计；SDK 能力最小化；系统 AI 扣费主体来自 JWT + App 内容按不可信数据处理 + AI UI 为安全 UI 例外；管理端封禁/下架/吊销。

---

## 5. 经验教训总结（下次直接照做）

1. **串行跑 DSH 任务**：并发多个 async 任务有高概率结果串号；必须并行时改用 Operit 自身工具。
2. **串号/失败后处理**：先 `dsh_subagent_list` 确认无遗留 running 任务，必要时重启 DSH Web 服务，再单独重跑。
3. **任务描述要"框死"**：给文件路径、搜索关键词、诚实性约束（"没有就明说，不要编造"）、输出格式（文件:行号 + 攻击场景 + 修复方案）。
4. **minimal preset 足够做代码审计**：bash-only 可以完成全项目 grep/sed 分析，token 远低于 standard。
5. **结果必验证**：agent 的根因结论抽查关键行号；High 级以下标注待确认。
6. **工作区可能被外部更新**：agent 结论与当前代码不一致时，以当前代码为准重新确认。
7. **取消语义**：取消 watch ≠ 取消任务；要停任务用 dsh_subagent_cancel。
8. **设计类任务给参考文档**：明确列出 docs/android/ 下的相关分篇，agent 能继承已拍板决策，产出质量明显更高。

---

## 6. 附：本次会话涉及的工具调用统计

- dsh_subagent_run ×10（async 8 + sync 2）
- dsh_subagent_watch ×7、dsh_subagent_status ×8、dsh_subagent_cancel ×2
- 独立会话成功数：5（session-b6ae57ce / 5fd76dc5（表格）/ c7514e22 / 3a01aabe）
- 串号会话：session-5fd76dc5 被 3 个任务共享
- 总 token 消耗（估算）：~95 万（含推理），缓存命中率 93-98%

---

# 附录 A：2026-08-16 修复后复测（用户反馈"DSH 问题几乎都修复了"）

> 复测背景：用户告知 DSH 侧已修复并发/会话问题，Operit 重新派任务验证修复效果。

## A.0 重要更正（2026-08-16 第二次复查）

- **"空结果 = 失败"的判断是误判**：`dsh-msupill4-g6svmu`（done 但 steps:0）与 `dsh-msupay22-6rmwfl`（曾被 cancel）的**完整答案其实都写入了日志文件**：
  - `/storage/emulated/0/Download/Operit/dsh_subagent_jobs/out/dsh-msupill4-g6svmu.log`（H1-H9 全量核验，238 行）
  - `/storage/emulated/0/Download/Operit/dsh_subagent_jobs/out/dsh-msupay22-6rmwfl.log`（295 行，含修正细节）
- **根因**：status/watch 接口的 `answer` 字段未同步（`buffered:false`、`sessionMatched:false`），但 **DSH 进程实际执行完成并落盘日志**。修复后任务执行已正常，只是状态回传仍有 gap。
- **新排障手段**：遇到 `status:done` 但 `steps:0/answer:null` 时，**先读 `out/<taskId>.log` 再下结论**，不要直接判失败重跑（浪费 token）。

## A.1 复测任务清单

| # | 任务 | taskId | 模式 | 结果 |
|---|---|---|---|---|
| 1 | 手势/滚动/新建按钮三问题（补跑上次失败的） | dsh-msup2isb-4lz9qw | async | ✅ **成功**（30 步/29 次 bash，独立会话 session-1313911c，根因+修复方案完整） |
| 2 | H1-H9 逐条验证（完整版） | dsh-msupay22-6rmwfl | async | ✅ **实际完成**（曾被 cancel；答案在日志，295 行，含 H3/H2 细节修正） |
| 3 | H1-H9 逐条验证（重试） | dsh-msupill4-g6svmu | async | ✅ **实际完成**（status 显示 done 但 0 步；答案在日志，238 行，质量高） |
| 4 | H1-H4 验证（拆小 + sync） | dsh-msupqjhw-bcx0xb | sync | ❌ **exit 130**（SIGINT，shell 状态混乱，30s 即失败；sync 仍不可靠） |

## A.2 复测结论

1. **单任务（间隔充足）可以正常工作**：任务 1 成功且质量高（发现 `content-visibility: auto` 导致首帧 scrollHeight 低估的新细节，比 Operit 自己分析更完整）。
2. **任务 2/3 实际执行成功，只是状态回传有 gap**：`status/watch` 的 `answer` 字段未同步（`steps:0/sessionMatched:false`），但答案完整落在 `out/<taskId>.log`。**修复已覆盖会话复用问题，剩余的是状态查询接口的同步缺陷。**
3. **sync 模式仍不可靠**（任务 4 exit 130），一律用 async + watch。
4. **新经验**：status 显示 done 但 0 步时，先读日志文件再判成败；Operit 此前"失败后放弃重试"的判断在本例中错失了已完成的结果，应修正为"先查日志"。

## A.3 修复后使用建议（更新版）

- ✅ **可以放心派单任务**：跑完一个（等 status 显示 done 且 steps>0、answer 非空）再派下一个。
- ❌ **仍不要并发**；❌ 连续快速派第二个任务风险高（间隔建议 >1 分钟并先 dsh_subagent_list 确认无 running）。
- ⚠️ **失败识别**：done 但 `steps:0/tokens:{}` 或 `sessionMatched:false` = 空跑失败，重试前先 cancel + 确认无遗留进程。
- ⚠️ **sync 模式仍不可靠**（本次第三次 sync 失败），一律用 async + watch。
- 💡 **小任务不如自己干**：明确到行号的验证类任务（如"确认某文件某行是否有某校验"），Operit 直接 grep 通常比 DSH 快 10 倍（本次 H 验证：DSH 两次失败浪费 ~15 分钟，grep 全程 ~3 分钟）。

## A.4 H 级漏洞验证最终结果（DSH 日志核验 + Operit 复核，供修复排期）

| # | 结论 | 证据（DSH 日志确认） | 说明 |
|---|---|---|---|
| H1 | ✅属实 | auth.ts:96-118 只从 JWT payload 注入 userId/role；auth.ts:199-214 requireAdmin 只比较旧 role；auth.ts:373-390 refresh 用旧 role 续签 | 封禁/降权后旧 token 1 天内仍有效且可续签 |
| H2 | ✅属实 | ws.ts:276-331 只验 JWT 有效 + deviceId 存在；localServices.ts:56-96 信任 X-Device-Id；proxy.ts:47-107 用 URL path deviceId（非 header，细节修正） | 知道 deviceId 可顶掉连接/操作他人本地服务 |
| H3 | ✅部分属实 | webos.ts:993-1055：redirect:follow 后**不复查**是真实 SSRF 洞；但"不识别 IPv6"描述不准确——IPv6 实际全部被拦截（split('.')长度≠4 → return true） | 真洞 = 重定向绕过；IPv6 是过度拦截而非绕过 |
| H4 | ✅属实 | background.ts:31-66 ALLOWED_EXTENSIONS 含 .svg 只验扩展名；index.ts:206-210 公开静态服务无 CSP/nosniff | 恶意 SVG 同源执行 |
| H5 | ✅属实（DSH 补充确认） | index.ts:292-346 只转义 srcDoc，title/menu[].title/sub/icon/bg/href/action 均直接拼接 | 分享落地页存储型 HTML 注入 |
| H6 | ✅属实 | tools.ts:185-219 `PUT /api/tools/:name` 无 requireAdmin；**tools.ts:226-244 POST /reset 也无**；searchKeys.ts:76-113 PUT/DELETE 无 requireAdmin | 任意用户可启用 bash/改全局搜索 Key（DSH 补充发现 reset） |
| H7 | ✅属实（DSH 补充确认） | FreeHtmlComponent.tsx:114、PopupLayer.tsx:355、Workspace.tsx:337/379 dangerouslySetInnerHTML | 产品"自由 HTML"设计但无消毒/沙箱边界 |
| H8 | ✅属实 | piBridge.ts:1694-1737 endpoint 取 apiConfig.endpoint **并改写全局 process.env.PI_API_ENDPOINT**；2040-2047 来自 WS 客户端 | 客户端可指定任意 endpoint 且污染全局；可能 BYOK 设计但边界缺失 |
| H9 | ✅属实（DSH 补充确认） | panels.ts:116-124/238-252/254-292、widgets.ts:13-98/377-475、conversations.ts:11-24 均无 owner 校验 | Panel/Widget/Conversation 越权读写删 |

**9/9 确认（8 属实 + 1 部分属实），0 完全误报；H3 仅 IPv6 描述不准确，H2 proxy 细节修正。**

## A.5 复测涉及工具调用统计

- dsh_subagent_run ×3（async 2 + sync 1）、dsh_subagent_cancel ×1
- 新增成功会话：session-1313911c（任务 1，唯一成功）
- 失败：卡死 1、空结果 1、sync exit130 1

---

# 附录 B：2026-08-16 修复与验证阶段的 DSH 使用记录

> 背景：Operit 完成 5 Critical + 9 High 修复（服务端 13 项 + 前端 5 项）后，用 DSH 做 tsc 编译验证与修复回归审查。

## B.1 任务清单

| # | 任务 | taskId | 结果 |
|---|---|---|---|
| 1 | 服务端+前端 tsc 验证（第一轮） | dsh-msur4cse-8yz7mh | ✅ 成功（日志落盘；发现服务端 4 个 TS 错误，修复后第二轮验证通过） |
| 2 | 服务端+前端 tsc 验证（第二轮） | dsh-msurcozv-6mbyma | ✅ 成功（0 错误，两端通过） |
| 3 | 服务端修复回归审查（18 项清单） | dsh-msuriqqf-2mdg1l | ❌ failed（66s，日志为空） |
| 4 | 服务端修复回归审查（拆小重派） | dsh-msurlncq-esu16g | ⏳ 运行中（step 10/15） |

## B.2 本次遇到的问题与处理

### 问题 1：大任务直接 failed（66s，日志为空）
- **现象**：18 项审查清单（含 12 服务端 + 6 前端）async 派发后 66 秒 failed，`out/*.log` 只有 `nohup: ignoring input`，无任何输出。
- **推测**：任务描述过长（约 2.5KB 中文）+ 审查范围大，DSH 会话初始化或首轮工具调用超时/异常。
- **处理**：拆成「服务端审查」「前端审查」两个小任务重派（描述精简到 1.2KB/个）。
- **经验**：**单任务描述控制在 ~1KB 以内**，审查/分析任务按模块拆分；过大任务易静默失败。

### 问题 2：同 cwd 并发防护（新行为，正面修复）
- **现象**：未 cancel 残留任务直接派新任务时，收到明确报错：
  > 同工作目录已有运行中的 DSH 任务（dsh-msuriqqf-2mdg1l）。DSH headless 同一 cwd 仅支持单个活跃会话，并发会导致结果串号；请先等待其完成，或用 dsh_subagent_cancel 停止后再派新任务。
- **意义**：**串号问题已在调度层修复**——不再静默串号，而是显式拒绝并发。这是附录 A 问题 1 的根治。
- **处理**：dsh_subagent_cancel 残留任务 → 重新派发。
- **经验**：现在可以放心用 DSH 了，但同 cwd 必须串行（工具会强制）。

### 问题 3：tsc 验证任务成功但 status 显示 0 步空结果（延续附录 A.0）
- **现象**：两个 tsc 验证任务 watch 返回 `done/steps:0/answer:null/silent`，但 `out/*.log` 有完整结果（验证通过/错误列表）。
- **处理**：按附录 A.0 经验直接读日志文件。
- **结论**：**status 回传 gap 仍未修复**——「先读 out/<taskId>.log」仍是必要操作。

### 问题 4：watch 被用户取消后任务继续运行
- **现象**：审查任务 watch 被用户取消（User cancelled），但任务进程继续推进（status 显示 step 10/15 正常执行）。
- **处理**：等待自然完成或显式 cancel。
- **结论**：延续附录 A 问题 4，取消 watch ≠ 取消任务。

## B.3 验证结果（供后续参考）

- **tsc 第一轮**：服务端 4 错误（searchKeys.ts:80/108、tools.ts:193/203，`req.params.x` 在带中间件路由下的类型推断 `string|string[]`）→ 用 `String(req.params.x)` 修复 → 第二轮 0 错误。
- **前端 shell-web**：两轮均 0 错误。
- **审查结论**：见 dsh-msurlncq-esu16g 最终输出（运行中，完成后补记）。

## B.4 复测涉及工具调用统计

- dsh_subagent_run ×4（async 4）、dsh_subagent_cancel ×1、watch ×3
- 成功 2（tsc 验证，均需读日志取结果）、运行中 1、failed 1（大任务）

---

# 附录 C：2026-08-16 生产部署（修复后上线）

> 部署方式：DSH sub-agent 执行完整部署脚本（构建→上传→重启→健康检查），全程无 terminal 15s 限制困扰。

## C.1 部署结果

| 步骤 | 结果 | 备注 |
|---|---|---|
| 前端构建 | ✅ 3.62s | `VITE_BASE_PATH=/daily/`，产物 index-43QaqDeF.js / index-R4vq32ym.css + 61 资源 |
| 服务端源码上传 | ✅ 15/15 | auth/entities/scopes/export/import/dynamicWidgets/tools/searchKeys/aiSettings/webos/background/piBridge/afdian/index/middleware-auth |
| 前端产物上传 | ✅ 6 根文件 + assets | 远端 assets 67 个文件（含历史遗留旧资源，无害） |
| 权限修复 | ✅ chmod 644 | |
| pm2 重启 | ✅ online（PID 280619，重启 382 次） | |
| 健康检查 | ✅ 最终 200 | 重启后 3s 检查为 000（服务未就绪）→ 额外等待后 200 |

## C.2 线上验证

- `GET /api/health` → `{"status":"ok"}`（200）
- `GET /daily/` → 页面正常加载（登录态/对话列表渲染正常）

## C.3 部署相关经验（新增）

1. **部署任务适合交给 DSH**：vite build + scp 15 文件 + ssh 重启全程约 203s，terminal 15s 硬超时无法胜任，DSH bash 无此限制。
2. **重启后健康检查要等就绪**：pm2 restart 后 3s 时 curl 返回 `000`（未监听），属正常；建议脚本内 sleep 5-8s 再检查，或重试 3 次。
3. **status 回传 gap 再次出现**：部署任务实际完成（日志完整）但 status 显示 0 步——「先读 out/*.log」仍是唯一可靠取结果方式。
4. **用户两次取消 watch**：取消 watch 不影响任务执行，部署照常完成（附录 A 问题 4 再次验证）。
5. **构建产物 hash 变化**：本次前端有 App.tsx/styles.css 修改，构建产物为新 hash（43QaqDeF.js），旧 hash 文件留在服务器无害，发版后用户刷新即换新。

---

# 附录 D：本次会话 DSH 问题全清单（2026-08-15 23:35 ~ 08-16 20:00）

> 本章汇总整个会话中遇到的所有 DSH 相关问题（含复测/修复/部署三个阶段），
> 按「严重度 × 修复状态」排序，每条给出：现象 / 根因 / 状态 / 规避方法。
> 详细过程见正文 §2、附录 A/B/C。

## D.1 问题速查表

| # | 问题 | 严重度 | 触发场景 | DSH 侧状态 | 规避方法 |
|---|---|---|---|---|---|
| P1 | 并发任务结果串号（3 任务共享同一会话答案） | 🔴 严重 | 同一 cwd 并发派多个 async 任务 | ✅ 已修复（显式拒绝并发） | 同 cwd 串行；工具现在会强制 |
| P2 | 单任务重跑只执行 2 步就 done、无答案 | 🔴 严重 | 前一批任务进程残留时派新任务 | ✅ 已修复（并发防护） | 派新任务前 dsh_subagent_list 确认无 running |
| P3 | sync 模式 exitCode 130（SIGINT） | 🟠 高 | mode=sync 且存在并发/遗留任务 | ✅ 已修复（v0.4.4：sync 改内部后台+轮询直读，不再占终端前台） | sync 可用；仍推荐 async + watch |
| P4 | 取消 watch 后任务继续运行 | 🟡 中 | 用户取消 watch | ⚠️ 设计如此（不是 bug） | 取消 watch ≠ 取消任务；要停用 dsh_subagent_cancel |
| P5 | status 显示 done 但 0 步/空 answer（结果实际在日志） | 🟠 高 | 大部分成功任务 | ✅ 已修复（v0.4.4：readLinuxFile 改直读 + 解析超时 90s + 日志兜底 answer） | status 的 answer 已可靠（含 answerSource 标注来源） |
| P6 | 曾被 cancel 的任务实际完成（日志有完整答案） | 🟡 中 | 任务被 cancel 后进程未及时终止 | ✅ 已修复（v0.4.4：cancelled 任务也返回日志答案） | cancel 后直接 status 即可取到已完成内容 |
| P7 | 大任务（描述 >2.5KB）直接 failed，日志为空 | 🟠 高 | 超长任务描述 + 大审查范围 | ✅ 已澄清（2026-08-16 复查：该任务 code=-2 是被 cancel，非 failed；长描述不会导致静默失败） | 描述仍建议按模块拆分（便于审计与跟踪） |
| P8 | 工作区代码在会话期间被外部更新（公告代码消失） | 🟡 中 | 会话跨时段，工作区被同步/更新 | —（非 DSH 问题） | agent 结论基于当前代码复核，行号重确认 |
| P9 | agent 结论可信度参差 | 🟡 中 | 所有任务 | —（需人工抽查） | 关键行号 grep 验证；High 级以下标待确认 |
| P10 | minimal preset 工具受限（无 Read/Web） | ⚪ 低 | minimal 模式 | —（设计如此） | 审计类任务 bash-only 足够，无需升级 |

## D.2 各问题详情

### P1：并发任务结果串号（最严重，已由 DSH 侧修复）
- **现象**：同一批并发 async 任务（公告/存储/手势/表格），3 个任务返回**完全相同**的 sessionId/steps/tokens/answer（session-5fd76dc5，63 步/62 bash/105418 tokens），全部是表格任务的答案。
- **根因**：DSH headless 同一 `--profile headless` 同一时刻只允许一个活跃会话，后启动任务被附加到已有会话或查询到错误会话。
- **修复状态**：✅ 已修复——现在同 cwd 派第二个任务会被显式拒绝（见 P11），不再静默串号。
- **规避**：同 cwd 严格串行；需要并行分析时改用 Operit 自身 grep/read。

### P2：单任务重跑只执行 2 步就 done、无答案
- **现象**：串号后单独重跑手势任务，只执行了 `pwd && ls && find` 就 done，answer:null，tokens 仅 781。
- **根因**：前一批任务进程未完全清理，占着 headless 会话，新任务被错误复用/立即结束。
- **修复状态**：✅ 已修复（同 P1 的并发防护）。
- **规避**：派新任务前确认无遗留 running；必要时重启 DSH Web 服务。

### P3：sync 模式失败（exitCode 130）
- **现象**：mode=sync 重跑返回 exit 130（SIGINT），输出混杂 nohup 后台启动信息；本次共失败 3 次（不同任务）。
- **根因**：sync 模式与遗留任务冲突，或信号处理问题。
- **修复状态**：⚠️ 未修复。
- **规避**：**永远用 async + watch**；sync 模式不可依赖。

### P4：取消 watch ≠ 取消任务
- **现象**：用户取消 watch（User cancelled）后，后台 nohup 进程继续执行到完成；本次出现 4+ 次（安全审计、审查、部署各阶段）。
- **根因**：watch 只是前端轮询，取消不影响后台任务。
- **修复状态**：⚠️ 设计如此，不是 bug。
- **规避**：确认要停止任务必须调 dsh_subagent_cancel；取消 watch 后可用 status 继续查进度。

### P5：status 回传 gap——done 但 0 步空结果
- **现象**：多数成功任务（tsc 验证 ×3、部署、SSH 检查）watch/status 返回 `done/steps:0/answer:null/silent`，但 `out/<taskId>.log` 有完整结果。
- **根因**：status/watch 接口的 answer 字段未同步（`buffered:false`、`sessionMatched:false`），任务实际执行完成并落盘日志。
- **修复状态**：⚠️ 未修复。
- **规避**：**「先读 out/<taskId>.log 再判成败」是必要操作**；`done + steps:0` 不代表失败，`failed + 日志有内容` 也不代表无结果。

### P6：cancel 后任务实际已完成
- **现象**：dsh-msupay22（H 验证）曾被 cancel，但日志有完整 295 行答案。
- **根因**：cancel 发出时任务已进入收尾，或 kill 未及时生效。
- **修复状态**：⚠️ 视情况。
- **规避**：cancel 后也查一次日志确认是否真的停了再重派，避免浪费 token。

### P7：大任务直接 failed（66s，日志为空）
- **现象**：18 项审查清单（2.5KB 描述）async 派发后 66s failed，日志只有 `nohup: ignoring input`。
- **根因**：任务描述过长 + 审查范围大，会话初始化或首轮工具调用异常。
- **修复状态**：⚠️ 未修复。
- **规避**：**单任务描述 ≤1KB**，审查/分析按模块拆分（服务端/前端分开派）。

### P8：工作区代码在会话期间被外部更新
- **现象**：会话开始时公告代码在 App.tsx/styles.css，几分钟后全 client 目录搜 `announcement` 0 匹配。
- **根因**：工作区被外部同步/更新（非 DSH 问题）。
- **规避**：agent 结论必须基于当前代码复核；行号变化时重确认。

### P9：agent 结论需人工抽查
- **现象**：安全审计 5 Critical 全部复核属实、表格根因复核属实、审查发现 9 个回归点中有 4 个 ❌ 级问题（import 漏鉴权/entities 破坏旧客户端/api-key 破坏 Electron/raw 破坏 iframe）——**agent 审查有效但必须人工复核后才可信**。
- **规避**：关键结论 grep 行号验证；高风险修复必须过一遍回归审查。

### P10：minimal preset 工具受限
- **现象**：只有 bash + str_replace_editor，无 Read/Web 工具。
- **评估**：审计/分析/验证/部署类任务 bash 完全够用，未遇到工具不足障碍。
- **备注**：这不是问题，是省 token 的正确选择。

## D.3 已确认的 DSH 侧改进（本次会话内观察到的正面变化）

1. **同 cwd 并发防护上线**（P1/P2 根治）：派新任务时若已有 running 会显式报错：
   > 同工作目录已有运行中的 DSH 任务（...）。DSH headless 同一 cwd 仅支持单个活跃会话，并发会导致结果串号；请先等待其完成，或用 dsh_subagent_cancel 停止后再派新任务。
2. **buffered 进度提示**：运行中 status 会显示「运行中（DSH 会话缓冲未落盘，进度稍后可见；进程日志见 out/*.log）」——比早期静默好。

## D.4 总结（一句话给下一个执行者）

> **DSH 现在可放心用于单任务（分析/审查/验证/部署），记住三条：① 同 cwd 只派一个任务（工具会强制）；② v0.4.4 起 status/watch 的 answer 已可靠（answerSource 标注来源：session 解析或日志兜底，不必再手动读日志）；③ 长任务描述按模块拆分便于跟踪；sync 已修复（v0.4.4），但推荐 async + watch。**
