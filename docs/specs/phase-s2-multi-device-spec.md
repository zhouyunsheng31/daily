# Phase S2：多端并行改造 — 详细 Spec

> 生成日期：2026-06-27
> 架构依据：[architecture_refactor.md](../architecture_refactor.md) 第三章（3.1-3.4）
> Roadmap：[roadmap_server_v1.md](../roadmap_server_v1.md) Phase S2
> 关联：[phase-s1-ai-context-spec.md](phase-s1-ai-context-spec.md) 第 5.1 节（S1 已为 S2 预留基础设施）
>
> **项目目的**：服务器是 AI 推理 + 数据同步 + 多端协作的中心。S2 让多端不同面板可并行 AI 操作、同面板多端共享思考流、设备断开时正确清理状态，补完 S1 预留但未实现的"同面板多端选举规则 + 无在线设备错误处理 + 定向广播"。

---

## 一、现状分析

> **关键结论**：S2 核心机制（per-panel `activeDeviceId` Map、按面板工具路由、同面板后发消息设备接管）已在 Phase 4 / Phase 8 批次3 随 S1 一起实现。本 Spec 不是从零设计，而是**修复 4 个实质未对齐项** + **顺手修复 1 个 S1 遗留 bug**。

### 1.1 已完成（无需重做）

| 任务 | 现状 | 文件位置 |
|------|------|---------|
| per-panel `activeDeviceId` Map | `panelActiveDevices = new Map<string, string>()` | [piBridge.ts:63](../../server/src/piBridge.ts) |
| 设置面板活跃设备 | `setPanelActiveDevice(panelId, deviceId)` 导出函数 | [piBridge.ts:69-72](../../server/src/piBridge.ts) |
| 工具调用按面板路由 | `executeViaWs` 用 `panelActiveDevices.get(panelId)` 取目标设备 | [piBridge.ts:214-255](../../server/src/piBridge.ts) |
| 多端不同面板并行 | per-panel `panelSessions` Map + `AsyncLocalStorage` 上下文隔离 | [piBridge.ts:131, 346-363](../../server/src/piBridge.ts) |
| 同面板后发消息接管 | 收到 `user_message` 时 `setPanelActiveDevice(effectivePanelId, deviceId)` 覆盖旧值 | [piBridge.ts:996](../../server/src/piBridge.ts) |
| 无在线设备抛错 | `if (!targetDeviceId || !hasDevice(targetDeviceId)) reject(new Error(...))` | [piBridge.ts:221-224](../../server/src/piBridge.ts) |
| `ask_user` 工具按面板路由 | `executeAskUser` 用 `panelActiveDevices.get(panelId)` | [piBridge.ts:301-307](../../server/src/piBridge.ts) |
| panel 删除联动清理 | `disposePanelSession` 清理 `panelActiveDevices.delete(panelId)` | [piBridge.ts:102](../../server/src/piBridge.ts) |
| WS 协议携带 `panelId` | `tool_call` / `pi_event` / `session_ready` / `error` / `ask_user` 均含 `panelId` 字段 | [ws.ts:43-51](../../server/src/ws.ts) |
| 客户端按 `panelId` 过滤 | 桌面端 `useAIStore` 已实现面板过滤 | `client/desktop/src/stores/useAIStore.ts` |

### 1.2 四个实质未对齐项（本 Spec 修复目标）

#### 缺口 A：AI 思考流未定向广播到该面板所有在线设备（**P0 路由正确性 + 带宽浪费**）

**问题**：[piBridge.ts:843-848](../../server/src/piBridge.ts) 的 `forwardEventToClient` 调用 `broadcast({ kind: 'pi_event', ..., panelId })`——**广播到所有在线设备**（不区分面板），客户端按 `panelId` 过滤。

**roadmap 要求**（[roadmap_server_v1.md:101](../roadmap_server_v1.md)）：
> AI 思考流广播到该面板所有在线设备

**当前后果**：
- 设备 A 在 panel-X 对话，设备 B 在 panel-Y 对话时，A 的 `pi_event` 会发到 B（虽然 B 客户端会过滤）
- 网络带宽浪费：N 个设备 × M 个面板 = 流量放大 N×M 倍
- 调试困难：日志看到所有设备都收到所有面板的事件
- **本质问题**：服务器不知道哪些设备"当前正在查看该面板"，只知道"最后发 user_message 的设备"

**客户端现状（关键约束，来自对抗审查）**：
- 桌面端 `useAppStore.setActivePanel`（[useAppStore.ts:1182-1280](../../client/desktop/src/stores/useAppStore.ts)）切换面板时**不发任何 WS 消息**，仅调 HTTP API 同步 activePanelId
- 桌面端 `useAIStore.deleteSession`（[useAIStore.ts:1178-1194](../../client/desktop/src/stores/useAIStore.ts)）只在**用户手动删除会话**时发 `dispose_session`
- **客户端切换面板时不通知服务器**，服务器无法得知设备"当前查看哪个面板"

