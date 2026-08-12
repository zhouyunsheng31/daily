# Bug 排查记录：AI 消息重复发送（2026-08-11）

> 状态：**已修复（2026-08-11）**——根因 = `runConversationTurn` 重试循环成功路径缺 `break`（§8）；
> 主修复 + 服务端 5s 窗口防御 + 前端 409 优雅处理 + 入口诊断日志已全部落地，见 §9。
> 本文件记录该 bug 的全部排查过程、证据、已排除路径与待办，供后续排查接力。

---

## 1. 现象

用户（站长，`2893334965@qq.com`，user key `user:fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6`）在真实手机（魅族 Lucky 08，Android 15）上发一条消息（如「你好」），**服务端收到两条完全相同的 `POST /webos/api/chat/stream` 请求**：

- 两个不同的 requestId
- 第二条在第一条的 `done` 事件发出后约 **122ms** 到达
- 第二条 `n=1`（只含用户消息，**不含历史上下文**）、`rebuild=false`
- 服务端日志标记 `SAME`（与上一条内容相同）但 `dup=no`（未被去重拦截）
- `disconnected=false`（客户端连接正常，不是断流重试）

结果：AI 回复两次、token 双倍扣费（第一次 2751 tokens + 第二次 162 tokens）。

用户报告「两个浏览器都测出来有问题」。

## 2. 证据链（2026-08-11 复现，真实用户操作）

### 2.1 webos_chat_logs 表（对话落库，本次排查的最大功臣）

```
conversation_id            | request_id | role      | content            | total_tokens
conv-1786079192428-e8b297  | 4a09646f   | user      | 你好                | 2751
conv-1786079192428-e8b297  | 4a09646f   | assistant | 你好呀！我是这个系统的 AI... | 2751
conv-1786079192428-e8b297  | 1978880d   | user      | 你好                | 162
conv-1786079192428-e8b297  | 1978880d   | assistant | 你好呀！我在呢 😊...       | 162
```

同一会话、同一内容、两个 requestId → 前端真实发出了两次请求（不是服务端内部重复）。

### 2.2 pm2 日志（服务端视角完整时间线）

```
05:06:35.772  chat req    4a09646f  conv=...e8b297  n=1  rebuild=false  gap=-1ms  diff  dup=no  users=[你好]
05:06:49.751  chat done   4a09646f  totalTokens=2751  cost=0              ← 第一次完成
05:06:49.873  chat req    1978880d  conv=...e8b297  n=1  rebuild=false  gap=14101ms  SAME  dup=no  users=[你好]
                                                                          ← done 后 122ms 又来一条！
05:06:51.963  chat done   1978880d  totalTokens=162  cost=0
```

关键数字：
- `gap=14101ms` = 第一次请求发出到第二次请求到达的间隔（约等于第一次请求总耗时 13.98s + 122ms）
- 第二次请求在 `chat done sent`（4a09646f）之后 **122ms** 到达

### 2.3 nginx access log（排除双浏览器）

```
120.235.227.195 [07/Aug/2026:13:06:49] "POST /webos/api/chat/stream HTTP/2.0" 200 4597 "https://shadowshub.xyz/daily/" "Mozilla/5.0 (Linux; Android 15; MEIZU Lucky 08 ... wv) ... Chrome/140 ... Mobile Safari/537.36"
120.235.227.195 [07/Aug/2026:13:06:51] "POST /webos/api/chat/stream HTTP/2.0" 200 1254 "https://shadowshub.xyz/daily/" "Mozilla/5.0 (Linux; Android 15; MEIZU Lucky 08 ... wv) ... Chrome/140 ... Mobile Safari/537.36"
```

- 同一 IP、同一 UA（`wv` = WebView）、同一 Referer → **不是双浏览器/多标签页**，是同一页面实例发出两次请求

### 2.4 执行日志（execution.log）

第一次请求期间 AI 的工具调用全部是 `read`（skills/myself 记忆）+ `agent_fs_list`，**没有 `show_interactive_html`** → 排除互动 HTML iframe 回传路径。

---

## 3. 已排除的路径（前端代码逐条审查）

### 3.1 断流自动重试 —— 排除
`store.ts` `runConversationTurn` 中自动重试只在 `attempt === 0 && !abort.signal.aborted && !receivedAny` 时触发（收到任何 SSE 事件后不重试）。本次第一次请求收到了完整 `done`，`receivedAny=true`，不会走重试分支。

