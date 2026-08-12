# 08 · 媒体与模型预留位（TTS / ASR / 视觉 / 本地模型）

> 拍板（D8）：M1 **不实现**语音对话，但必须把位置留好——Provider 抽象、计费目录、能力词、包类型、UI 入口五处预留，后续接入不改架构。

## 1. 媒体能力全景与现状

| 能力 | 现状（服务端已有） | 后续 |
|---|---|---|
| 对话 LLM | DeepSeek V4 Flash（pi provider，四档思考） | 不变 |
| 视觉（AI 的"眼睛"） | MiniMax-M3 视觉桥（读图/截图描述） | 不变，Android 截屏复用 |
| 生图 | gpt-image-2-super（ChatST 网关） | 不变 |
| 生视频 | videogen 模块 | 不变 |
| **TTS** | ❌ 无（billing catalog 已预留 `kind:'tts'`） | M2/M3 接云端 TTS |
| **ASR** | ❌ 无 | M2/M3：先系统语音识别（免费兜底）+ 云端高质量 ASR |
| **本地 LLM/模型** | ❌ 无 | M3：model-pack + llama.cpp（参考 Operit/MNN 路径，自研） |

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

- **统一管线**：鉴权 → Provider 选择（用户设置/默认/兜底链）→ 调用 → 用量落库（沿用 `webos_imagegen_usage` 同构表）→ 计费（积分制）→ 审计。
- **端云路由策略**：ASR 优先走 Android 系统 `SpeechRecognizer`（0 成本、离线可用场景多）→ 用户可选云端高质量 ASR（计费）；TTS 默认云端（音质），本地系统 TTS 兜底（0 成本）。
- 新 Provider = 新增一个实现类 + 管理端配置项，**不改调用方**。

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