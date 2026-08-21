# DSH Sub-Agent 已知问题与排障手册（2026-08-16）

> 本文档独立记录 DSH sub-agent 工具链（`dsh_task` / `dsh_subagent` 包）在实践中暴露的**基础设施问题、根因与规避方法**。
> 关联文档：`docs/dsh-subagent-usage-record.md`（08-15 使用记录，含首次串号/假死现象）、`docs/dsh-usage-report-2026-08-15.md`（08-15 报告）。
> 本文档是 08-16 大规模并行使用（3+2 个任务）后的排障沉淀，**补充了 08-15 未能定位的根因**。

## 0.1 修复状态总表（2026-08-16 · v0.5.7 / 2026-08-17 · v0.5.9 融合社区版 / v0.5.10 终态+模型覆盖 / v0.5.11 自动路由+model_router 修复）

> 以下问题已在插件 **v0.5.7**（com.operit.dsh_subagent，watcher 脚本 v8）中修复，上传市场后新装机自动生效；
> **v0.5.9（2026-08-17）融合社区新版（com.operit.deepseek_harness v0.5）优势后再升级**：硬性运行时限（`exec timeout` OS 级强杀，sync/async 均生效，上限 1h）、workspace-write 最小权限（可选参数，默认 danger-full-access 兼容历史）、任务目录迁移至 Linux 私有目录 `/root/sidebar_deepseek_harness/subagent-jobs`（umask 077 + chmod 700 + 输入即删，不再落 /sdcard）、cwd 默认隔离 `/root/dsh_workspace` 且禁 `/`、`/root`、新增 `dsh_subagent_cleanup` 清理工具、侧边栏入口改为「DSH Web（安装/管理）」定位（仅用于安装 runtime/配凭据，日常对话走 sub-agent 工具）。历史任务数据已迁移至私有目录（旧目录保留备份）。
> **v0.5.10（2026-08-17）**：① watcher v10 终态判定根治（死进程回收 + 答案完整即终态，消除"已出结果仍显示运行中/停滞"假象）；② `dsh_subagent_run` 新增 `model`（provider/model）与 `reasoningEffort`（off/low/medium/high/max）参数——给 headless-runner 打第三处补丁支持 `DSH_MODEL`/`DSH_REASONING_EFFORT` 环境变量（并入幂等 `apply-dsh-patch.sh` 第 4 步，逐补丁独立检查）；③ 两包同步升级（我们的 v0.5.10 / 社区版 v0.5.2）。
> **v0.5.11（2026-08-20）**：`dsh_subagent_run` **不传 `model` 时自动读取 Operit 当前 CHAT 绑定的模型并路由到 DSH 可用模型**（`modelSource=auto`，如 Operit `opencode` → DSH `opencode-go/deepseek-v4-flash`），AI 直接可用 Operit 配置的模型、无需手动指定 provider/model；`status`/meta 展示 `model`/`modelSource`/`autoModelInfo`。同时交付公共插件 **model_router**（读取 Operit 模型配置：list/find/current/deepseek-official，key 默认脱敏），并修复其「list_models 单参签名导致缺省返回明文 apiKey」与「functional_configs 顶层映射未解析导致 current_model 找不到绑定」两个 bug。