### 3.2 recoverBackgroundTask —— 排除
只 `GET /chat/background` 查询后台任务并渲染事件，不发送新消息。hydrate 身份不变分支也会调用它，但无副作用。

### 3.3 AI 会话标题生成 —— 排除
`generateConversationTitle` 走 `POST /webos/api/chat/title`（独立端点），不是 chat/stream。

### 3.4 互动 HTML 回传 —— 排除
`App.tsx` 的 `window message` 监听只在 `payload.type === 'interactive_answer'` 且 `event.source` 是 `.chat-html-frame` 时触发 sendMessage。本次对话无 show_interactive_html，无该 iframe。

### 3.5 hydrate 恢复 draft 自动提交 —— 排除
hydrate 只在「身份变化」分支恢复 `draft`（`nextKey !== chatScopeKey(prevSession)`）；身份不变（refreshBootstrap 场景）不恢复 draft，不会自动提交。

### 3.6 服务端 inflight 去重 —— 存在但不覆盖此场景
`chatInFlight` 标记在任务真正结束（done/failed/catch）时删除。第二次请求到达时第一次已 done、标记已清 → `dup=no` 不拦截。**这是设计行为**（完成后允许再次发送相同消息），但恰好给此 bug 留了窗口。

---

## 4. 最可疑方向（未验证）

### 4.1 Android WebView IME Enter 事件重放 / form submit 双触发
- 发送按钮是 `<form onSubmit={submit}>` 里的 `type="submit"`；textarea 无 Enter 拦截
- Android WebView（魅族 `wv`）软键盘 Enter 已知有重复触发 form submit 的行为（keydown + IME composition 时序问题）
- 但两次请求间隔 14s（done 后 122ms）不像单纯双击——**更像「第一次提交 → 生成期间第二次 submit 被缓冲/延迟 → done 后 streamingConvs 删除 → 缓冲的 submit 才执行 sendMessage」**

### 4.2 sendMessage 无防抖 + streamingConvs 时序窗口
- `sendMessage` 本身没有防抖（连续调用两次都会各自发请求）
- `runConversationTurn` 的防重入检查 `if (streamingConvs[convId]) return` 只在**正在生成期间**有效；`finally` 中删除标记后，任何残留的 submit 事件都会放行
- 若 WebView 在第一次 submit 后还有第二个 Enter 事件排队（IME 延迟派发），且恰好到 done 后才执行 → 复现本 bug

### 4.3 第二次请求 `n=1`（无历史）的疑点
正常 sendMessage 会 `buildSendMessages(conv.messages)` 带上历史（至少 2-3 条）。`n=1` 说明**发送时前端认为该会话没有历史消息**——与「残留 submit 重放」吻合（若提交来自 draft 残留而非正常会话状态）。

---

## 5. 待办（按优先级）

### 5.1 服务端防御（可独立完成，先止血）
- [ ] chat/stream 增加「done 后短窗口（如 5s）内、同会话、同 thinking、最后 user 内容相同」的重复请求拦截（`CHAT_DUPLICATE_RECENT`，409），避免双倍扣费
- [ ] 拦截时记录完整日志（requestId 对、时间差），方便统计触发频率

### 5.2 前端诊断（需要复现时抓 console）
- [ ] `sendMessage` 入口加诊断日志：调用来源（submit / interactive_answer / 其他）、draft 值、当前 streamingConvs 状态、会话消息数
- [ ] form submit 加防抖（同内容 1-2s 内忽略第二次）
- [ ] 验证 textarea Enter 处理（Android IME 兼容）

### 5.3 复现与确认
- [ ] 让用户在真实 WebView 复现，抓浏览器 console（store.ts 已有 `[chat] stream request / sse done / stream ended` 日志）
- [ ] 复现后根据前端 console 确认触发来源（submit 还是 message 事件）

---

## 6. 排查时间线

