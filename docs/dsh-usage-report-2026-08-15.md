# DSH 使用情况报告（2026-08-15）

> 场景：用 DSH（DeepSeek Harness）sub-agent 对 Daily webOS 项目做安全漏洞审计。
> 结论先行：**DSH 本身工作正常且产出了高质量审计结果（96 次工具调用、发现 Critical×4 / High×10 / Medium×7+），但 `dsh_subagent` 工具链的状态监控存在缺陷，导致任务被误判为"假死"而中断，报告被截断（M7 未写完）**。完整抢救出的审计报告见 `docs/security/dsh-audit-2026-08-15-raw.txt`。

---

## 1. 实际操作时间线（本地 UTC+8）

| 时间 | 操作 | 结果 |
|---|---|---|
| 23:35 | 激活 `deepseek_harness` + `dsh_subagent` 包 | 成功 |
| 23:35 | `get_deepseek_harness_server_status` | ❌ `not reachable`（服务未运行） |
| 23:35 | `start_deepseek_harness_server` | ✅ 启动成功：`http://127.0.0.1:3081`，runtimeDir=`/root/sidebar_deepseek_harness` |
| 23:35:53 | `dsh_subagent_run`（async）发起安全审计任务 | ✅ `taskId=dsh-msujfuxy-2ltein`，status=running |
| 23:37 | `dsh_subagent_watch` 等待 | ⛔ 被用户手动取消 |
| 23:44 | `dsh_subagent_status` 查询 | ⚠️ running 但 **478s 内 0 steps / 0 turns / 0 tool_calls**，日志仅 `nohup: ignoring input` → **误判为"卡死在初始化"** |
| 23:44 | `dsh_subagent_cancel` 取消任务 | ✅ 进程 PID 13911 被 kill |
| 23:45–23:47 | 事后取证（见 §3） | 🎯 **发现任务其实一直在正常运行**，已产出完整审计报告（写到 M7 被取消打断） |

---

## 2. 遇到的问题（按严重度）

### P2（最严重）：`dsh_subagent_status` / `watch` 状态解析失效 → 任务"假死"误判 → 中断了有效工作

- **现象**：任务实际在跑（会话文件持续写入、LLM 在流式输出），但 `status` 返回 `sessionId=null`、`sessionMatched=false`、`steps=0`、`turns=0`、`toolCalls=0`、`currentActivity=null`，8 分钟无任何进展信号。
- **后果**：据此判断"卡死"并取消任务，白白中断了约 10 分钟的审计计算；报告在 M7 处被截断；后续需要重跑才能补全。
- **根因推测**：
  - DSH headless 的产出**不写 stdout**，而是写 `$DSH_HOME/sessions/<cwd编码>/session-<uuid>/session.jsonl.zstd`（zstd 压缩）。任务包装脚本 `nohup bash -c 'bash run/<taskId>.sh ...'` 的 stdout 日志里永远只有 `nohup: ignoring input` 一行——**日志管道天然不可用**。
  - 状态解析器大概靠「进程命令行匹配 sessionId」或「读取未压缩的 session.jsonl」来定位会话，两者都失败（sessionId 是 DSH 内部随机生成的 UUID，不在进程命令行里；磁盘上只有压缩文件），所以 `sessionMatched=false`，一切计数归零。
  - 这就解释了为什么 `watch` 长时间没有活动推送——它拿不到任何活动。
- **活着的信号（可用替代判据）**：`sessions/` 下对应会话目录的 `session.jsonl.zstd` **mtime 持续更新 / 文件持续增长** = 任务正常。

### P1：DSH 服务初始未运行

- `get_deepseek_harness_server_status` 返回 `not reachable`；`start_deepseek_harness_server` 一键启动成功。
- 教训：**用 `dsh_subagent` 前必须先查服务状态，未运行就先 start**，否则任务会失败或挂起。

### P3：`watch` 等待期间被用户取消

- 用户侧操作（非 DSH 缺陷），但也说明：watch 无进度推送 → 用户失去耐心。若 P2 修复（推送真实活动变化），此问题可缓解。

### P4：任务实时进度对用户完全不可见

- headless 模式产出全在压缩 session 文件里，日志面板只有一行 `nohup: ignoring input`，没有任何"正在读文件 / 正在写报告"的可见进度。
- 建议：run 脚本改为把 DSH 的实时输出（如果有 `--json`/verbose 参数）透传到 stdout，或至少周期性把 `session.jsonl.zstd` 的尾部摘要写入 out log。

### P5：取消后会话文件残留

- cancel 成功 kill 了进程，但 `sessions/--data-user-0-com.ai.assistance.operit-files-workspace-daily-daily--/session-d8b0054c-*/` 残留 1MB+ 压缩会话文件（最后写入 23:45），无自动清理。需手动清理或依赖 DSH 自身 GC（`storages/` 下也有数据）。

---

## 3. 关键取证过程（怎么发现"其实没卡死"的）

