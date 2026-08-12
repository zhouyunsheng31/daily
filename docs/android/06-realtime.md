# 06 · 联机：Realtime Room 与 channel 原语

> 目标体验：甲做了个论坛/聊天室/对战 App，分享出去，乙（网页端或 Android 端）加入后**实时互通**。
> 路线（D6）：Phase 1 服务器中继房间（M2 做），Phase 2 WebRTC 真 P2P（M3 评估）。对 App 暴露的是同一个 channel 原语，底层 transport 可换。

## 1. 概念模型

```
Room（房间）
├── id / inviteCode / ownerKey / createdAt
├── packageId（房间属于哪个 App/api 包实例）
├── members[]（userKey、role: host|member、joinedAt、lastSeenAt）
├── storage 共享命名空间（room:<roomId>:<prefix>，04 的 visibility=shared 端点在此读写）
└── channels[]（逻辑频道名 → pub/sub 主题）
```

- 房间 = App 联机会话的容器。**App 实例 ↔ 房间** 由 App 自己决定语义（一个论坛一个房间；一局游戏一个房间）。
- 中继实现复用现有 WS 基建（`server/src/ws.ts` 事件流经验 + 新 `server/src/webos/rooms.ts`）。

## 2. app-sdk 原语（App/AI 看到的全部）

```ts
// App 前端（WebView 内）经桥调用；AI 侧对应 pi 工具 room_*
const room = await sdk.rooms.current()            // 当前 App 实例所在房间（无则 null）
const ch = room.channel('chat')                   // 逻辑频道
ch.publish({ type: 'msg', text: 'hello' })        // 广播（经服务端中继）
ch.subscribe(msg => render(msg))                  // 订阅
room.onJoin(user => ...); room.onLeave(user => ...)
await room.storage.set('posts/1', {...})          // 房间共享 storage（04 shared 端点同一命名空间）
const link = await sdk.rooms.createInvite()       // 生成邀请链接/二维码
```

- 未联机的单机 App 零感知（不调 rooms API 即无开销）。
- channel 消息 ≤32KB、QPS 限流（每成员 10 msg/s，突发 30）；超限断开并审计。

## 3. 服务端协议与端点（`server/src/webos/rooms.ts`）

```
POST   /webos/api/rooms                 # 建房（host；绑定 packageId）→ { roomId, inviteCode }
POST   /webos/api/rooms/join            # { inviteCode } → { roomId, 成员凭证 }
GET    /webos/api/rooms/:id             # 房间状态（成员/在线）
POST   /webos/api/rooms/:id/leave
DELETE /webos/api/rooms/:id             # host 解散
WSS    /webos/ws/rooms/:id              # 实时通道：publish/subscribe/presence/storage 变更推送
```

- WSS 消息帧：`{kind:'pub', channel, payload}` / `{kind:'sub', channel}` / `{kind:'presence', ...}` / `{kind:'storage_changed', key, value, by}`。
- 消息持久化策略：默认**仅在线转发 + 最近 200 条/频道 ring buffer**（断线重连补发）；需要长期历史的数据必须落房间 storage（App 自己决定），房间解散即按保留策略清理。
- 审计：建房/加入/解散/消息计数（**不存消息内容全文**，除非 App 显式写 storage）——隐私与合规平衡；管理端 trace 可见房间元数据与流量。

## 4. 权限与计费

- 能力词汇：`room.host`（建房）、`room.join`（加入）（03 §6）。url-app 默认无房间能力。
- 计费：房间消息流量与在线时长折算积分（目录项 kind='room'，价格表进 billing catalog，08 的目录扩展机制）；**host 付费**为原则（成员免费加入），价格公示。

## 5. Phase 2（WebRTC，M3 再评）

- 触发条件：出现明确的低延迟场景（对战/画板协作）或局域网场景。
- 设计预留：`sdk.channel` 的 transport 参数已抽象；Phase 2 加 `transport:'webrtc'` 时由服务端信令 + TURN 兜底，API 不变。

## 6. 验收用例

- 论坛联机：甲建房发帖 → 乙经邀请链接加入（网页端与 Android 端各测一次）→ 双向消息 <500ms 可见 → 乙断网 30s 重连补发最近消息 → 甲解散房间后双方得到明确提示。
- 限流：单成员刷 100 msg/s 被断开 + 审计记录。
- 计费用量：一次 10 分钟双人房间会话的积分扣减与 catalog 价格一致（管理后台可查）。