| 时间 | 动作 | 结果 |
|---|---|---|
| 08-07 上午 | 查用量日志（webos_ai_usage），用户问「看数字能看出 bug 吗」 | 只有 token 统计，无法看内容 |
| 08-07 | 确认服务端不落库对话内容 → 用户决策「查 bug 必须查对话记录」 | 新增 `webos_chat_logs` 表 + `GET /api/admin/webos/chat-logs` 接口（已上线） |
| 08-07 | Playwright 测试（第一次带 resp.text()） | 误报重复（工具干扰 SSE 流）→ 已澄清 |
| 08-07 13:06 | **用户真实复现** | 拿到完整证据链（见 §2） |
| 08-07 | 前端代码逐条审查（§3） | 排除 6 条路径，根因未定位 |
| 08-07 | 记录本文档 + AGENT.md | 待办 5.1-5.3 |

---

## 7. 教训

1. **对话内容落库是排查这类问题的前提**——没有 `webos_chat_logs`，这个 bug 只能靠猜
2. Playwright 测试工具本身可能干扰 SSE 流（`resp.text()` 消费响应体 → 前端误判断流 → 触发自动重试），**验证前端行为必须避免消费流**；真实环境（WebView/IME）的行为无法完全用 headless 模拟
3. 服务端 in-flight 去重只管「处理中」，不管「完成后的短窗口重复」——防御要覆盖到 done 之后

---

## 8. 根因定位（2026-08-07 复查结论）

> 本节为后续复查新增。**根因已定位**：前端 `runConversationTurn` 的断流重试循环
> **成功路径缺少 `break`**，导致每一次正常完成的对话都会被立即原样重发一次。
> 这不是竞态、不是 IME、不是 WebView 特有行为——是一个确定性的结构性 bug，
> 任何浏览器/设备都能复现（与「两个浏览器都测出来有问题」的报告吻合）。

### 8.1 根因代码

`client/shell-web/src/store.ts` `runConversationTurn`（约 660-941 行）：

```ts
for (let attempt = 0; attempt < 2; attempt += 1) {
  try {
    await streamChat(sendMessages, { model, thinking, conversationId: convId, ... }, {
      signal: abort.signal,
      onEvent: (event) => { receivedAny = true; /* ... */ },
    })
    // ⚠️ 这里没有 break —— streamChat 正常返回后，循环直接进入 attempt = 1，
    //    用闭包捕获的同一份 sendMessages 把同一个请求再发一次
  } catch (error) {
    if (attempt === 0 && !abort.signal.aborted && !receivedAny) { /* 查后台 → recover 或 */ continue }
    streamError = error
    break
  }
}
```

`break`/`continue` 全部在 `catch` 分支里；**成功路径没有任何跳出语句**。
`streamChat` 正常结束（服务端 `done` → `res.end()` → 前端 reader 读到流尾）后，
`attempt` 递增为 1，条件 `< 2` 成立 → 第二次 `streamChat(sendMessages, …)` 立即发出。

已用 Node 最小模拟精确复刻该循环结构验证：一次发送稳定产生 **2 次完全相同的请求**（n=1、同内容）。

### 8.2 与全部证据逐条对上

| 证据 | 解释 |
|---|---|
| 第二条请求 `n=1`（无历史，§4.3 疑点） | 重发的是**闭包捕获的原始 `sendMessages`**（首次发送时构建，n=1），不是重新读会话状态。任何经由 `sendMessage` 的重发都会 `buildSendMessages(conv.messages)` 带上已完成的历史（n≥2）——所以第二次请求**不可能**来自 submit/IME 重放，只可能来自这个重试循环 |
| 第二条在 `done` 后 122ms 到达 | 第一次 `streamChat` 在服务端 `done` 后正常返回，循环**立即**进入 attempt=1，耗时仅为一次 fetch 的建立时间 |
| `SAME dup=no` | 第一次 `done` 时服务端 `clearChatInFlight(inflightKey, 'done')` 已清除在途标记，in-flight 去重自然不拦截（§3.6 的窗口被这个路径稳定踩中） |
| `disconnected=false` | 两次请求都是客户端主动发起、正常完成，无断连 |
| 两个浏览器都复现 | 确定性前端 bug，与设备/IME/浏览器无关 |
| 第一次 2751 tokens（带工具）、第二次 162 tokens（简短二次应答） | 第二次是在同一 pi 会话上下文里对同一条消息再推理一次，AI 给出「你好呀！我在呢 😊」式的简短重复应答 |
| 前端 UI 无异常感知 | 第二次请求的 SSE 事件追加到**同一条 assistant 消息**的 segments（同一 conv 的最后一条），用户只感知为回复异常/扣费快 |

