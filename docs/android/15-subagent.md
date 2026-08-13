# 15 · sub-agent 与 AI 开发包（D16 / D17）

> 拍板（2026-08 用户）：sub-agent 做成包（新包类型 `subagent`）；AI 可开发任意类型包（含一键素材工作流）；dsh 仅作后置参考。本文是 D16/D17 的唯一执行规范。

## 1. 背景与决策依据

- **pi 无内置 sub-agent**（官方 README 明确 "No sub-agents"，设计哲学是"最小核心 + 扩展"），但官方提供参考实现 `examples/extensions/subagent/`：独立 pi 子进程、single/parallel/chain 三模式、agent 定义 = markdown + YAML frontmatter。
- **dsh 有完整 subagent 能力族**（`ctx.subagents` seam、in-process/external 多 provider、可延续委派、Activation 编排），但它是另一个架构成熟度层级（重、developer preview、API 不稳定）——**只借鉴设计，不引入**。
- **进程占用结论**（02 §4.3）：端侧单 Node 进程承载所有会话与 sub-agent（in-process），**不复制 pi 官方示例的子进程方式**——每任务一进程在手机内存（~2GB 可用）与冷启动（8–26s/次）上不可行；dsh 的 `spawn-in-process` 证明 in-process sub-agent 可行。
- **AI 开发包结论**（D17）：AI 不只是"用户要求的执行者"，也是"包的生产者"——文件夹即包（D14）泛化到全部类型；对比 dsh 的 `extensions/`（AI 用 `cordis_define/run/stop/undefine` 在内存中动态定义/挂载/卸载插件），我们选**不可变版本 + 回滚 + 审计**路线（更安全、可追溯），不做内存动态包。

## 2. subagent 包类型

### 2.1 内容物（包根目录）

```
com.daily.subagent.scout/
├── daily.pkg.json          # type: "subagent"
├── agent.md                # 角色定义（markdown + YAML frontmatter，见下）
└── prompts/                # 可选：工作流预设（scout-and-plan / implement-and-review...）
```

### 2.2 agent.md（沿用 pi 官方 frontmatter 语义，扩展工具白名单）

```markdown
---
name: scout
description: 快速侦察，返回压缩后的上下文结论
tools: [agent_fs_read, web_search, local_search]     # 工具白名单（∩ 父 agent 工具权限）
model: deepseek           # 或 openai/gemini...；留空 = 继承父 agent 当前模型
thinking: low             # 思考档（low/medium/high/max；默认 low，省钱）
timeout_s: 120            # 任务超时（默认 120）
spill_at: 65536           # 结果超过 64KB 转 spill（§4.4）
---

你是快速侦察员。任务：快速定位信息并返回精炼结论，不要展开实现。
```

- 校验：`tools` 必须在词汇表内且 ⊆ 安装包能力声明；`name` 全局唯一（反向域名前缀）；模型名不校验（BYOK 下由用户模型决定，提示词尽力适配）。
- 来源：商店安装 / AI 创建（D17，走文件夹即包）/ 用户上传。

### 2.3 内置角色（随系统分发，用户可卸载重建）

| agent | 用途 | 工具白名单 | 思考档 |
|---|---|---|---|
| scout | 快速侦察（读文件/搜索/总结） | 读类 + 搜索 | low |
| planner | 制定实施计划 | 读类 | medium |
| reviewer | 审查产物（代码/包/文案） | 读类 + 生图预览（可选） | high |
| worker | 通用执行（完整能力，受父权限） | 继承父 agent 全部 | 继承 |

## 3. 执行器（端侧 harness 内，M2）

### 3.1 执行器双档

| 档位 | 实现 | 适用 | 内存 |
|---|---|---|---|
| **in-process（默认）** | 同一 Node 进程内创建独立 pi 会话（复用会话工厂，上下文隔离，不共享工具副作用状态） | 全部常规任务 | 每任务 ≈ 会话上下文（几~几十 MB） |
| subprocess（可选，M2 后期） | spawn 独立 Node 进程（复用同一 harness 镜像，非完整 pi CLI） | 强隔离/用户指定/吃内存任务 | 每任务一个 Node 基座（~100MB+） |

默认 in-process；`daily.pkg.json` 可声明 `"executor": "subprocess"` 或调用时指定。**并发池对两档统一生效**。

### 3.2 全局并发池

- 全局上限：**8 并发**（in-process 与 subprocess 合计；subprocess 单独上限 2）。
- 超出排队（FIFO，带优先级：用户主动指派 > AI 自发派发）；队列上限 32，超限返回 `SUBAGENT_QUEUE_FULL`。
- 会话级限制：单个父会话同时活跃 sub-agent ≤ 4（防单会话打爆进程）。
- 后台节流：App 退后台时 sub-agent 挂起（可配置），回前台续跑；终止策略 = abort 传播。

### 3.3 中止与错误

- abort：父会话 abort → 级联中止所有活跃 sub-agent（in-process：abort 对应会话；subprocess：kill 进程树，同 RikkaHub `--kill-on-exit` 纪律）。
- 失败：`SUBAGENT_ERROR` + 诊断（stderr/error 摘要）；chain 模式停在第一个失败步骤并报告。

### 3.4 结果回流（防爆上下文）

- 单任务结果 ≤ **64KB** 截断（沿用 04 的 64KB 纪律）；超过转 **spill**（§4.4）：结果存本地（`agent/spill/<taskId>.json`），返回定位信息 + 取回提示，父 agent 可按需 `subagent_read(taskId, range)` 取回片段。
- parallel 模式：每个任务独立截断/spill，全部完成后合并回流（顺序 = 任务顺序）。

## 4. 模型面向工具（注册到端侧 pi）