**修复方案（基于客户端现状的最小改动）**：
- 新增 `panelOnlineDevices: Map<panelId, Set<deviceId>>` 追踪设备-面板在线关系
- 设备发 `user_message` 时，加入该 panel 的在线设备集合，**同时清理该设备在其他面板的在线集合 + activeDevice 映射**（解决"设备切换面板后旧面板状态残留"问题，详见 2.1.8）
- 设备发 `dispose_session` 时，从该 panel 的在线设备集合移除（仅用户主动删除会话场景）
- 设备 WS 断开时，从所有 panel 的在线设备集合移除
- `forwardEventToClient` 改为**按面板定向广播**：只发到 `panelOnlineDevices.get(panelId)` 中的设备
- 兼容性：保留 `pi_event.panelId` 字段，让旧客户端仍能过滤（向后兼容）
- **已知限制（明示）**：设备纯查看面板不发消息时，服务器无法得知设备当前查看哪个面板；依赖客户端按 `panelId` 过滤作为兜底。这是客户端架构决定的限制，不在 S2 服务器端 spec 范围内修复

#### 缺口 B：设备断开时未清理 `panelActiveDevices`（**P1 内存泄漏 + 调试困难**）

**问题**：[piBridge.ts:1064-1069](../../server/src/piBridge.ts) 的 `onClientDisconnect(deviceId)` 仅记录日志，**不清理 `panelActiveDevices` 中以该 `deviceId` 为值的映射**。

**后果**：
- 设备 A 是 panel-X 的 activeDevice，A 断开后 `panelActiveDevices.get('panel-X')` 仍返回 A 的 deviceId
- 下次工具调用 `hasDevice(A)` 返回 false，正确 reject（功能正确），但 `panelActiveDevices` Map 持续累积已断开设备的映射
- 内存泄漏：长期运行累积无效映射
- 调试困难：调试时 `panelActiveDevices` 显示的设备实际已离线

**修复**：`onClientDisconnect` 中遍历 `panelActiveDevices`，删除值等于 `deviceId` 的项；同时清理 `panelOnlineDevices` 中该设备的所有引用。

#### 缺口 C：缺少 S2 独立 spec 文件 + git commit（**P2 工程合规**）

**问题**：S1 spec 第 5.1 节明确说"S2 只需补充：同面板多端在线时的选举规则、无在线设备的错误处理"，但实际没有 `phase-s2-*.md` 文件。S2 的 `panelActiveDevices` Map 和 `setPanelActiveDevice` 是 Phase 4 / Phase 8 批次3 时随 per-panel session 一起实现的，**没有独立 S2 git commit**。

**后果**：S2 是否"完成"无法从 git 历史明确判断；未来 review 无 spec 依据。

**修复**：本 Spec 即为 S2 spec；编码完成后独立 git commit（conventional commit 格式 `feat(server): S2 multi-device parallel routing`）。

#### 缺口 D：`error_report` 路由依赖 `panelActiveDevices` 反向查找（**P2 路由正确性**）

**问题**：[piBridge.ts:1037-1052](../../server/src/piBridge.ts) 的 `onErrorReport` 处理 widget 错误时，遍历 `panelActiveDevices` 找到值等于 `deviceId` 的 `panelId` 作为目标面板。

**后果**：`panelActiveDevices` 只记录最后发 `user_message` 的设备；如果错误来自 widget 在 panel-A，但用户最后在 panel-B 发消息（设备相同），错误会路由到 panel-B 而非 panel-A。

**修复**：
- **方案 A（推荐）**：客户端发送 `error_report` 时携带 `panelId` 字段（从 widgetId 反查 panel_id 在客户端已完成）
- **方案 B（兼容）**：服务器用 `panelOnlineDevices` 反向查找该 `deviceId` 关联的所有面板，取第一个非 session-only 的面板

本 Spec 采用**方案 A**（前端协议变更最小且最准确），方案 B 作为兜底。

### 1.3 顺手修复：S1 遗留 bug — `runRetentionCleanup` 误包含 summarized 原对话（**P1 数据正确性**）

**问题**：[aiContext.ts:332-405](../../server/src/db/aiContext.ts) 的分层保留逻辑：
- 30 天清理：把 full 对话总结成 summary 条目（`INSERT INTO ai_conversations ... retention_level='summary'`），**原对话标记 `summarized=TRUE, retention_level='summary'` 但不删除**（L366-371）
- 90 天清理：查询 `WHERE retention_level='summary' AND created_at < ninetyDaysAgo`——**会包含被 summarized 的原对话**（retention_level 已改为 'summary'）
- 对原对话再次 `extractMemories` + DELETE：原对话内容不是 summary，extractMemories 质量差；与 summary 条目重复提取

**roadmap 设计意图**（[roadmap_server_v1.md:78](../roadmap_server_v1.md)）：
> 30 天前 full 对话 → AI 总结成 summary；90 天前 summary → 提取到 ai_memories 后删除

设计意图是 30 天 summarize 后**原对话被压缩成 summary**（content 是 AI 总结的，不是原始对话），90 天清理只处理 summary 条目。

**修复**：30 天 summarize 后**直接 DELETE 原对话**（content 已被压缩成 summary，不再需要原始对话）。这样 90 天清理查询天然只返回 summary 条目（无 summarized=TRUE 的原对话）。

**影响范围**：
- 修改 [aiContext.ts:366-371](../../server/src/db/aiContext.ts)：把 `UPDATE ... SET summarized=TRUE, retention_level='summary'` 改为 `DELETE FROM ai_conversations WHERE id = ANY($1)`
- 删除 `summarized` 字段的使用（schema 中保留字段以防回滚，但代码不再写入）
- 90 天清理查询不变（`WHERE retention_level='summary'`），但语义变为只查 summary 条目

---

## 二、详细设计

### 2.1 修复缺口 A：设备-面板在线关系追踪 + AI 思考流定向广播

#### 2.1.1 数据结构设计

