# Daily 接入 dsh 本机 LLM 中转（模型目录多 provider）

> 2026-09-05。让 daily 的 AI 对话模型统一走 dsh（DeepSeek Harness，本机 154.219.108.99）
> 当中转站：**dsh 能用的模型 = daily 后台可选用的模型**；dsh 换套餐/增删模型后，
> 在后台重新「获取模型列表」即同步，接口地址永不需改。
> 同时保留直连各家 AI 服务商（endpoint+key 直填）的既有能力。

## 1. 一句话原理

```
daily 管理后台「模型目录」每行模型:
  endpoint = https://154.219.108.99:10443/dsh-relay/v1   （dsh 中转地址）
  api_key  = <dsh 中转密码>                                （同 Basic 密码）
  model    = dsh 当前可用模型 id（如 glm-5.3-flash / deepseek-v4-flash）
→ daily 对话/标题请求发往 dsh 中转 → dsh 本机按 model 路由到火山 Ark / opencode 网关
→ 上游 key 永不出 dsh 本机。套餐/额度用尽时错误原样返回（不自动切模型/套餐）。
```

## 2. 后台操作（admin 站点 →「模型目录」）

### 2.1 首次接入（导入 dsh 全部模型）
1. 「从 provider 拉取模型列表（自动导入）」：
   - provider：`dsh`
   - endpoint：`https://154.219.108.99:10443/dsh-relay/v1`
   - API Key：dsh 中转密码（与 dsh Basic 密码同一个）
   - 点「获取模型列表」→ 出现 dsh 当前模型（如 `kimi-k3` `glm-5.3` `glm-5.3-flash` `deepseek-v4-flash`）
2. 逐个点「+」导入；或手动「新增模型」填同 endpoint/key。
3. 编辑各模型行确认参数：`supportsThinking`（Ark 思考模型开）、
   成本/上下文可改可不改（仅展示与计费预估）。
4. 把想作为默认的行点「设默认」（影响游客/未选模型会话的默认模型与标题生成）。

### 2.2 日常换模型/换套餐
- dsh 侧增删模型或换套餐后，**无需改任何接口**：回到上述拉取框再点一次
  「获取模型列表」，对新出现的模型「+」导入即可；已被移除的模型行可「删」。

### 2.3 仍要直连服务商？
- 照旧新增一行：endpoint 填服务商 OpenAI 兼容地址、API Key 填服务商 key、
  provider 用自己起的名字。直连与 dsh 中转行可并存，用户对话页可切换。

## 3. 服务端代码要点（2026-09-05 变更）

- `server/src/piBridge.ts` `registerCatalogModels`：
  - **逐 provider 独立注册**——某 provider 配置不合法不再拖垮整个目录（此前会导致
    新加的 dsh provider 完全不注册、报 model not found）；
  - `endpointRejectsDeveloperRole()`：volces/中转 IP 等端点注册 `supportsDeveloperRole:false`
    （否则 pi 发 `role=developer` 被 Ark 400 拒绝）。判断规则见单测
    `test/unit/dshRelayCompat.test.ts`。
- 无 key 直连 provider（如本地测试缺 chatst key）只会被跳过并打 warn，不影响其它行。

## 4. 部署注意（对接 dsh 公网中转的 TLS）

dsh 中转公网地址 `https://154.219.108.99:10443` 使用**自签证书**（SAN 154.219.108.99）。
daily 服务器 Node 进程调用该地址前必须信任证书，否则 fetch 直接 TLS 拒绝：

```bash
# 在 daily 服务器上：
# 1) 把 dsh 证书传到服务器（任意路径，如 /data/dsh-cert.pem，chmod 644）
# 2) 在 daily-server 进程环境加：
NODE_EXTRA_CA_CERTS=/data/dsh-cert.pem
# 3) 重启 daily-server（pm2 restart daily-server）
```

- pm2 注入环境变量：`pm2 restart daily-server --update-env` 前先
  `export NODE_EXTRA_CA_CERTS=/data/dsh-cert.pem`，或写入服务器
  `/root/daily/server/.env`（daily 启动脚本会 source 该文件）。
- 验证：在 daily 服务器上 `curl --cacert /data/dsh-cert.pem
  https://154.219.108.99:10443/dsh-relay/v1/models` 应返回模型 JSON。

## 5. 故障排查

| 现象 | 原因/处理 |
|---|---|
| 拉列表 401 | API Key 不是 dsh 中转密码 / 填错；Basic 与 Bearer 用同一密码 |
| 对话报上游 401/429/403 | dsh 侧该模型对应套餐额度/到期——错误已原样透传，属正常业务报错；去 dsh 侧补额或换套餐后重拉列表 |
| 400 `role: developer ... not valid` | 旧版本未带 supportsDeveloperRole:false；更新到本次代码后重启 |
| `model not found in registry` | 该 provider 注册失败（看服务端日志 `catalog provider ... skipped`）或模型行未启用 |
| TLS/CERT 报错 | daily 服务器未设 `NODE_EXTRA_CA_CERTS`（见 §4） |

## 6. Command Code（CC）模型接入（2026-09-05）

