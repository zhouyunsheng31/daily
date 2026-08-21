# 06 · 计费（web 路线：现状与扩展）

> 现状：统一积分体系（1 积分 = ¥0.01）已上线，计费基于真实 usage，不伪造扣费。本文定义扩展项与边界。

## 1. 现状（实证）

- `billing/pricing.ts`：`BillingKind = chat | image | search | video | tts`；DeepSeek 峰谷价 ×2（北京时间 9-12/14-18）、毛利 50%；生图/视频按官方刊例半价；搜索 ¥0.08/次。
- 扣费基于 pi `agent_end` 真实 token usage（取不到回退估算）；用量落库 `webos_ai_usage` / `webos_imagegen_usage` / `webos_video_usage` / `webos_vision_usage`。
- 支付：zpay 易支付（代码就绪）+ 爱发电兑换码（已上线）+ 月卡档位；余额/积分明细（credits-history）可查。
- 工作区配额：游客 200MB / 会员 512MB / 月卡档位 10/30/100GB。

## 2. kind 扩展（计费目录，bootstrap.billing.catalog 自动展示）

| kind | 状态 | 计费规则 |
|---|---|---|
| `chat / image / search / video / tts` | 已有 | 现状不变 |
| `api` | **W2/W3 新增** | App API 调用：调用方付固定微价/次（建议 ¥0.01–0.05/次，按端点声明可调）；幂等键防重复扣费；失败/校验拒绝不扣 |
| `room` | 后置 | 联机房间流量/在线时长（06 启动时定义；host 付费为原则） |
| `compute` | **预留 unavailable**（R5） | 进程/终端能力不开放；登记槽位防止未来改架构 |

- 新 kind 上线即自动出现在 catalog（用户可见价格，不暗扣）；高峰倍率机制对新 kind 同样适用。

## 3. App API 计费细则（04 配套）

- 计费点：`POST /webos/api/appapi/:ns/:ep` 成功执行后结算；owner 级自调也计费（默认微价，平台成本对齐）；public 调用由**调用方**支付。
- 幂等：每次调用生成 idempotencyKey；重试/超时重复到达不重复扣费。
- 限额：单价 × 日调用上限双闸（防刷）；超出返回明确 `QUOTA_EXCEEDED`。

## 3.5 系统能力包 · 调用者计费租户（R15，2026-08-21 拍板）

- 背景：W4 把生图/生视频/对话/搜索等平台能力封装为**系统包**（`com.daily.*` 式，声明制端点，统一计费目录）。用户明确要求：「封装系统 API 的 App **自动链接到该用户自己的账号**，不允许所有人一起用一个人的账户积分」。
- **计费租户 = 调用者账号（principal.key）**：包内任何触发（App 运行时 / public 端点调用 / Agent 会话）的积分一律从**实际触发者**扣——即使 handler 跑在包属主 workspace、数据归属属主，**成本永远记到调用者**。
- **禁止**：把成本借用/汇聚到包属主或其他单一账号；把系统能力后端密钥暴露给 App/包（密钥只存服务端，R5/密钥红线）。
- 与 W2 现状一致且继续延用：`api` kind 已「调用方付费」；`image/video/chat/search` 平台工具已按 pi 会话本人扣费。R15 是把这条原则显式化为系统包化的硬约束，并为「用户最终承担自己用量（user-pays 的调用方版本）」铺路（R11 的 user-pays 仍为范围外选项，未解锁）。
- 落库：`webos_api_usage`（新表：caller/callee package/endpoint/耗时/计费/状态）；管理端 trace 可查。

## 4. 边界与不开放项（R11 记录）

- **web 端 AI BYOK**：首版不做（平台托管 DeepSeek）；移动端 BYOK 不参与平台积分计费（D15/D15）。
- **user-pays**（App 最终用户各自承担用量）：记录为未来选项；public API 的"调用方付费"已是其雏形。
- **发布者分成**：后置（社区运营阶段）。
- 真实支付未接入的侧只显示明确 unavailable，不伪造成功（红线）。

## 5. 验收

- API 调用 100 次：积分扣减与 catalog 价一致；重试不产生重复扣费；配额超限返回明确错误。
- 管理端可按 userKey/包/端点/天聚合查询 api 用量（沿用 stats/activity 模式）。
- catalog 新增 kind 无需改前端解析（契约守卫 fixtures 覆盖）。