### 8.3 为什么此前 §3.1 把「断流自动重试」排除了——那个推理是错的

§3.1 的推理是：「第一次请求收到了完整 `done`，`receivedAny=true`，不会走重试分支」。
这只检查了 `catch` 里的重试条件，**漏看了成功路径根本没有 `break`**——
循环不经过 `catch` 也会再跑第二轮。`receivedAny` 这个变量只保护 catch 分支，对成功路径毫无作用。

同理，§4.1/§4.2 的 IME/双提交假说可以**正式排除**：任何重新执行 `sendMessage` 的路径
都会读到完成后的会话历史（n≥2），无法产生 n=1 的第二条请求。

### 8.4 时间线吻合

重试循环是 2026-08-06 引入的（代码注释「2026-08-06 network error 兜底」），
首次确认复现是 08-07 13:06——引入次日即被发现。

### 8.5 影响面评估（重要）

这不是偶发竞态，而是**每一次成功对话都会确定性重发一次**：

- 自 2026-08-06 起，所有用户（所有浏览器）的每条消息都被处理两次、**双倍扣积分**；
- 修复上线后应统计 `webos_ai_usage` / `webos_chat_logs` 中同 `conversationId` 同内容
  成对记录（两个不同 `request_id`）的规模，评估是否需要对受影响用户补偿积分；
- 第二次请求也真实消耗了 DeepSeek API 费用。

### 8.6 修复方案（按优先级，给执行者）

> ✅ **2026-08-11 已全部落地**（见 §9）。以下为当时的方案原文，保留供追溯。

**主修复（必须，一行）**——`client/shell-web/src/store.ts` `runConversationTurn` 重试循环，
`await streamChat(...)` 成功返回后立即跳出循环：

```diff
       await streamChat(sendMessages, {
         model: ai.model,
         thinking: ai.thinking,
         conversationId: convId,
         rebuild: opts?.rebuild,
       }, {
         signal: abort.signal,
         onEvent: (event) => { /* ... 保持不变 ... */ },
       })
+      // 成功完成即退出重试循环——否则循环会进入 attempt=1 把同一请求原样重发
+      // （2026-08-07 定位的消息重复发送根因，见 docs/bug-duplicate-chat-request.md §8）
+      break
      } catch (error) {
```

**防御性加固（强烈建议一并做，防止任何未知客户端路径再次造成双倍扣费）**：

1. **服务端 done 后短窗口拦截**（原 §5.1 待办，仍然有效）：`server/src/routes/webos.ts`
   增加 `recentChatDone` Map（key 同 `inflightKey`，value `{ at, content }`），在
   `clearChatInFlight(inflightKey, 'done')` 与 `'bg-finished'`（仅 `!failed`）处登记；
   请求入口在现有 in-flight 检查之后增加：`!rebuild` 且 5s 窗口内同会话同 thinking
   同内容 → `409 CHAT_DUPLICATE_RECENT`（记完整日志：requestId 对、距 done 毫秒数）。
   注意豁免 `rebuild=true`（编辑/回退重来会合法地在 done 后立即重发相同内容）。
2. **`streamChat` 透传服务端错误码**（`client/shell-web/src/api.ts`）：
   现在 `!response.ok` 时硬编码 `throw new WebOsApiError(status, 'WEBOS_CHAT_FAILED', message)`，
   丢失了服务端的 `error.code`；改为解析 `payload.error?.code` 透传，
   否则前端无法区分 `CHAT_DUPLICATE_INFLIGHT/RECENT`。
3. **前端优雅处理 409**（`store.ts` `runConversationTurn` catch 最前面）：
   `error instanceof WebOsApiError && error.status === 409` 时——撤销本次乐观添加的
   「user 消息 + 空 assistant 占位」（恢复到最后一条已完成消息，不要显示错误卡片，
   因为第一次的回复已经在对话里），`CHAT_DUPLICATE_INFLIGHT` 再调
   `recoverBackgroundTask(convId)`；然后 `return`（finally 照常清理）。
4. **`sendMessage` 入口诊断日志**（原 §5.2）：调用来源（content 参数/draft）、convId、
   会话消息数、`streamingConvs` 状态、text 前 30 字——以后任何重复发送问题可直接
   从 console 定位触发源。