1. 读任务脚本 `run/dsh-msujfuxy-2ltein.sh`：`cd 工作区 → export DSH_HOME=/root/sidebar_deepseek_harness/dsh-home → export DSH_PERMISSION_MODE=danger-full-access → exec dsh --profile headless "$TASK"`（脚本本身无问题）。
2. 读 out log：只有 `nohup: ignoring input`（nohup 正常提示，说明包装脚本跑起来了，但 DSH 输出不进这里）。
3. 查 `$DSH_HOME/sessions/`：发现 `--data-user-0-com.ai.assistance.operit-files-workspace-daily-daily--/` 下有 23:36 创建（= 任务启动时间）的 `session-d8b0054c-*`，内有 **1MB+ 的 `session.jsonl.zstd`，23:45 仍在写入** → 任务活着！
4. 解压 `zstd -d session.jsonl.zstd` → 2858 行 JSONL：
   - `turn/start`、`step/start` 推进到 **step 81**；
   - **96 次 `tool/call`**（bash / todo_write / read 等，真的在读代码）；
   - `text-chunks` 事件显示 LLM 在**流式输出审计报告**（C1→M7 逐条生成）。
5. 用 python 拼接全部 `text-chunks` 的 `texts` → 得到完整报告文本（12941 字符），抢救保存。

**可复用命令**：
```bash
# 定位会话文件
ls -la "$DSH_HOME/sessions/<cwd编码>/"
# 解压
zstd -d -f session.jsonl.zstd -o /tmp/s.jsonl
# 统计工具调用
grep -c '"type": "tool/call"' /tmp/s.jsonl
# 提取 LLM 输出全文（python 拼接 text-chunks）
```

---

## 4. 根因分析汇总

| # | 问题 | 根因 | 责任方 |
|---|---|---|---|
| P1 | 服务未启动 | DSH web 服务不是常驻的 | 使用者（先查再启） |
| P2 | 状态解析失效 | 解析器与 DSH 真实产出（zstd 会话文件）不匹配；日志管道空转 | **dsh_subagent 工具链** |
| P3 | watch 被取消 | 无进度推送，用户等待体验差 | 工具链（P2 派生） |
| P4 | 进度不可见 | headless 输出不进 stdout | **dsh_subagent 工具链** |
| P5 | 会话文件残留 | cancel 不清理 session/storage 文件 | 工具链（低优先） |

---

## 5. 建议（给 dsh_subagent 工具链）

1. **状态解析改为读会话文件**：启动任务时记录 DSH 会话 UUID（可从任务脚本/环境或启动后扫描 `sessions/` 最新目录得到），status 直接解析 `session.jsonl.zstd`（zstd 解压到内存/临时文件），上报 steps/turns/toolCalls/最新文本。
2. **"活着"信号**：status 至少返回 `sessionFileMtime`/`sessionFileSize`，文件在增长 = 正常，避免"看起来像死了"。
3. **进度透出**：run 脚本周期性（如每 5s）把会话文件尾部摘要 append 到 out log，让 `tail` 能看到实时活动。
4. **watch 推送**：只有文件变化/新文本时才推送 intermediate result。
5. **cancel 清理**：kill 后删除对应 session 目录与 `storages/` 中的残留。

---

## 6. 本次实际产出（资产清单）

- ✅ `docs/security/dsh-audit-2026-08-15-raw.txt`（工作区，13KB）：DSH 实际产出的安全审计报告原文（被截断至 M7）：
  - **Critical ×4**：C1 entities 表全量 IDOR（任意用户可读写他人 webos_state/余额，可改积分绕计费）、C2 `/api/ai/settings/api-key` 明文泄露服务器 LLM Key、C3 AI 文件系统沙箱失效（命令注入绕过白名单 + 全局共享沙箱根 + 无鉴权开启工具 → RCE）、C4 WS deviceId 可伪造 + panelId 无归属校验（跨用户会话劫持）；
  - **High ×10**：H1 分享页存储型 XSS、H2 服务器级 AI/搜索配置可被游客篡改、H3 面板/组件 API 无归属校验、H4 iframe 桥 `http_fetch` 同源凭证代理、H5 公开 App 素材端点跨用户泄露+符号链接任意文件读、H6 SVG 背景上传 XSS、H7 积分扣费竞态+不足额截断、H8 `/webos/api/http` 重定向 SSRF、H9 `/api/ai/models` 用户可控 endpoint SSRF、H10 `/proxy` 设备代理无归属校验；
  - **Medium ×7（截断前）**：M1 游客 deviceId 客户端自选 + XFF 可信、M2 dev 模式无认证放行（内容未写完）、M4 登录/注册无限频（对比 emailAuth 有）、M5 600MB JSON body → 内存 DoS、M6 WS 消息无大小/频率限制、M7 Electron 31 EOL + 根依赖（截断）。
- ⚠️ 报告在 M7 处被取消打断，**缺 M3 与 M8-M10+、Low 级、修复优先级清单**；如需完整版，重跑任务（建议本轮修复 P2 后再跑，或直接用 sync 模式并放宽超时）。