| # | 问题 | 修复（v0.5.7） | 位置 |
|---|---|---|---|
| 1 | watch.pid 陈旧/他人 PID → 状态解析瘫痪 | **PID 身份校验**：`/proc/<pid>/cmdline` 必须含 `dsh_watch.py` 才算存活（kill -0 通过但身份不符 → 覆盖重启）；插件 `ensureWatcher` 启动不再 `echo $!` 回写 bash PID（消除竞态），由 python3 自写 | `dsh_watch.py main()` + `dsh_subagent.ts ensureWatcher` |
| 2 | 同 cwd 并发串号/排队 | **根源消除（v0.5.8）**：查明 DSH headless 每次启动本就创建全新独立会话（`session-${randomUUID()}`），"串号"实为**解析层模糊匹配错会话**。修复：①给 headless-runner 打补丁支持 `DSH_SESSION_ID` 环境变量（已并入幂等 `apply-dsh-patch.sh`，runtime 升级后重跑即恢复）；②run 脚本注入 `session-<taskId>` 任务级唯一会话 ID；③解析层**优先按会话 ID 精确定位**，找不到才退回文本匹配。端到端实测：会话按 ID 落盘 + 精确命中。`assertNoSameCwdRunning` 明确报错保留；watcher `conflict` 检测降级为兜底 | `dsh_subagent.ts writeRunScript` + `parse_session.py find_session` + `apply-dsh-patch.sh` |
| 3 | 并行 run 偶发 Engine destroyed / 包 inactive | **run 启动流程模块级互斥**（`withRunLock`）：并行调用排队串行执行启动序列 | `dsh_subagent.ts` |
| 4 | DSH Web 服务中途不可达 | **run 前服务保障**：探测 127.0.0.1:3081，不可达自动拉起并等待就绪（最多 60s） | `dsh_subagent.ts ensureDshService` |
| 5 | watch 长轮询偶发 Engine destroyed | **降级轮询**：status 异常时自动读 watcher 的 state.json 对应条目继续等待，不中断 | `dsh_subagent.ts statusFromStateFile` |
| 6 | 任务卡死无超时自愈 | **停滞检测**：running 超 900s 且最近 300s 无活动（out 日志/会话文件 mtime）→ `stale` 标记 + 面板黄色警示"疑似停滞 N 分钟无活动"（不自动杀，避免误杀） | `dsh_watch.py detect_issues` + 面板 |
| 7 | **死进程假停滞（v0.5.10 新增根治）**：进程已退出但 code 未写时 `job_status` 旧 fallback `pid 文件存在即 running`，任务永远"运行中+疑似停滞"（实例：dsh-msx3uz5y 进程死、answer 10854 字完整，仍标 running/stale 30 分钟） | **终态判定 v10**：① `job_status` 死进程返回 `dead`，绝不再回填 running；② 新增 `resolve_dead`：按 out 日志 `EXIT_CODE=` → 会话完整答案（hasFinish / answer≥10 字）→ failed 兜底，判定终态并**补写 code 文件固化**（与插件 meta 判定一致，不每轮重复解析）；③ `finalize_agent` 仅进程存活时做回合级 finish 重置，存活+完整答案显示"✅ 已生成最终回复（等待进程退出）"而非停滞。实测：两个假停滞任务 v10 首轮即回收为 done(0) | `dsh_watch.py v10`（job_status / resolve_dead / finalize_agent） |
| 8 | **无法按调用指定模型（v0.5.10 新增）**：模型只能改全局 `agent-default-model`（settings.yaml），AI 不能为任务选模型；读图任务用 deepseek-v4-flash 报 `cannot read image` | **DSH_MODEL 按调用覆盖**：① runner 补丁（幂等第 4 步）：`const selection` → `let selection`，`DSH_MODEL=provider/model[/effort]` 与 `DSH_REASONING_EFFORT` 环境变量覆盖 selection（不改持久化配置）；② `dsh_subagent_run` 新增 `model`/`reasoningEffort` 参数，run 脚本透传；③ 端到端验证：`DSH_MODEL=opencode-go/ghost-model-xyz` → `UNKNOWN_MODEL`（读取生效）、`deepseek-v4-pro` + `medium` → `UNSUPPORTED_REASONING_EFFORT`（effort 生效且 DSH 校验模型能力）、合法模型到达 LLM 请求（余额 401 仅为通道欠费） | `apply-dsh-patch.sh` 第 4 步 + `dsh_subagent.ts writeRunScript/run` |

**其余环境侧建议（保留）**：每个任务用独立 cwd（勿用工作区根）；服务刚重启先做 10s 冒烟任务；>5 分钟 0 活动且会话无更新先 cancel 再重派。