### 8.7 修复后验证清单

1. **代码审查**：确认成功路径有 `break`，循环对一次成功对话只执行一次。
2. **单元级模拟**：用 stub `streamChat` 复刻循环（本结论已做过：修复前稳定 2 次请求，
   修复后必须恰好 1 次）。
3. **本地真实链路**：起本地服务 + 真实 DeepSeek，发一条「你好」→ pm2/服务端日志
   应只有**一条** `chat req`、一条 `chat done`；`webos_chat_logs` 只有一对
   user/assistant 记录；积分只扣一次。
4. **断流回归不能坏**：模拟「连接建立前失败」（断网后发消息）→ 仍应自动重试一次
   （catch 里 `continue` 路径不受影响）；模拟「收到事件后断流」→ 不重试、走后台恢复。
5. **编辑/回退重来回归**：`regenerateAt` / `editMessageAt`（rebuild=true）正常工作，
   不被服务端 409 误拦。
6. **线上观察**：部署后观察 `chat req ... SAME` 日志对是否消失；
   抽查 `webos_chat_logs` 不再出现同 conv 同内容双 request_id。

---

## 9. 修复落地记录（2026-08-11）

### 9.1 主修复（根因）

`client/shell-web/src/store.ts` `runConversationTurn`：`await streamChat(...)` 成功返回后
立即 `break` 退出重试循环（此前成功路径无跳出语句，attempt 递增为 1 后用闭包捕获的同一份
`sendMessages` 原样重发一次——n=1、done 后 ~百 ms 到达、双倍扣费）。

### 9.2 防御性加固

| # | 位置 | 内容 |
|---|---|---|
| 1 | `server/src/routes/webos.ts` | 新增 `recentChatDone` Map + `markChatRecentDone()`；`done` 与 `bg-finished`（仅 `!failed`）路径登记「最近完成」；入口在 in-flight 检查后增加 **5s 窗口同会话同 thinking 同内容 → `409 CHAT_DUPLICATE_RECENT`**（`rebuild=true` 豁免），记完整日志（requestId 对、距 done 毫秒数） |
| 2 | `client/shell-web/src/api.ts` | `streamChat` 的 `!response.ok` 分支解析 `payload.error.code` 透传（不再硬编码 `WEBOS_CHAT_FAILED`）——前端可区分 `CHAT_DUPLICATE_INFLIGHT/RECENT`、`TOKEN_INSUFFICIENT` 等 |
| 3 | `client/shell-web/src/store.ts` | `runConversationTurn` 乐观更新前保存 `prevMessages` 快照；catch 最前面处理 `WebOsApiError && status===409`：撤销本次乐观添加（恢复快照，不显示错误卡片），`CHAT_DUPLICATE_INFLIGHT` 再调 `recoverBackgroundTask(convId)`，然后 `break` |
| 4 | `client/shell-web/src/store.ts` | `sendMessage` 入口诊断日志：调用来源（content/draft）、convId、会话消息数、`streamingConvs` 状态、text 前 30 字——今后任何重复发送问题可直接从 console 定位触发源 |

### 9.3 验证结果

- `server npx tsc --noEmit` ✅、`shell-web npx tsc -b --noEmit` ✅、`vite build` ✅
- **单元级模拟**（stub `streamChat` 复刻循环）：修复前成功场景稳定 **2 次**请求（bug 复现）；
  修复后 **恰好 1 次**；「连接建立前失败 → 自动重试一次」场景修复前后均 **2 次**（重试兜底未破坏）
- 代码审查：break 位于 try 内、streamChat 之后、catch 之前；409 分支在断流重试分支之前，
  不干扰既有 retry/recover 逻辑

### 9.4 待部署后线上观察

- pm2 日志不再出现 `chat done sent` 后紧跟同内容 `chat req ... SAME`
- `webos_chat_logs` 不再出现同 `conversation_id` 同内容双 `request_id` 成对记录
- 若出现 `chat dup recent rejected` 日志（5s 窗口拦截触发），说明存在其他未知客户端重复路径，
  结合前端 `sendMessage` 入口日志定位触发源
- 评估受影响用户（2026-08-06 引入重试循环至修复上线期间）的双倍扣费补偿
