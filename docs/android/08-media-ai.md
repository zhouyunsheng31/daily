# 08 · 媒体与模型预留位（TTS / ASR / 视觉 / 本地模型 / BYOK）

> 拍板（D8 + D15）：M1 **不实现**语音对话，但必须把位置留好——Provider 抽象、计费目录、能力词、包类型、UI 入口五处预留，后续接入不改架构。**对话 LLM 走端侧 BYOK**（用户自带模型 API，D15），平台不托管模型密钥、不提供云端 AI。

## 1. 媒体能力全景与现状

| 能力 | 现状 | 后续 |
|---|---|---|
| 对话 LLM | **用户配置（BYOK）**：DeepSeek / OpenAI 兼容 / Anthropic 等 provider，端侧直连，四档思考（pi thinking level） | M1 落地配置 UI + 直连；M3 本地模型可作离线 provider |
| 视觉（AI 的"眼睛"） | 用户 Key 的视觉模型（如带视觉的 BYOK provider）；无则返回 `CAPABILITY_UNAVAILABLE` | M1 截图 → 视觉描述（需用户 Key 支持） |
| 生图 | 用户配置 image provider（BYOK 或第三方）；未配置报 unavailable | M1 引导配置；M2 生图素材工作流（03 §4.1） |
| 生视频 | 用户配置 video provider（BYOK 或第三方） | M2+ |
| **TTS** | ❌ 无（billing catalog 已预留 `kind:'tts'`） | M2/M3：第三方 TTS（用户 Key）或本地系统 TTS |
| **ASR** | ❌ 无 | M1：系统 `SpeechRecognizer`（0 成本）；M2/M3：第三方 ASR（用户 Key） |
| **本地 LLM/模型** | ❌ 无 | M3：model-pack + llama.cpp（参考 Operit/MNN 路径，自研），作为离线 provider 接入同一 BYOK 选择器 |

## 2. Media Provider 抽象（服务端新模块 `server/src/webos/media/`）

```ts
interface MediaProvider {
  kind: 'tts' | 'asr' | 'vision' | 'image' | 'video'
  id: string                          // 'chatst-tts-1' / 'system-asr' / 'm3-vision' ...
  available(): boolean                // 未配置 → false（明确 unavailable，不伪造）
  pricing: BillingCatalogItem         // 自动汇入 billing.catalog（catalog kind 扩展：'tts'|'asr'|'room'|'api'）
  healthcheck(): Promise<boolean>
}
interface TtsProvider extends MediaProvider { synthesize(text, voice, opts): Promise<AudioResult> }
interface AsrProvider extends MediaProvider { transcribe(audio, opts): Promise<TranscriptResult> }
```

- **统一管线**（端侧为主）：鉴权（BYOK 密钥 Keystore）→ Provider 选择（用户设置/默认/可用性检测）→ 调用 → 用量本地落账 + 可选同步 → 审计（本地 execution log，09 同步）。
- **路由策略**：ASR 优先走 Android 系统 `SpeechRecognizer`（0 成本、离线可用）→ 用户可选第三方 ASR（用户 Key）；TTS 默认本地系统 TTS（0 成本），第三方 TTS（用户 Key）可选。
- 新 Provider = 新增一个实现类 + 配置模板，**不改调用方**；本地模型（M3）以同一 Provider 接口接入。
- **BYOK 对话不参与平台积分计费**：模型费用直接由用户 Key 结算，平台不介入对话链路计费（D15）；平台计费目录仅保留平台自身增值能力（房间/存储/市场等，见 04/06/09）。

## 3. 客户端预留（M1 就要留好的）

| 预留点 | 具体做法 |
|---|---|
| 输入框语音入口 | 输入框右侧麦克风按钮位：M1 点击 → 系统 `SpeechRecognizer` 识别成文字填入输入框（**这步 M1 就做**，成本极低、无计费）；云端 ASR 后续插入同一入口 |
| 消息朗读 | 消息长按菜单预留"朗读"项（M1 灰置"即将上线"），M2 接 TTS |
| 能力词 | `media.tts` / `media.asr` 已入词汇表（03 §6） |
| 语音全局入口（远期） | VoiceInteractionService（设为系统默认助手）——Operit 已验证路径；M3 评估，manifest 先不声明 |
| model-pack | 包类型已定义（03）；下载/校验/版本复用包流水线 |

## 4. 计费目录扩展（与 04/06 共用机制）

`WebOsBillingItem.kind` 扩展为 `'chat'|'image'|'search'|'tts'|'asr'|'room'|'api'`；每个新 Provider 上线即自动出现在 bootstrap.billing.catalog（用户可见价格，不暗扣）。**高峰倍率机制（DeepSeek peak ×2）对新 kind 同样适用**。

## 5. 验收（预留位验收，M1）

- [ ] 输入框麦克风可完成"说话→文字进输入框"（系统 ASR）。
- [ ] billing catalog 结构支持新增 kind 无需改客户端解析（契约守卫测试覆盖）。
- [ ] `media.tts/asr` 能力词在 Broker 注册，调用返回明确 `CAPABILITY_UNAVAILABLE`（而非 404/崩溃）。
- [ ] （M2 验收）接入首个 TTS Provider 后，消息"朗读"可用、用量落库、价格出现在 catalog。