dsh 中转现在除 Ark/opencode 外还合并了 **Command Code（CC Go 套餐）** 的 35 个实测可用模型，
经 dsh 官方插件路径（`/data/cc-bridge`）转发，模型 id 以 `cc/` 前缀出现：

```
dsh/cc/moonshotai/Kimi-K3      dsh/cc/Qwen/Qwen3.8-Max     dsh/cc/xai/grok-4.5
dsh/cc/zai-org/GLM-5.3         dsh/cc/tencent/hy4-preview  dsh/cc/deepseek-v4-flash …
```

接入步骤与 §2 完全相同（同一个 dsh provider、同一 endpoint、同一 key）：
后台「获取模型列表」会返回全部 `cc/…` 模型 → 逐个导入即可（生产库已预置 35 行）。

注意：
- **`model` 字段要保留 `cc/` 前缀**（如 `cc/moonshotai/Kimi-K3`），relay 靠此前缀路由到 CC 桥；
- Claude 系列暂不可用（CC Go 档无权限，需 Pro 档；升档后 dsh 侧 `models.cc.json` 增加即自动可见）；
- CC 套餐与 Ark 是**独立额度**——Ark 周配额用尽不影响 CC 模型。

## 7. 2026-09-05 更新：清理 Ark + 工具调用修复

- **火山方舟已下线**：生产模型目录删除全部 Ark 行（`dsh/glm-5.3*`、`dsh/kimi-k3` 经 relay→Ark，
  `opencode/deepseek-v4-flash`×2 直连 Ark），现仅剩 35 行 `dsh/cc/*`（CC 桥）。
  relay 侧 `RELAYABLE_PROVIDERS` 置空，`/v1/models` 只返回 `cc/*`，后台重新拉列表不会再带 Ark。
  Ark 周配额 429 报错也随之消除（CC 已成唯一模型源）。
- **CC 工具调用修复**：bridge 现支持 OpenAI `tools`/`tool_calls`/`tool` 结果完整往返
  （此前 CC 模型收不到工具定义、只能虚构文本工具调用）。生产 webos 实测：CC 默认模型
  触发 `agent_fs_list` → `tool_start/tool_end` 实际执行 → 基于结果作答。
- 生产目录现状：35 行 `dsh/cc/*`，默认 `dsh/cc/deepseek/deepseek-v4-flash`。

## 8. 2026-09-05：CC 中间思考屏蔽 + system 约束修复（dsh 侧）

- **中间思考屏蔽**：CC 网关模型（尤其 deepseek-v4-flash）只支持 high/max 思考档，daily
  默认档 medium 经 pi 放大为 high 发给 CC → 之前每轮都吐 `thinking` 卡片。现 dsh-cc-bridge
  默认吞掉全部 `reasoning_content`，只向 daily 转发纯 content 流 —— 与旧直连
  opencode zen（0 reasoning）表现一致。daily 无需任何改动。
- **system 忠实传递**：bridge 此前丢弃 system 消息，角色扮演/skill 约束不生效；现已将
  system/developer 传至 CC 插件 systemText。**无需改 daily 代码**（若需恢复思考可视化，
  在 dsh 侧设 `CC_BRIDGE_PASSTHROUGH_REASONING=1` 并重启 dsh-cc-bridge）。
- 验证：生产 webOS 事件流仅 `start/delta/done`（无 thinking）；翻译/角色约束严格遵循。

## 9. 2026-09-05（终）：CC 思考透传策略 + 稳定性

- **思考透传（用户确认策略）**：不截流。模型 reasoning 全部以 thinking 卡片转发给前端
  （思考推进可见、卡死可感知），最终回答（delta）照常保留。dsh-cc-bridge 默认透传
  `reasoning_content`，不再吞；长思考期不会因无字节而被 daily 180s 空闲超时误杀。
- **连接稳定性**：relay→bridge 真流式逐块转发（非缓冲），nginx/relay 超时均 900s；
  实测本地 max 档 2052 帧/10.9s、公网 302 帧/27s 均完整无断；生产 thinking+delta 正常。
- **标题生成**：为 dsh provider 补 `server/.env` 的 `DSH_API_KEY=<中转密码>`
  （仓库既有约定 `<PROVIDER>_API_KEY`，不改代码），消除「No API key for provider: dsh」。
- 旧模型引用（opencode/glm-5.3 等）已随 Ark 清理 + resolveModel 回退默认而不再触发 401/429。

## 10. 2026-09-05：思考断流重试 + 切片优化（dsh 侧）

- **思考半路停止修复**：dsh-cc-bridge 此前对 CC 上游偶发 TRANSPORT/TIMEOUT 断流直接终止流。
  现加：连接阶段静默重试（≤3 次）→ 中途断流发「连接波动，自动重连中…」通知并追加重试 1 次
  → 最终 content 一定完整；客户端断开即中止上游。401/403 等不可重试错误原样返回。
- **切片优化**：reasoning/text 按 6 字符微片高频转发（中文按码点切）。注：daily 服务端
  本身有 120ms SSE 合并窗口（防移动端卡顿的设计），故前端感知频率以 daily 窗口为上限；
  公网实测 87/88 帧 <10ms 到达，已逐块高频推送。
- 重试算法 4 场景单测 + 生产复杂任务（1863 字完整输出，stop=stop）验证通过。
