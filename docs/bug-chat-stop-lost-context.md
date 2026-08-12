# Bug 排查记录：AI 任务中途卡住 + 点「停止」后上下文丢失（2026-08-11）

> 状态：**排查中（根因已定位，修复方案待用户确认）**
> 本文件只记录问题现象、证据链、观察与想法；**解决方案待修复完成并经用户同意后补充**（见 §9，当前留空）。
> 记录规范参照 docs/bug-duplicate-chat-request.md。

---

## 1. 现象（用户报告，2026-08-11）

用户（站长，`2893334965@qq.com`，user key `user:fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6`）报告：

1. 给 AI 发送一个任务后，AI 不断调用工具，然后**突然卡住**——连"工具调用情况实时显示的那个数字"都不再跳动。
2. 此时刷新页面，页面上的意思**似乎是任务已经完成了**（AI 没有继续加载，发送框旁按钮是「发送」而不是「停止」）。
3. 此时再发一条消息，会**弹出卡片「上一条消息仍在后台处理」**，发送框按钮变成「停止」。
4. 点击「停止」之后，再给 AI 发消息，**AI 完全不记得之前的事情（完全没有上下文）**。

用户明确诉求：
- 正常不应该卡住；
- 「后台运行」的消息卡片应该删掉（不应残留）；
- 上下文丢失说明**可能直接把会话记录删掉了 / 擅自篡改了 pi 会话**——本来一段可以直接继续的内容不该被改得稀碎。

## 2. 证据链（2026-08-11，线上真实用户操作）

### 2.1 webos_chat_logs 表（对话落库）

会话 `conv-1786088818503-kiz544`（今天 07:47-07:53）：

```
created_at        | request_id | role      | content            | total_tokens | status
1786088998910     | 1853b898   | user      | ？                 | 0            | ok        ← 卡住的那条
1786089200496     | 4ff4d671   | user      | 现在什么情况        | 1728         | ok
1786089200497     | 4ff4d671   | assistant | 一切正常，给你汇报下现状… | 1728      | ok
```

关键疑点：
- 「？」这条 **0 tokens、status=ok、无 assistant 回复落库**，且 ip 为空（其他记录 ip=::ffff:127.0.0.1）；
- 「？」与下一条「现在什么情况」**间隔 201 秒**；
- **「做一个旅行清单 App」这条 user 消息没有落库**（按代码 disconnected 分支应落库，原因待查，见 §6 疑点 D）。

### 2.2 pm2 日志（服务端完整时间线）

```
07:47:54.570  chat req     req=10d54027  conv=...kiz544  n=1  users=[做一个旅行清单 App]
07:47:54.631  chat prompt start         req=10d54027  userTextLen=11
07:47:54.633  chat first pi event       req=10d54027  agent_start
07:49:16.789  chat onClose               req=10d54027  ended=disconnected inflight=kept   ← 用户刷新
07:49:48.645  chat req     req=1853b898  conv=...kiz544  n=3  gap=114075ms  users=[做一个旅行清单 App | ？]
07:49:48.650  chat prompt start          req=1853b898  userTextLen=1
07:49:48.651  pi session busy            req=1853b898  waiting=2s   ← error.log 7459
07:49:49.458  chat first pi event        req=1853b898  message_start  ← busy 等待期间收到旧任务事件（只打日志，不转发）
07:49:50.360  chat first pi event        req=1853b898  message_update
07:49:50.676  pi session busy            req=1853b898  waiting=4s   ← error.log 7460
07:49:52.678  pi session busy            req=1853b898  waiting=6s   ← error.log 7461
07:49:54.494  agent_end                  req=10d54027  stop=aborted err=Request was aborted usage=0  ← 任务被中断！
07:49:54.497  chat cancelled             scope=... conv=...kiz544 sessions=1              ← 用户点「停止」
07:49:54.498  chat prompt done           req=10d54027  usage=0 disconnected=true            ← 任务收尾（白跑）
07:49:54.679  chat prompt start          req=1853b898  userTextLen=1                        ← 第 4 次重试
07:49:58.892  chat prompt done           req=1853b898  usage=null disconnected=false events={} ← 幽灵空返回
07:49:58.910  chat done sent             req=1853b898  totalTokens=0 cost=0                  ← 前端收到空回复
07:53:01.175  chat req     req=4ff4d671  conv=...kiz544  n=4  users=[做一个旅行清单 App | ？ | 现在什么情况]
07:53:01.178  [PiBridge] webos session   conv-1786088818503-kiz544:medium 创建                ← 重建全新会话！
07:53:20.456  agent_end                  req=4ff4d671  contentLen=942 stop=stop usage={input:1233, output:495}
```