在 `piBridge.ts` 新增 `panelOnlineDevices` Map：

```typescript
// ============================================================================
// Phase S2：设备-面板在线关系追踪（spec 缺口 A）
// 记录每个面板当前有哪些设备在查看/对话
// 用于 AI 思考流定向广播（避免全广播到所有设备）
// ============================================================================

const panelOnlineDevices = new Map<string, Set<string>>()
```

#### 2.1.2 设备加入面板在线集合 + 自动清理旧面板映射

`onClientMessage` 收到 `user_message` 时，除了 `setPanelActiveDevice`，还要把 `deviceId` 加入该面板的在线集合，**并自动清理该设备在其他面板的在线集合 + activeDevice 映射**（解决设备切换面板后旧面板状态残留问题，详见 2.1.8）：

```typescript
// piBridge.ts initPiBridge() 内的 onClientMessage handler
if (msg.kind === 'user_message') {
  const effectivePanelId = msg.panelId ?? (msg.sessionId ? `session-only:${msg.sessionId}` : `session-only:anon-${deviceId}`)

  // S1：设置该面板的活跃设备
  setPanelActiveDevice(effectivePanelId, deviceId)

  // S2 缺口 A：加入该面板的在线设备集合（用于定向广播）
  let onlineSet = panelOnlineDevices.get(effectivePanelId)
  if (!onlineSet) {
    onlineSet = new Set()
    panelOnlineDevices.set(effectivePanelId, onlineSet)
  }
  onlineSet.add(deviceId)

  // S2 缺口 A + 设备切换面板自动清理（详见 2.1.8）：
  // 该设备如果之前在其他面板的在线集合中，从旧面板移除（避免旧面板 pi_event 仍发到该设备）
  // 同时清理 panelActiveDevices 中以该 deviceId 为值的旧映射（避免工具路由到已切走的设备）
  cleanupDeviceFromOtherPanels(deviceId, effectivePanelId)

  handleUserMessage(msg.content, deviceId, effectivePanelId, msg.apiConfig).catch(...)
}
```

#### 2.1.3 设备主动退出面板（`dispose_session` 消息，仅用户主动删除会话场景）

> **重要事实（来自对抗审查）**：桌面端切换面板时**不发** `dispose_session`（仅调 HTTP API）；`dispose_session` 仅在用户手动删除会话时发送（[useAIStore.ts:1178-1194](../../client/desktop/src/stores/useAIStore.ts)）。因此本节逻辑只处理"用户主动删除会话"场景；设备切换面板的自动清理由 2.1.8 处理。

> **S2 对抗审查 S-1 修复（严重 bug）**：原 spec 无条件调用 `disposePanelSession(effectivePanelId)`，在多端场景下会破坏其他在线设备的会话上下文。修复为"只有当 `onlineSet.size === 0` 时才销毁 session"，避免 device-A 单方面销毁 device-B 也在用的 panel session。

`onClientMessage` 收到 `dispose_session` 时，先把 `deviceId` 从该面板的在线集合移除；只有当该面板已无其他在线设备时才销毁 session：

```typescript
} else if (msg.kind === 'dispose_session') {
  const effectivePanelId = msg.panelId ?? (msg.sessionId ? `session-only:${msg.sessionId}` : null)
  if (effectivePanelId) {
    // S2 缺口 A：从该面板的在线设备集合移除
    let remainingCount = 0
    const onlineSet = panelOnlineDevices.get(effectivePanelId)
    if (onlineSet) {
      onlineSet.delete(deviceId)
      remainingCount = onlineSet.size
      if (remainingCount === 0) {
        panelOnlineDevices.delete(effectivePanelId)
      }
    }

    // S2 对抗审查 S-1 修复：只有该面板无其他在线设备时才销毁 session
    if (remainingCount === 0) {
      disposePanelSession(effectivePanelId).catch(...)
    } else {
      console.log(`[PiBridge] Device ${deviceId} left panel ${effectivePanelId}, ${remainingCount} device(s) still active, keeping session`)
    }
  }
}
```

#### 2.1.8 设备切换面板的自动清理（新增，对抗审查发现的关键问题）

**问题**：当前 `setPanelActiveDevice(panelId, deviceId)` 不检查 `deviceId` 是否已映射到其他面板。如果 device-A 在 panel-A 是 activeDevice，切到 panel-B 发消息后：
- `panelActiveDevices.get('panel-A')` 仍返回 `device-A`（旧映射残留）
- `panelOnlineDevices.get('panel-A')` 仍包含 `device-A`（旧在线集合残留）
- 如果 panel-A 触发工具调用，会路由到 device-A（`hasDevice(device-A)` 返回 true，设备仍在线），但 device-A 的 UI 当前在 panel-B，工具执行上下文错乱

**修复**：新增 `cleanupDeviceFromOtherPanels(deviceId, currentPanelId)` 函数，在 `user_message` 时调用：

