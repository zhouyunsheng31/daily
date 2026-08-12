# 07 · 权限分级与设备能力（Tier0 / Tier1）

> 依据（已拍板 D7）：两档产品档位 + 优雅降级。参考实证：RikkaHub 的纯 proot（无需任何特殊权限即获 Linux 环境）；Operit 的 Shizuku + libsu + 悬浮窗 + 截屏 + VoiceInteractionService 组合（源码核实，仅参考设计不抄代码）。

## 1. 档位定义（对用户的话术：标准模式 / 增强模式）

| 能力域 | Tier0 标准模式（默认，零门槛） | Tier1 增强模式（Shizuku） |
|---|---|---|
| 桌宠/悬浮图标/覆盖层 | `SYSTEM_ALERT_WINDOW` 悬浮窗（**本档即可**，引导重点） | 同左 |
| UI 自动化（点/滑/输入/读屏） | **AccessibilityService**（官方免 root 方案） | Shizuku shell `input`（更快更稳）+ 无障碍兜底 |
| 屏幕感知 | MediaProjection（用到才引导授权） | shell screencap /（后置：虚拟显示） |
| Linux 终端 | **proot Ubuntu（rootfs 按需下载，应用内进程，无需任何特殊权限）** | proot + 更宽 bind 挂载 |
| 应用管理 | 跳系统设置页引导手点 | `pm install/uninstall/disable`、`appops` 全自动 |
| 文件 | 应用私有目录 + SAF +（可选）MANAGE_EXTERNAL_STORAGE | shell 直读直写 |
| 系统设置 | 跳设置页 | `settings put` 直改 |
| 通知/设备信息 | NotificationListener（可选授权）、USAGE_STATS（可选） | + 全量 logcat / dumpsys |
| root 设备 | —（按 Tier0 走） | Shizuku 以 root 启动时自动获得 root 级能力；libsu 作兜底内置，不单设产品档 |

## 2. 能力矩阵与上报协议

客户端 `capability/` 模块采集以下布尔矩阵，变化时实时上报：

```
PUT /webos/api/device/capabilities
{ "tier": 0|1, "overlay": true, "accessibility": false, "mediaProjection": false,
  "notifications": true, "usageStats": false, "allFiles": false,
  "shizukuInstalled": true, "shizukuRunning": false, "shizukuPermission": false,
  "prootInstalled": false, "device": { "sdk": 34, "abi": "arm64-v8a", "ram": 12288 } }
```

- bootstrap 响应回带该矩阵（AI 决策依据）；服务端 Broker 调设备工具前必查。
- **工具多实现降级**：每个设备工具登记 `requires` 与实现链，例如点击：`shizuku input tap` → `accessibility dispatchGesture` → 报 unavailable（`CAPABILITY_UNAVAILABLE`，附引导动作 ID）。AI 收到 unavailable 时向用户解释并可发起引导卡。

## 3. 各能力实现要点（客户端）

### 3.1 悬浮窗（Tier0 核心，overlay-runtime）

- `TYPE_APPLICATION_OVERLAY` + `FLAG_NOT_TOUCH_MODAL` + RGBA_8888 透明。
- **点击穿透与可触发兼得**：窗口默认 `FLAG_NOT_TOUCHABLE`；桌宠/图标本体区域用透明像素 hit-test 动态切换 flag（拖动开始→清除 NOT_TOUCHABLE，结束→恢复）。
- 数量上限 12、后台停帧、锁屏隐藏（省电红线见 11）。
- 授权引导：`Settings.ACTION_MANAGE_OVERLAY_PERMISSION` 跳转 + 回来自动检测 + 继续原任务（J2 流程）。

### 3.2 无障碍（UI 自动化主力）

- `AccessibilityService`（`canPerformGestures`，API 26+ 满足 minSdk）：`dispatchGesture` 点击/滑动、`AccessibilityNodeInfo` 遍历读屏、`TYPE_WINDOW_STATE_CHANGED` 感知前台 App。
- 节点树 dump 做体积压缩（深度/文本长度截断）后进 AI 上下文；读屏属于敏感能力，能力词 `device.screen.read`/`device.ui.automate` 独立授权。
- 厂商通道：小米/华为等需额外"自启动/后台弹出界面"权限——引导卡内置按厂商跳转的 deep link 表（接 `device` 上报的 manufacturer）。

### 3.3 MediaProjection（截屏）

- 前台服务类型 `mediaProjection`（manifest 已声明范式参照 Operit）；每次会话需用户确认（系统限制），授权 token 在进程生命周期内复用。
- 截图输出走 09 文件服务（存工作区 `agent/screens/`），AI 经现有视觉桥（M3 vision）读取。

### 3.4 Shizuku（Tier1）

- 集成 `dev.rikka.shizuku:api` + `provider`；manifest 声明 `moe.shizuku.manager.permission.API_V23`。
- 状态机：`未安装 → 已安装未运行 → 运行中未授权 → 已授权`；binder 死亡监听自动降级回 Tier0。
- 执行模型：经 Shizuku 的 `newProcess` 跑 shell 命令；输出 128KB 截断（对齐 RikkaHub 防爆上下文标准）。
- 激活教学（J2）：图文三步（装 Shizuku → 无线调试/root 启动 → 回 App 检测），提供"复制无线调试配对步骤"。

### 3.5 proot Linux（M2，按需下载）

- APK 内置 proot 二进制（arm64）；rootfs（Ubuntu 24.04 base，~200MB）**按需下载**（对齐 APK <40MB 红线）。
- 运行器语义对齐 RikkaHub 已验证方案：`--root-id --link2symlink --kill-on-exit -r <rootfs> -w <cwd> -b <工作区挂载>`，stdout/stderr 各 128KB 截断，超时强杀，daemon 线程防泄漏（自行实现，不抄代码）。
- 工作区挂载策略：服务端文件经 09 同步落在应用私有目录后 bind 进 proot——**AI 在终端里看到的工作区与云端一致**。

## 4. Broker 求交流程（服务端，每次设备工具调用）

```
tool.requires ⊆ 包能力声明(manifest)          ① 包声明
            ∩ 用户授权（设置页开关，可按 本次/会话/永久 粒度）② 用户
            ∩ capability matrix（设备真实状态）               ③ 设备
            ∩ 平台策略（管理端全局开关）                      ④ 平台
  → 全过才经 WSS 下发 tool_call；任一失败返回结构化 unavailable（含引导动作）
```

审计：每次调用记录 userKey/device/tool/params 摘要/成败/耗时（管理端 trace 可查，沿用 08-13 决策标准）。

## 5. 验收用例

- 无 Shizuku 新机：仅授权悬浮窗 + 无障碍，即可完成"AI 做桌宠""AI 帮你点xx"全流程；其余能力显示 unavailable 且引导卡可完成授权闭环。
- Shizuku 激活后：同一"点击"任务时延显著低于无障碍路径（埋点对比）；杀掉 Shizuku 进程后自动降级无障碍，任务不失败。
- 授权撤销：系统设置里关掉悬浮窗 → capability 实时上报 → 进行中的桌宠任务收到明确提示且不崩溃。
- proot（M2）：未下载 rootfs 时终端功能明确提示"需下载 200MB"；下载后可跑 `python3 --version`，工作区文件双向一致。