### 2.3 代码证据（server/src/routes/webos.ts，线上与本地一致，md5 5dc7923b）

- `POST /chat/cancel`（行 4820-4831）：`abortWebosSessions` + **`disposeWebosSessions`** + `clearTaskBuffer` + 清 in-flight 标记；
  注释声称"会话上下文不丢——前端下次请求会携带完整对话历史，服务端重建会话（与 rebuild 语义一致）"；
- 但 `chat/stream`（行 4215-4223）：非 rebuild 请求 `userText = lastUser.content`（只取**最后一条 user 消息**），`historyContext` 仅 `rebuild=true` 时注入（行 4218）——**注释与实现不符**；
- `piBridge.ts createWebosSession`（行 2251-2282）：按 `webos:${scope}:${conversationId}:${thinking}` 缓存，`disposeWebosSessions`（行 2285-2293）删除并 `s.dispose()`——**pi 会话内部历史随之销毁**；
- `runPiPrompt`（行 1526-1541）+ `piLastActivityAt`（行 1522）：**模块级全局变量**；
- `chat/stream` busy 分支（行 4716-4753）：busy 时 `waitingForBackground=true` + 每 2s 重试（最多 90 次），**不 dispose、保留上下文**——正确；
- 前端 `store.ts recoverBackgroundTask`（行 1529-1599）：`isInterrupted` 判定要求最后一条是空占位/notice/error 才恢复——**AI 已有部分文本输出时不恢复**；
- 前端 `store.ts stopStreaming`（行 1517-1527）：abort + cancelChat，**不清 `backgroundTask` 卡片**；
- 前端 `store.ts runConversationTurn`：`busy_waiting` 事件创建 `backgroundTask` 卡片（行 770-804）；`done` 事件清卡片（行 887）。

## 3. 已排除的路径

- **前端断流自动重试**：本次「？」请求 `disconnected=false`，不是断流重试路径；
- **服务端重复请求拦截（409）**：本次无 CHAT_DUPLICATE_* 日志；
- **多会话并行冲突**：本次全部请求都在同一会话 `conv-1786088818503-kiz544`，无第二个会话在跑；
- **空闲超时（180s）误杀**：本次任务 07:47:54 开始，07:49:54 被 abort（正好 120s），未被空闲超时中断；
- **DeepSeek API 异常**：07:53:01 的请求正常完成（stop=stop），API 本身健康。

## 4. 观察与想法（根因假设链）

> 以下为排查过程中的观察与假设，已用日志逐一验证，标注【已确认】/【待验证】。

### 4.1 【已确认】"上下文丢失"的直接原因：/chat/cancel 的 disposeWebosSessions

1. 用户点「停止」→ 前端 `stopStreaming` → `POST /chat/cancel`；
2. 服务端 `disposeWebosSessions(principal.key, conversationId)` **销毁 pi 会话（含全部对话历史）**；
3. 下次请求 → `createWebosSession` 重建**全新空会话**（日志 07:53:01.178 实锤"webos session 创建"）；
4. 非 rebuild 请求 `userText` 只取最后一条 user 消息 → **历史从未注入** → AI 完全失忆。

**核心矛盾**：`/chat/cancel` 注释声称"下次请求带完整历史重建（与 rebuild 语义一致）"，但代码里非 rebuild 请求根本不注入历史。这是 2026-08-08 修复"按停止不生效"时引入的隐患（当时为了立即停任务加了 dispose，注释是错的）。

### 4.2 【已确认】"AI 记得旅行清单"的假象：现场重新调查，不是记忆