```typescript
/**
 * S2 设备切换面板自动清理：从该设备关联的其他面板移除引用
 * - 从 panelOnlineDevices 中其他面板的在线集合移除该设备
 * - 从 panelActiveDevices 中以该 deviceId 为值的其他面板映射删除
 * - 不调用 disposePanelSession（保留旧面板的 session，下次切回可恢复上下文）
 *
 * S2 对抗审查 M-1 修复：不再跳过 session-only: 前缀的面板。
 * 原跳过逻辑会导致设备切走后仍在旧 session-only 面板的在线集合中，
 * 进而继续收到该面板的 pi_event（定向广播），与"设备切走后不应再收旧面板事件"语义冲突。
 * session-only 面板 sessionId 虽然可跨设备共享，但单个设备的引用仍需清理。
 */
function cleanupDeviceFromOtherPanels(deviceId: string, currentPanelId: string): void {
  // 1. 从其他面板的在线集合移除该设备
  for (const [pid, onlineSet] of panelOnlineDevices) {
    if (pid === currentPanelId) continue
    if (onlineSet.delete(deviceId)) {
      console.log(`[PiBridge] Device ${deviceId} left panel ${pid} (switched to ${currentPanelId})`)
      if (onlineSet.size === 0) {
        panelOnlineDevices.delete(pid)
      }
    }
  }

  // 2. 从 panelActiveDevices 中以该 deviceId 为值的其他面板映射删除
  for (const [pid, devId] of panelActiveDevices) {
    if (pid === currentPanelId) continue
    if (devId === deviceId) {
      panelActiveDevices.delete(pid)
      console.log(`[PiBridge] Cleared activeDevice for panel ${pid} (device ${deviceId} switched to ${currentPanelId})`)
    }
  }
}
```

**为什么不调 `disposePanelSession`**：
- 保留旧面板的 AgentSession 在内存中（7 天超时清理由 S1 既有逻辑处理）
- 用户切回旧面板时，`getOrCreatePanelSession` 复用旧 session（per-panel session 设计，S1 既有行为）
- 仅清理在线集合 + activeDevice 映射，避免工具路由错乱

**多端场景的正确性**：
- device-A 和 device-B 都在 panel-A（都在在线集合中）
- device-A 切到 panel-B 发消息 → `cleanupDeviceFromOtherPanels('device-A', 'panel-B')` 仅从 panel-A 的在线集合移除 device-A，**不影响 device-B**
- panel-A 触发工具调用 → 路由到 device-B（`panelActiveDevices.get('panel-A') === 'device-B'`）✓

#### 2.1.4 设备 WS 断开清理（缺口 A + 缺口 B）

`onClientDisconnect` 中遍历 `panelOnlineDevices` 移除该设备的所有引用 + 遍历 `panelActiveDevices` 删除值等于 `deviceId` 的项：

```typescript
// piBridge.ts initPiBridge() 内的 onClientDisconnect handler
onClientDisconnect((deviceId) => {
  // S2 缺口 B：清理 panelActiveDevices 中以该 deviceId 为值的映射
  for (const [pid, devId] of panelActiveDevices) {
    if (devId === deviceId) {
      panelActiveDevices.delete(pid)
      console.log(`[PiBridge] Cleared activeDevice for panel ${pid} (device ${deviceId} disconnected)`)
    }
  }

  // S2 缺口 A：从所有面板的在线设备集合移除该设备
  for (const [pid, onlineSet] of panelOnlineDevices) {
    if (onlineSet.delete(deviceId)) {
      if (onlineSet.size === 0) {
        panelOnlineDevices.delete(pid)
      }
    }
  }

  // S1 已有：pendingRequests 不全部拒绝，由 timer 处理超时
  if (pendingRequests.size > 0) {
    console.log(`[PiBridge] Device disconnected: ${deviceId}, ${pendingRequests.size} pending tool calls`)
  }
})
```

#### 2.1.5 `forwardEventToClient` 改为定向广播

```typescript
function forwardEventToClient(event: unknown, panelId: string): void {
  const e = event as { type?: string; [key: string]: unknown }
  if (!e || typeof e.type !== 'string') return

  // S2 缺口 A：按面板定向广播（避免全广播到所有设备）
  const onlineSet = panelOnlineDevices.get(panelId)
  if (onlineSet && onlineSet.size > 0) {
    // 定向广播到该面板的所有在线设备
    for (const deviceId of onlineSet) {
      sendToDevice(deviceId, { kind: 'pi_event', event: e.type, data: e, panelId })
    }
  } else {
    // 兜底：无在线设备记录时（如客户端未发 user_message 就已订阅），
    // 退化为全广播 + panelId 过滤（兼容旧客户端）
    broadcast({ kind: 'pi_event', event: e.type, data: e, panelId })
  }
}
```

#### 2.1.6 `disposePanelSession` 同步清理 `panelOnlineDevices`

```typescript
export async function disposePanelSession(panelId: string): Promise<void> {
  // ... S1 已有逻辑 ...

  panelActiveDevices.delete(panelId)
  panelSessionReady.delete(panelId)

  // S2 缺口 A：清理该面板的在线设备集合
  panelOnlineDevices.delete(panelId)

  // ... 拒绝 pendingRequests / askUserPending ...
}
```

#### 2.1.7 `disposePiBridge` 全局销毁时清理

```typescript
export async function disposePiBridge(): Promise<void> {
  // ... S1 已有逻辑 ...
  panelActiveDevices.clear()
  panelSessionReady.clear()

  // S2 缺口 A：清理所有面板的在线设备集合
  panelOnlineDevices.clear()

  rejectAllPending('pi bridge disposed')
  // ... 清理 askUserPending ...
}
```

### 2.2 修复缺口 B：设备断开清理 `panelActiveDevices`（已合并到 2.1.4）

详见 2.1.4 节，`onClientDisconnect` 中遍历 `panelActiveDevices` 删除值等于 `deviceId` 的项。

### 2.3 修复缺口 C：S2 独立 spec + git commit