## 6. BYOK：用户自带模型 API（D15 核心，M1 落地）

> 定位：**对话 LLM 的唯一路径**（无平台托管、无云端兜底）。用户主导——选择哪个模型、用什么 Key、花多少钱，全部归用户。

### 6.1 支持形态（M1）

| provider | 协议 | 说明 |
|---|---|---|
| DeepSeek | OpenAI 兼容 | 默认引导（官方四档思考 `low/medium/high/max`） |
| OpenAI 兼容（任意） | OpenAI | 输入 base URL + Key + 模型名（可指向中转/自建网关） |
| Anthropic | Anthropic | `x-api-key` + model（thinking budget 映射） |
| 本地模型（M3） | llama.cpp 等 | 离线 provider，同一选择器 |

### 6.2 密钥与安全（红线 1）

- 密钥存 **Android Keystore**（非对称加密后落 EncryptedSharedPreferences/DataStore 密文）。
- 仅经本地桥注入 Node 进程内存（环境变量），**不落 Node 侧磁盘、不进日志、不上传服务端、不入备份归档**。
- 配置页可见性：显示 provider 名称与模型名，Key 掩码显示（`sk-****abcd`）；支持"测试连接"（harness 内 ping 一次，同旧 LivingDashboard 的 testConnection 思路）。

### 6.3 配置与选择 UI（M1，我的 → AI 设置）

- 列表：已配置 provider（可多配，选默认）；添加 = 选形态 → 填 Key/Endpoint/模型 → 测试连接 → 保存。
- 模型选择与思考档（快速/平衡/深度/极深）是两个独立配置（与 webOS 现有 `ai/config` 语义对齐，但存端侧）。
- 未配置状态：对话页首屏引导卡"配置你的模型"（非阻断，可浏览桌面/商店）；AI 对话请求返回明确 `MODEL_NOT_CONFIGURED`，**不伪造、不偷偷走平台模型**。

### 6.4 与包的衔接

- model-pack（M3）注册为本地 provider，出现在同一选择器（离线优先可设）。
- api 包（04）可声明 `provider` 依赖（如"此 App 需要视觉模型"），Broker 按能力词 `media.vision` 求交。

## 7. DeepSeek 深度适配（吸收 dsh 官方调优，2026-08 用户拍板）

> 背景：dsh 是 DeepSeek 官方 harness，用户实测其 + DeepSeek 体验优于通用 harness（opencode 等）——差距来自官方对自家模型行为特征的调优（system prompt 组装、reasoning 流解析、compaction 策略、思考档映射）。**我们的 pi 是第三方通用 harness，DeepSeek provider 是自己接的——把 dsh 的调优思路吸收进 provider 层，让 DeepSeek 发挥更强能力**。来源：dsh `llm-deepseek` provider / system-prompt 组装 / compaction 能力族（MIT，参考设计）。

### 7.1 吸收清单（provider 层落地）

| # | 项 | 现状 | 落地 |
|---|---|---|---|
| 1 | **思考档语义对齐** | 四档 UI 已映射 `reasoning_effort`（low/medium/high/max；App 生成 off） | 对齐 dsh 官方四档语义（含低档快速、极深档预算上限）；M0-2 spike 实测四档行为差异 |
| 2 | **reasoning 流解析稳健性** | 曾踩坑：旧 high 档在 App 生成场景截断+超时（根 AGENT.md 记录） | thinking 块边界处理、截断恢复、多段合并；长思考任务禁用场景白名单（App 生成 off 已有） |
| 3 | **system prompt 与工具 schema 组装** | pi 默认组装 | 参考 dsh 对 DeepSeek 的调优结构：工具描述先验、输出格式约束、错误重试提示、工具结果引用格式 |
| 4 | **compaction 策略** | pi 默认压缩 | 参考 dsh token-meter（会话水位触发）+ tool-result-pruner（超大结果改写）思路，按 DeepSeek 上下文特征设水位（M2 provider 包化时落地） |
| 5 | **tool call 容错解析** | 偶发 JSON 转义/并行调用解析问题 | DeepSeek 输出容错解析层：JSON 修复、多工具并行调用归一化 |
| 6 | **BYOK 适配矩阵** | 单一 provider 路径 | 每 provider 一套适配参数：DeepSeek 官方语义 / OpenAI 兼容通用 / Anthropic / 本地模型——**不与写死模型绑定**（provider 包化后由包声明携带） |

### 7.2 验收（M0-2 spike 附带 + M2 provider 包化时全量）

- [ ] M0-2：10 轮对话（含工具调用）零解析失败；四档思考实测记录（首 token 延迟/完成率/质量抽检）归档 perf-reports/。
- [ ] 长思考任务（high/max）在 App 生成场景不截断不超时（回归 7.1-2）。
- [ ] M2：provider 包声明携带适配参数，切换 provider 零代码改动；compaction 水位可配且默认值按 DeepSeek 特征设定。
- [ ] 对比基线：适配前后同一任务集的完成率/首 token 延迟记录在案（吸收调优的效果可量化）。