---

## 0. 今日使用概况（2026-08-16）

| # | 任务 | taskId | cwd | 结果 |
|---|---|---|---|---|
| 1 | 识图 bug 修复（第一批） | dsh-msv9c6ix-geuch1 | 工作区根 | ❌ 卡死（服务重启过渡期启动，0 活动 765s），取消 |
| 2 | 对话框草稿修复 | dsh-msv9elkt-qxw3u | shell-web | ✅ 成功 |
| 3 | 系统时间能力 | dsh-msv9fdpv-2u3h0j | server | ✅ 成功 |
| 4 | 识图 bug 修复（重派） | dsh-msv9tbn8-55mixu | 工作区根 | ❌ 串号（会话被其他引擎的「SSH 检查」任务占用），取消 |
| 5 | 识图 bug 修复（再重派） | dsh-msvaagne-bk7vrx | scripts | ✅ 成功 |
| 6 | 壁纸 bug 修复 | dsh-msvc3n6f-6s77vo | e2e | ✅ 成功 |
| 7 | FFmpeg 全能力扩展 | dsh-msve61h6-gc0qk4 | scripts | 进行中 |

**结论：7 个任务 5 成功、2 失败；2 次失败均为工具链问题（非任务本身），重派 + 换 cwd 后成功。**

---

## 1. 问题一（最严重）：`watch.pid` 陈旧文件导致整个状态解析机制瘫痪

- **现象**：任务实际在跑（`ps` 可见 dsh headless 子进程、DSH session 文件持续写入），但 `dsh_subagent_status` 永远显示 `sessionMatched=false / buffered=true / steps=0 / toolCalls=0`，日志只有 `nohup: ignoring input`——看起来像"卡死在初始化"，**实际是状态上报没起来**。
- **根因（08-16 定位）**：`/storage/emulated/0/Download/Operit/dsh_subagent_jobs/watch.pid` 残留了**已死进程的 PID**（如 24789）。watch.py 每次启动检查 `kill -0 <pid>` 通过则写 "already running pid 24789" 退出；但该 PID 已不存在 → `watch.log` 永远只有 `already running pid 24789`，**watch/parse 进程从未真正运行**，状态解析（sessionMatched）不工作。
- **08-15 关联**：08-15 的"假死误判"（任务实际正常产出，status 却显示 0 活动）很可能就是同一个根因。
- **修复**：删除陈旧 pid 文件后 watch 机制自愈：
  ```bash
  rm -f /storage/emulated/0/Download/Operit/dsh_subagent_jobs/watch.pid /storage/emulated/0/Download/Operit/dsh_subagent_jobs/watch.log
  ```
- **判断任务是否真在跑（不依赖 status）**：
  ```bash
  ps --ppid <bash_pid> -o pid,cmd     # 应有 node .../dsh/bin.js --profile headless 子进程
  ls -lat /root/sidebar_deepseek_harness/dsh-home/sessions/--<cwd 路径编码>--/   # 目录/文件时间戳持续更新 = 活跃
  ```

## 2. 问题二：同一 cwd 同时只允许一个运行中任务 → 排队/串号

- **现象**：任务（dsh-msv9tbn8-55mixu，cwd=工作区根）启动后 700s+ 零活动；解压会话文件发现内容是**另一个引擎的「SSH 检查」任务**（pm2/服务器目录检查）——我的任务与并发会话的任务在同一个 cwd 下**串号**。
- **根因**：DSH headless 按 `--profile headless` 全局单活跃会话，且工具按 cwd 分组复用会话；同一 cwd 下并发（含其他 Operit 会话/引擎）启动的任务会被附加到已有会话或排队，表现为"自己的任务 0 活动"。
- **规避（重要）**：
  - 每个任务用**独立 cwd**（如 `client/shell-web`、`server`、`scripts`、`e2e` 等子目录）——本次成功任务全部如此；
  - **不要用工作区根作 cwd**（其他引擎默认用它，冲突概率最高）；
  - 任务书里明确"工作区根用绝对路径访问"，cwd 只是隔离用。