- 本 Spec 即为 S2 spec（`phase-s2-multi-device-spec.md`）
- 编码完成后 git commit（conventional commit 格式 `feat(server): S2 multi-device parallel routing`）
- 更新 [roadmap_server_v1.md](../roadmap_server_v1.md) Phase S2 验收清单勾选

### 2.4 修复缺口 D：`error_report` 携带 `panelId`

#### 2.4.1 WS 协议变更（`error_report` 增加 `panelId` 字段）

[ws.ts:34](../../server/src/ws.ts) 的 `ClientMessage` 类型：

```typescript
// 修改前
| { kind: 'error_report'; widgetId: string; message: string; stack?: string; source: string }

// 修改后（panelId 可选，兼容旧客户端）
| { kind: 'error_report'; widgetId: string; panelId?: string; message: string; stack?: string; source: string }
```

#### 2.4.2 `ErrorReport` 类型增加 `panelId`

[ws.ts:81-86](../../server/src/ws.ts) 的 `ErrorReport` 类型：

```typescript
export type ErrorReport = {
  widgetId: string
  panelId?: string  // S2 缺口 D：客户端从 widgetId 反查 panel_id 后携带
  message: string
  stack?: string
  source: string
}
```

#### 2.4.3 WS 消息处理增加 `panelId` 透传

[ws.ts:309-323](../../server/src/ws.ts) 的 `error_report` 分发：

```typescript
if (msg.kind === 'error_report') {
  const report: ErrorReport = {
    widgetId: msg.widgetId,
    panelId: msg.panelId,  // S2 缺口 D：透传 panelId
    message: msg.message,
    stack: msg.stack,
    source: msg.source,
  }
  // ... 分发到 errorReportHandlers ...
}
```

#### 2.4.4 `onErrorReport` 处理逻辑改造

[piBridge.ts:1037-1061](../../server/src/piBridge.ts) 的 `onErrorReport`：

```typescript
onErrorReport((report, deviceId) => {
  const errorMessage = formatErrorMessage(report)
  console.log(`[PiBridge] Widget error reported (widgetId=${report.widgetId}, device=${deviceId}), injecting to agent context`)

  // S2 缺口 D：优先用 report.panelId；缺失时兜底用 panelOnlineDevices 反向查找"最近活跃"面板
  let targetPanelId: string | undefined = report.panelId
  if (!targetPanelId) {
    // 兜底 1：从 panelOnlineDevices 反向查找该 deviceId 关联的面板
    // 取最近活跃的面板（用 sessionLastUsed 时间戳排序，最大的优先）
    let bestTimestamp = -1
    for (const [pid, onlineSet] of panelOnlineDevices) {
      if (onlineSet.has(deviceId) && !pid.startsWith('session-only:')) {
        const ts = sessionLastUsed.get(pid) ?? 0
        if (ts > bestTimestamp) {
          bestTimestamp = ts
          targetPanelId = pid
        }
      }
    }
  }
  // 兜底 2：从 panelActiveDevices 反向查找（S1 旧逻辑，取最近活跃）
  if (!targetPanelId) {
    let bestTimestamp = -1
    for (const [pid, devId] of panelActiveDevices) {
      if (devId === deviceId) {
        const ts = sessionLastUsed.get(pid) ?? 0
        if (ts > bestTimestamp) {
          bestTimestamp = ts
          targetPanelId = pid
        }
      }
    }
  }
  if (!targetPanelId) {
    console.warn('[PiBridge] No panel found for error_report, dropping')
    return
  }
  // ... handleUserMessage(errorMessage, deviceId, targetPanelId) ...
})
```

> **对抗审查发现**：原 spec 用 `for ... break` 取 Map 迭代顺序首个，非确定性。修订为按 `sessionLastUsed` 时间戳取"最近活跃"面板，避免多面板场景下 error_report 路由不可预测。

### 2.5 顺手修复 S1 bug：`runRetentionCleanup` 30 天 summarize 后删除原对话

[aiContext.ts:366-371](../../server/src/db/aiContext.ts)：

```typescript
// 修改前（S1 实现）
// 原对话标记 summarized=TRUE，retention_level='summary'
await pool.query(
  `UPDATE ai_conversations SET summarized = TRUE, retention_level = 'summary', updated_at = $1
   WHERE id = ANY($2)`,
  [now, convIds],
)

// 修改后（S2 顺手修复 S1 bug，含防御性约束）
// 仅在 summary 非空时 DELETE 原对话；summary 为空时保留原对话 + 告警（防数据丢失）
if (summary) {
  await pool.query(
    `DELETE FROM ai_conversations WHERE id = ANY($1)`,
    [convIds],
  )
} else {
  // contents 为空或 summarize 失败导致 summary 为空，保留原对话（不 DELETE）
  console.warn(`[AiContext] summarize returned empty for panel ${panelId}, keeping original conversations`)
}
```

**防御性约束（对抗审查发现）**：原 spec 直接 DELETE，但 `summarizeConversations` 在 `contents` 为空数组时返回空字符串（[aiContext.ts:421-423](../../server/src/db/aiContext.ts)）。虽然 SQL `array_agg` + `GROUP BY panel_id` 在 30 天前 full 对话存在时不会返回空数组，但防御性约束避免未来 schema/查询变更引入静默数据丢失。

**90 天清理查询不变**（`WHERE retention_level='summary' AND created_at < ninetyDaysAgo`），但语义变为只查 summary 条目（无 summarized=TRUE 的原对话，因为已被 DELETE）。