```
subagent_spawn({ mode: "single"|"parallel"|"chain", agent?, task?, tasks?, chain?, options? })
  → 任务列表 [{ taskId, agent, status, result?, error? }]
subagent_status({ taskId | parentConversationId })   # 查询/等待
subagent_abort({ taskId })                            # 中止
subagent_read({ taskId, range? })                     # 读 spill 内容
subagent_list_agents()                                # 列出可用 subagent 包（商店+本地）
```

- 工具名与 schema 进能力词汇表 `subagent.spawn` / `subagent.manage`（03 §6），Broker 求交：**父 agent 工具权限 ∩ 包能力声明 ∩ 用户授权**；sub-agent 能用的工具 = 其白名单 ∩ 父 agent 可用工具（继承收缩，不放大）。
- 计费：sub-agent 使用用户 BYOK 模型，费用归用户 Key（同对话，无平台计费）；spill 存储占工作区配额。

## 5. AI 开发包（D17）

### 5.1 文件夹即包（D14 泛化，03 §4.1）

AI 创建/修改**任意类型包**的路径与建 App 完全一致：

```
用户：做一个"审稿"sub-agent，用它检查我的 App 文案
AI：  agent_fs_mkdir apps/…/subagent-reviewer/
      agent_fs_write agent.md（frontmatter + 提示词）
      agent_fs_write daily.pkg.json
      → 系统识别 type=subagent → 校验 → 注册 + 版本 v1
      → 对话中直接可用 subagent_spawn
```

### 5.2 与 dsh extensions 的对比（为什么选版本化）

| 维度 | dsh `extensions/`（cordis_define/run/stop/undefine） | 我们（D14/D17 文件夹即包） |
|---|---|---|
| 生命周期 | 内存动态包，undefine 即消失 | 不可变版本，可回滚，审计链 |
| 副作用 | 挂载/卸载即注册/撤销 | 安装/回滚即生效/还原 |
| 风险 | AI 误操作不可追溯 | 任何变更可回滚、可审计 |
| 即时性 | 秒级生效 | 需走校验+建版本（秒级） |
| 结论 | 适合调试期 | **我们选版本化**（更安全，符合红线 4） |

### 5.3 一键素材工作流（验收用例 A）

> 用户：*"给'夏日祭'桌宠主题做全套素材：图标、壁纸、桌宠场景、商店宣传图"*

1. AI 创建/选用 `workflow` 包 `com.daily.flow.asset-kit`（步骤图：调研风格 → 设计 tokens → 生图 → 打包校验）；
2. 执行：调研（web_search → scout）→ 设计（生成 theme tokens）→ 生图（imagegen provider，按用户配置）→ 产物写入包目录；
3. 产出：`theme` 包（tokens+壁纸）、`pet-layer` 包（场景 HTML+素材）、`app` 包（宣传页）——全部版本化，用户可在商店/我的中回滚。

**验收**：M2-12 完成时，上述用例产出全套资产、全部版本化、审计可查、任一步失败可重试不产生半成品版本（包事务：校验不过不建版本）。

## 6. harness 与前端分离开发（02 §3 配套）

### 6.1 目录（仓库级）

```
shared/agent-bridge-contract/   # ⭐ 本地桥 JSON-RPC schema（单一事实源，TypeBox）
server/src/piBridge.ts          # 现有服务端 pi 集成（维护模式；harness 从它抽取工具注册/会话逻辑）
client/android/agent/harness/   # Node/TS harness 源码（独立包，可单独构建运行）
client/android/agent/host/      # Kotlin：进程管理 + 桥客户端（前端侧）
client/android/core/            # Kotlin：契约 DTO 镜像 + 契约守卫 fixtures
```

### 6.2 分离方式

- **harness 先独立跑**：在开发机/本机 proot 以 Node 进程运行（与 M0-2 spike 同一形态），用 CLI 冒烟（`harness --smoke`）；工具注册逻辑从服务端 piBridge 抽取（同源改造，行为不变）。
- **前端 mock 先行**：桥客户端先对接 `mock-harness`（录制 JSON-RPC fixtures），UI 开发不被 harness 阻塞。
- **合并联调**：契约守卫（fixtures 反序列化测试）全绿后，真机直连真实 harness；合并测试用例见 §7。

### 6.3 harness 更新（M2）

- Node 运行时 + 内核包 = 版本化包（type=`harness` 或并入 model-pack 机制，M2 细化）：按需下载、校验、版本指针切换、回滚；不随 APK 捆绑（保 <40MB 红线）。

## 7. 验收标准（M2-11 / M2-12）

- [ ] `subagent_spawn` single：scout 完成侦察任务，结果回流（≤64KB 截断）正确。
- [ ] parallel：3 任务并行，全部回流且顺序稳定；并发池上限（8）生效，超限排队不崩。
- [ ] chain：scout → planner → worker 顺序执行，`{previous}` 上下文传递正确；中途失败停在对应步骤并报告。
- [ ] abort：父会话中止后，活跃 sub-agent 级联中止（in-process 与 subprocess 两档都验证）。
- [ ] spill：>64KB 结果转 spill，`subagent_read` 按 range 取回正确。
- [ ] 权限：sub-agent 工具 = 白名单 ∩ 父权限；越权调用被 Broker 拒绝（`CAPABILITY_DENIED`）。
- [ ] AI 创建 subagent 包：文件夹即包全流程（创建 → 校验 → 版本 v1 → 使用 → 修改 v2 → 回滚 v1）。
- [ ] 素材工作流（用例 A）产出全套资产、版本化、审计可查、失败可重试无半成品版本。
- [ ] harness 独立运行 + mock 桥联调全绿；契约守卫覆盖桥 schema。