- **识别**：任务长时间 0 活动时，解压对应 cwd 的 session 文件（`python3 -c "import zstandard..."` 或 `zstdcat`）看内容是否属于自己。

## 3. 问题三：并行调用 `dsh_subagent_run` 偶发 `Engine destroyed` / `Tool not found`

- **现象**：同一消息里并行发 3 个 `dsh_subagent_run`，只有第 1 个成功，后两个报 `Engine destroyed` 或 `Tool not found: dsh_subagent:dsh_subagent_run`，随后整个 `dsh_subagent` 包变 `inactive`（`use_package` 报容器未启用）。
- **规避**：**串行发起**（每次只调一个 run，成功返回后再调下一个）；失败后重新 `use_package dsh_task` 激活再调。

## 4. 问题四：DSH Web 服务中途不可达

- **现象**：`dsh_subagent` 包激活失败（`container 'com.operit.deepseek_harness' is not enabled`）、`dsh_service:get_deepseek_harness_server_status` 报 `not reachable`。
- **修复**：`dsh_service:start_deepseek_harness_server` 一键启动（`http://127.0.0.1:3081`，runtimeDir `/root/sidebar_deepseek_harness`）。
- **注意**：服务重启过渡期启动的任务可能连不上会话（问题二/三的诱因之一），服务刚重启后先做一次 10s 冒烟任务再派正式任务。

## 5. 问题五：`dsh_subagent_watch` 长轮询偶发 `Engine destroyed`

- **现象**：`watch` 阻塞 600s 期间偶发 `Engine destroyed` 报错返回，任务仍在后台。
- **规避**：watch 失败后改用**轮询 `dsh_subagent_status`**（sleep 60-120s + status）；或直接看进程/session 文件活跃度（见问题一）。

## 6. 问题六：任务无超时自愈，卡死需人工取消

- **现象**：串号/排队任务可无限 running（0 活动），不会自动失败。
- **规避**：>5 分钟 0 活动且 session 文件无更新 → `dsh_subagent_cancel` 取消 → 换 cwd 重派；不要干等。

---

## 7. 使用清单（每次派任务前检查）

```bash
# 1. 服务可用
dsh_service:get_deepseek_harness_server_status  # 不可达则 start
# 2. watch 机制健康（防止问题一）
cat /storage/emulated/0/Download/Operit/dsh_subagent_jobs/watch.pid  # 若存在且 kill -0 失败 → 删除 pid/log
# 3. cwd 隔离
#    每个任务用独立子目录 cwd；绝不共用工作区根
# 4. 串行发起；失败重激活 use_package dsh_task
# 5. 状态异常时直接看进程/session 文件，不要仅凭 status 判断
```

## 8. 遗留观察项（2026-08-16 更新）

- ✅ **已实现（v0.5.7）**：watch.pid 陈旧/他人 PID 自动覆盖——`pid_is_watcher()` 校验 `/proc/<pid>/cmdline` 含 `dsh_watch.py` 才算存活；插件 `ensureWatcher` 启动不再回写 bash PID。实测：写入非法 PID 1（init 进程，kill -0 通过）→ 输出 `stale/foreign pid 1, overwriting` 并正常接管。
- ✅ **已实现（v0.5.7）**：会话占用"明确报错 + 提示"——run 前 `assertNoSameCwdRunning` 明确拒绝同 cwd 并发（不静默排队）；运行中若检测到会话被其他任务占用，面板标 `conflict` 警示。DSH 官方"会话独占锁"机制仍属上游建议。
- ⏳ 未做：停滞任务**自动取消**（当前只标记警示不自动杀，避免误杀正常长任务；如需自动取消可在 `dsh_watch.py` 加 `AUTO_CANCEL_STALE=True` 常量并配套 `dsh_subagent_cancel` 调用）。