**向后兼容**：schema 中 `summarized` / `summary_of` 字段保留（防回滚），但代码不再写入。

---

## 三、实施步骤

### 步骤 1：备份当前数据库

```bash
# 在服务器或本地开发环境
docker exec living-dashboard-postgres pg_dump -U postgres living_dashboard > data/backup-pre-s2.sql
```

### 步骤 2：编码（按依赖顺序，避免临时修改）

1. **修改 `ws.ts`**：
   - `ErrorReport` 类型增加 `panelId?: string`
   - `ClientMessage` 的 `error_report` 分支增加 `panelId?: string`
   - `error_report` 分发时透传 `panelId`

2. **修改 `piBridge.ts`**：
   - 新增 `panelOnlineDevices = new Map<string, Set<string>>()`
   - `onClientMessage` 收到 `user_message` 时加入在线集合
   - `onClientMessage` 收到 `dispose_session` 时从在线集合移除
   - `onClientDisconnect` 清理 `panelActiveDevices` + `panelOnlineDevices`
   - `forwardEventToClient` 改为定向广播
   - `disposePanelSession` 清理 `panelOnlineDevices.delete(panelId)`
   - `disposePiBridge` 清理 `panelOnlineDevices.clear()`
   - `onErrorReport` 优先用 `report.panelId`，缺失时用 `panelOnlineDevices` 反向查找

3. **修改 `aiContext.ts`**：
   - `runRetentionCleanup` 30 天清理：原对话 DELETE 替代 UPDATE

### 步骤 3：构建 + 运行时验证

```bash
cd f:\allmylife\event\server
npm run build        # TypeScript 编译无错
npm run dev          # 启动 server
```

**运行时验证清单**（必须全部通过，不能只读代码）：

1. ✅ Server 启动无报错，日志 `[PiBridge] Initialized (per-panel session mode, lazy creation)` 输出
2. ✅ 单端单面板：桌面端连接，发一条 user_message，AI 正常回复（pi_event 收到）
3. ✅ 单端切换面板自动清理（**S2 2.1.8 核心验证**）：
   - 桌面端在 panel-A 发消息 → 切到 panel-B 发消息
   - 验证：`panelActiveDevices.get('panel-A')` 返回 undefined（自动清理，不是 device-A 旧值）
   - 验证：`panelActiveDevices.get('panel-B')` 返回 device-A
   - 验证：`panelOnlineDevices.get('panel-A')` 不存在或不含 device-A（自动清理）
   - 验证：`panelOnlineDevices.get('panel-B')` 包含 device-A
   - 验证：`panelSessions.get('panel-A')` 仍存在（保留 session，7 天超时清理）
4. ✅ 多端不同面板并行（**S2 缺口 A 核心验证**）：
   - 启动两个桌面端实例（或用 Playwright 模拟），deviceId 分别为 device-A / device-B
   - device-A 在 panel-1 发消息触发 AI 工具调用（如 `browser_eval`）
   - device-B 在 panel-2 同时发消息触发 AI 工具调用
   - 验证：device-A 的工具调用路由到 device-A（不是 device-B）；device-B 的工具调用路由到 device-B
   - 验证：device-A 收到 panel-1 的 pi_event；device-B 收到 panel-2 的 pi_event；**device-A 不应收到 panel-2 的 pi_event**（用 WS 日志或浏览器 devtools network 验证）
5. ✅ 同面板多端接管 + 共享思考流（**S2 缺口 A 关键验证**）：
   - device-A 和 device-B 都在 panel-1（先发 user_message 加入在线集合）
   - device-A 先发消息 → `panelActiveDevices.get('panel-1') === 'device-A'`
   - device-B 后发消息 → `panelActiveDevices.get('panel-1') === 'device-B'`（接管）
   - 触发工具调用 → 路由到 device-B（不是 device-A）
   - 验证：device-A 和 device-B **都收到** panel-1 的 pi_event（同面板多端共享思考流，定向广播）
6. ✅ 无在线设备抛错：
   - device-A 在 panel-1 发消息 → 断开 device-A
   - 触发工具调用（用 `browser_eval` 等 DEVICE_SPECIFIC_TOOLS 测试，应 reject `no active device for panel panel-1`）
   - 验证错误消息：`no active device for panel panel-1, tool: browser_eval`
7. ✅ 设备断开清理（**S2 缺口 B 验证**）：
   - device-A 在 panel-1 发消息 → 断开 device-A
   - 验证：`panelActiveDevices.get('panel-1')` 返回 undefined（不是 device-A 的旧值）
   - 验证：`panelOnlineDevices.get('panel-1')` 不包含 device-A
8. ✅ `error_report` 携带 `panelId` 路由（**S2 缺口 D 验证**）：
   - 桌面端在 panel-1 创建 HTML widget，触发运行时错误
   - 客户端发送 `error_report` 时携带 `panelId: 'panel-1'`
   - 服务器日志 `[PiBridge] Widget error reported (widgetId=..., device=...)` 后正确路由到 panel-1（不是其他面板）