07:53:01「现在什么情况」回复能说出旅行清单 App，是因为该请求 `tool_execution_start=19`（AI 现场调了 19 个工具查系统文件/工作区），不是上下文记忆。若问"我刚才让你做了什么"则答不上来。

### 4.3 【已确认】"卡住"的体验：长任务无进度反馈 + 前端不恢复后台任务

- AI 生成 App 阶段（工具全部执行完，进入长 HTML 输出）对话内无任何数字/进度更新 → 用户误判"卡住" → 刷新；
- 刷新后 `recoverBackgroundTask` 的 `isInterrupted` 判定过窄（AI 已输出部分文本 → 不恢复）→ 用户看到"任务已完成"假象（按钮是发送）；
- 用户发「？」→ 服务端会话忙 → busy 排队（error.log 3 次实锤）→ 前端弹"上一条消息仍在后台处理"卡片 + 按钮变停止；
- **此时任务其实还在正常推进**（07:49:16-07:49:54 持续有 message_update），再等几秒就完成了——用户点停止恰好把它掐死。

### 4.4 【已确认】幽灵空回复：busy 等待中的请求在会话被 dispose 后继续用旧 session

- 07:49:54.497 dispose 之后，「？」请求第 4 次重试仍用旧的 `session` 变量（for 循环内未重新获取）；
- 已 dispose 的 session `prompt()` 立即空返回 → `prompt done usage=null events={}` → `done sent totalTokens=0`；
- 前端收到空 done → 显示"连接中断，未收到 AI 回复"假象。

### 4.5 【已确认】卡片残留：前端 stopStreaming 不清 backgroundTask

- `busy_waiting` 创建卡片；`done` 清卡片；
- 用户点停止 → abort → fetch 中断 → done 到不了前端 → 卡片无人清理；
- `stopStreaming` 只 abort + cancelChat，没有 `setState({ backgroundTask: null })`。

### 4.6 【待验证】piLastActivityAt 全局变量隐患

- `runPiPrompt` 的空闲超时检查模块级全局 `piLastActivityAt`；
- 多会话并行时 A 会话的活动会刷新 B 会话的空闲计时 → B 卡住的请求永不超时；
- 本次只有一个会话，未触发；属隐患，需在修复时一并处理（per-request 计时）。

### 4.7 【待验证】「做一个旅行清单 App」未落库

- 10d54027 在 07:49:54 被 abort，`prompt done disconnected=true` 后走 disconnected 分支应落库 user 消息（status='ok'），但 DB 无此记录；
- error.log 无 `recordChatLog failed`——落库代码可能未执行或异常被外层吞掉；待复查（不影响主根因，属次要问题）。

## 5. 受影响范围

- 任何"任务进行中点停止 → 继续对话"的用户都会遇到上下文丢失（确定性复现）；
- 触发成本低：任务稍长（做 App/生图/多轮工具）→ 用户感觉卡住 → 刷新 → 发消息 → 弹卡片 → 点停止 → 失忆；
- 线上当前所有用户均可踩中；站长本人已踩中。

## 6. 修复思路（方向，未实施）

> ⚠️ 用户要求：解决方案暂不写入本文档，待修复完成并经用户同意后补充到 §9。

- 停止操作不应销毁 pi 会话（abort 保留上下文；工具阶段任务后台收尾，记忆不丢）；
- busy 循环每次迭代重取会话（防幽灵空回复）；
- done 前空回复检测；
- 前端停止时清卡片；恢复判定放宽；
- 空闲计时 per-request。

## 7. 待办

- [ ] 用户确认修复方案；
- [ ] 实施服务端 + 前端修复（见 §6 方向）；
- [ ] 本地/线上回归验证（复现步骤：发长任务 → 中途刷新 → 发消息 → 点停止 → 问"我之前让你做什么"应能答出）；
- [ ] 补充 §9 解决方案记录（用户同意后）；
- [ ] AGENT.md 追加本次修复记录。

---

## 9. 解决方案（待补充——用户同意后填写）

（留空：用户要求修复完成并同意后再记录。）