9. ✅ S1 bug 修复（`runRetentionCleanup` 30 天 DELETE 原对话 + 防御性约束）：
   - 手动插入 31 天前的 full 对话：`INSERT INTO ai_conversations (panel_id, role, content, retention_level, created_at, updated_at) VALUES ('test-panel', 'user', 'old content', 'full', <31天前的时间戳>, <31天前的时间戳>)`
   - 触发 `runRetentionCleanup()`（用 `tsx -e "import { runRetentionCleanup } from './src/db/aiContext.js'; await runRetentionCleanup()"`）
   - 验证：原对话被 DELETE（`SELECT * FROM ai_conversations WHERE panel_id='test-panel'` 返回 0 行 full；只有 1 行 summary）
   - 防御性约束：手动模拟 `summarizeConversations` 返回空字符串的场景（mock 或修改代码临时返回空），验证原对话**保留不删除** + 告警日志输出
10. ✅ 重启 server 后所有内存状态均为空（不持久化，下次 user_message 时按需重建）：
    - `panelActiveDevices` / `panelOnlineDevices` / `panelSessions` / `panelSessionReady` / `sessionLastUsed` 均为空
11. ✅ `dispose_session` 从在线集合移除（**用户主动删除会话场景**）：
    - device-A 在 panel-1 发消息 → 用户在 AIAssistantSidebar 点击删除会话，客户端发送 `dispose_session { panelId: 'panel-1' }`
    - 验证 `panelOnlineDevices.get('panel-1')` 不包含 device-A
    - 验证 `panelActiveDevices.get('panel-1')` 已清理（`disposePanelSession` 调用）
    - 验证 `panelSessions.get('panel-1')` 已清理（`disposePanelSession` 调用）
15. ✅ **多端 dispose_session 不影响其他在线设备**（**S2 对抗审查 S-1 修复验证**）：
    - device-A 和 device-B 都在 panel-1（先发 user_message 加入在线集合）
    - device-A 发送 `dispose_session { panelId: 'panel-1' }`（用户主动删除会话）
    - 验证：`panelOnlineDevices.get('panel-1')` 仍包含 device-B（不被影响）
    - 验证：`panelSessions.get('panel-1')` 仍存在（device-B 还在用，未销毁）
    - 验证：`panelActiveDevices.get('panel-1')` 仍指向最后发 user_message 的设备（未被清理）
    - 验证：device-B 后续工具调用正常路由（不 reject `no active device`）
    - 验证：服务器日志输出 `Device device-A left panel panel-1, 1 device(s) still active, keeping session`
16. ✅ **session-only 面板切换场景**（**S2 对抗审查 M-1 修复验证**）：
    - device-A 在 `session-only:shared-anon` 发消息 → 切到普通面板 `panel-Y` 发消息
    - 验证：`panelOnlineDevices.get('session-only:shared-anon')` 不包含 device-A（已清理）
    - 验证：`panelActiveDevices.get('session-only:shared-anon')` 已删除（已清理）
    - 验证：`session-only:shared-anon` 触发 pi_event 时不广播到 device-A
12. ✅ `docker compose config` 无报错（无 schema 变更，仅代码）
13. ✅ `npm run build` TypeScript 编译无错
14. ✅ 多端场景下 `cleanupDeviceFromOtherPanels` 不影响其他设备（**S2 2.1.8 多端正确性验证**）：
    - device-A 和 device-B 都在 panel-A（都在在线集合中）
    - device-A 切到 panel-B 发消息 → `cleanupDeviceFromOtherPanels('device-A', 'panel-B')`
    - 验证：`panelOnlineDevices.get('panel-A')` 仍包含 device-B（不受影响）
    - 验证：`panelActiveDevices.get('panel-A')` 返回 device-B（device-A 切走后，device-B 接管 panel-A 的 activeDevice）
    - 注意：device-B 在 panel-A 发过消息，所以 `panelActiveDevices.get('panel-A') === 'device-B'`；如果 device-B 没发过消息，`panelActiveDevices.get('panel-A')` 应返回 undefined（清理后无 activeDevice）

### 步骤 4：对抗审查

使用 `adversarial-review` skill 对编码成果做对抗审查（含运行时验证），不合格则修复后重审。

### 步骤 5：git commit + 发布

- git commit（conventional commit 格式 `feat(server): S2 multi-device parallel routing`）
- 更新 [roadmap_server_v1.md](../roadmap_server_v1.md) Phase S2 验收清单勾选
- 打 Docker 镜像 tag `v0.7.0-s2`（版本号递增）
- 更新部署文档（无 schema 变更，仅代码）

---

## 四、风险与回滚

### 4.1 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| `panelOnlineDevices` 与 `panelActiveDevices` 状态不一致 | 路由错误 | spec 2.1.4 / 2.1.6 / 2.1.7 三处清理点统一处理；运行时验证步骤 7 验证清理 |
| 定向广播导致旧客户端收不到 pi_event | 客户端无 AI 思考流 | spec 2.1.5 兜底：无在线设备记录时退化为全广播 + panelId 过滤；保留 `pi_event.panelId` 字段向后兼容 |
| `error_report` 客户端未携带 `panelId` | 路由回退到反向查找 | spec 2.4.4 三级兜底：`report.panelId` → `panelOnlineDevices` 反向 → `panelActiveDevices` 反向 |
| 30 天 DELETE 原对话后 summary 质量差 | 上下文恢复信息丢失 | summary 由 LLM 生成（`summarizeConversations`），质量依赖 LLM；运行时验证步骤 9 验证 summary 条目存在 |
| `runRetentionCleanup` 修改影响 S1 已有数据 | 旧 summarized=TRUE 的原对话残留 | 旧数据不影响新逻辑：新逻辑只 DELETE 30 天前的 full 对话；旧 summarized=TRUE 数据由 90 天清理 DELETE |
| 多端并行时 `AsyncLocalStorage` 上下文污染 | 工具路由错乱 | S1 已用 `AsyncLocalStorage` 隔离（piBridge.ts:346-363），S2 不改动 |

### 4.2 回滚方案

1. **代码回滚**：`git revert <commit>` 回到 S2 前的提交
2. **数据库回滚**：恢复 `data/backup-pre-s2.sql`（S1 bug 修复会 DELETE 30 天前的原对话，需备份恢复）
3. **镜像回滚**：用上一版本镜像 tag

---

## 五、与后续 Phase 的契约

### 5.1 与 S3（冲突解决 + syncQueue 持久化）的契约

S2 不涉及数据冲突解决（widget/entity 的乐观锁），不冲突。S3 实施时 `panelOnlineDevices` 已存在，可用于冲突广播的定向通知。

### 5.2 与 S4（AI 配置后端）的契约

S2 不涉及 AI 配置后端，不冲突。

### 5.3 与桌面端 Phase 4.1 的契约

S2 完成后，桌面端 Phase 4.1 可以依赖：
- `panelActiveDevices[panelId]` per-panel 路由
- `panelOnlineDevices[panelId]` 设备-面板在线关系
- 设备断开自动清理

桌面端需要：
- `error_report` 消息携带 `panelId` 字段（从 widgetId 反查 panel_id）

### 5.4 与移动端 Phase M3 的契约

S2 完成后，移动端 Phase M3 可以依赖：
- 同面板多端共享思考流（移动端 + 桌面端同面板都能收到 pi_event）
- 设备断开自动清理（移动端切换网络时不残留）

---

## 六、附录：关键文件变更清单

| 文件 | 变更类型 | 行数估计 |
|------|---------|---------|
| `server/src/piBridge.ts` | 新增 `panelOnlineDevices` + 新增 `cleanupDeviceFromOtherPanels` + 改造 `forwardEventToClient` + 改造 `onClientDisconnect` + 改造 `onErrorReport`（含三级兜底 + 取最近活跃）+ 改造 `disposePanelSession` / `disposePiBridge` + 改造 `onClientMessage` 的 `user_message` / `dispose_session` 分支 | +90 行 |
| `server/src/ws.ts` | `ErrorReport` + `ClientMessage` 的 `error_report` 分支增加 `panelId?` 字段 + `error_report` 分发透传 `panelId` | +5 行 |
| `server/src/db/aiContext.ts` | `runRetentionCleanup` 30 天清理改为 DELETE 原对话（含防御性约束） | +6 / -2 行 |
| `client/desktop/src/stores/useAIStore.ts` | `reportWidgetError` 签名增加 `panelId` 参数 + sendWs payload 加 `panelId` | +3 行 |
| `client/desktop/src/components/widgets/HtmlCanvasWidget.tsx` | `onError` 回调传 `panelId`（从 Props 取） | +1 行 |
| `docs/specs/phase-s2-multi-device-spec.md` | 新建（本文件） | +550 行 |
| `docs/roadmap_server_v1.md` | Phase S2 验收清单勾选 | -1 / +1 行 |

**总变更**：5 个代码文件 + 2 个文档文件，约 +660 行 / -15 行

> **注意**：客户端变更（`useAIStore.ts` + `HtmlCanvasWidget.tsx`）是缺口 D 方案 A 的必要配套，不属于服务器端 S2 严格范围，但为完整性一并在本 S2 实施中交付。

---

## 七、验收清单（与 roadmap 验收标准对齐）

### Phase S2 验收

- [x] per-panel activeDeviceId 实现（`Map<panelId, deviceId>`）— **S1 已完成，S2 不改动**
- [x] 工具调用路由到正确面板的活跃设备 — **S1 已完成，S2 不改动**
- [x] 多端不同面板可并行 AI 操作 — **S1 已完成，S2 不改动**
- [x] 同面板后发消息设备接管 activeDevice — **S1 已完成，S2 不改动**
- [x] 无在线设备时抛错提示 — **S1 已完成，S2 不改动**
- [x] **AI 思考流定向广播到该面板所有在线设备**（S2 缺口 A，含 `panelOnlineDevices` + `forwardEventToClient` 定向广播）
- [x] **设备断开时清理 `panelActiveDevices` + `panelOnlineDevices`**（S2 缺口 B）
- [x] **设备切换面板自动清理旧面板映射**（S2 2.1.8，`cleanupDeviceFromOtherPanels`）
- [x] **`error_report` 携带 `panelId` 正确路由**（S2 缺口 D，方案 A + 三级兜底取最近活跃）
- [x] **S2 独立 spec 文件 + git commit**（S2 缺口 C）— git commit `b4fd960` 已执行
- [x] **S1 bug 修复：`runRetentionCleanup` 30 天 DELETE 原对话 + 防御性约束**（顺手修复）
- [x] **`dispose_session` 多端场景保护其他在线设备**（S2 对抗审查 S-1 修复，仅 `onlineSet.size===0` 时才 `disposePanelSession`）
- [x] **`cleanupDeviceFromOtherPanels` 不跳过 session-only 面板**（S2 对抗审查 M-1 修复）
- [ ] Docker 镜像构建成功（无 schema 变更，仅代码）— 本地验证用直接 `node dist/index.js`
- [x] `npm run build` TypeScript 编译无错
- [ ] 运行时验证清单 16 项全部通过
