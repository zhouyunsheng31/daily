# 09 · 文件系统评估与重构（File Service）、同步与备份

> 回答用户提问："现在的文件系统/项目是不是太烂了？要不要借 Android 端重构一轮？"
> 结论：**不推倒重来，但做一轮外科手术式重构**——文件服务单独立柱、单体文件冻结+增量拆分。以下是实证与方案。

## 1. 现状评估（实证，非拍脑袋）

**现有实现**：服务端为每个用户在磁盘开工作区目录（`data/workspace/webos/<userKey>/`：home/ 用户区、agent/ 草稿、system/ 素材、apps/ 即 App、skills/ 用户级技能）；AI 经 `agent_fs_*` 工具直接读写；App 文件夹镜像 ↔ DB 版本自动建版本；已有视觉桥、回收站、配额（workspaceBytes/Limit）、公开素材免鉴权 raw 端点。

**好的部分（保留）**：文件夹即 App 的心智极简且已被验证；AI 工具链成熟；视觉桥/审计齐全。

**真实病灶（按严重度排序）**：

| # | 病灶 | 证据/后果 |
|---|---|---|
| P1 | **单体文件失控** | webos.ts 409KB、piBridge.ts 114KB、App.tsx 182KB——改一行全量回归，新 AI 上手成本极高 |
| P2 | **文件只有磁盘、没有元数据层** | 无 etag/版本/清单端点 → 移动端无法做增量同步，只能全量拉；上传曾踩 nginx 413（bug-upload-413.md） |
| P3 | **REST 文件 API 单薄** | 只有列表 + raw 读；无分块上传/断点续传/范围读取，移动网络下大文件体验差 |
| P4 | **用户文件无版本** | App 有版本，home/ 用户文件没有——AI 误删误改不可回滚，与"永远回得去"原则冲突 |
| P5 | **配额/统计散落** | workspaceBytes 统计与真实磁盘靠定时对齐，多副本（工作区+DB镜像+公开目录双写）口径易漂 |

## 2. 重构方案：统一 File Service（`server/src/webos/files/`）

### 2.1 目标模型

```
元数据（DB）                                内容（blob）
files 表：                                  存储后端：
 id | user_key | path | size | sha256(etag)|  - M1：磁盘（现有目录结构不变，零迁移）
 mime | version | deleted_at | updated_at    - 接口抽象 BlobStore，M3 可换对象存储
```

- **路径不变**：`home/ agent/ system/ apps/ skills/` 语义与现有 agent_fs 工具、文件夹即 App 机制完全兼容——AI 工作方式零变化。
- **元数据先行**：每次写（agent_fs_write / REST / 同步推送）同时落 files 行（upsert，sha256+size+mtime）；后台 reconcile 任务兜底对齐（解决 P5）。
- **用户文件版本（解决 P4）**：`file_versions` 表按需快照——AI 批量改写前自动建快照点（轻量：仅记录变更前的 sha256 引用，blob 按内容寻址去重）；设置页提供"恢复到昨天"粒度即可，不做全量 Git。

### 2.2 REST API（移动端与 PWA 共用）

```
GET    /webos/api/files/manifest?prefix=home/     # 全量清单（path/size/etag/mtime），同步的锚点
GET    /webos/api/files/blob?path=                # 下载（支持 Range 头）
PUT    /webos/api/files/blob?path=                # 小文件直传（≤8MB）
POST   /webos/api/files/upload/init               # 大文件分块：{path,size,sha256} → {uploadId, chunkSize}
PUT    /webos/api/files/upload/:id/:chunkIndex    # 分块上传（可断点续传）
POST   /webos/api/files/upload/:id/complete       # 合并+校验 sha256 → 落 files 行
DELETE /webos/api/files?path=                     # 删（进回收站语义）
POST   /webos/api/files/snapshot                  # 手动建快照点（备份/恢复的内部机制）
```

nginx 侧：`client_max_body_size` 与分块大小对齐（默认 chunk 4MB），根治 P2 的 413 类问题。

### 2.3 agent_fs 工具适配

`agent_fs_*` 实现体内嵌双写（磁盘 + files 元数据），工具签名与行为不变（AI 无感知）；`apps/` 写路径的即时建版本回调保持现状。

## 3. 移动端同步协议（`sync/` 模块）

```
上行：本地改动队列（创建/修改/删除，带 baseEtag）
  → 逐条 PUT/分块上传 → 服务端校验 baseEtag（不匹配 → 409 冲突）
下行：定时/触发式 GET manifest → 与本地清单 diff（etag+size）→ 下载新增/变更
冲突：LWW（按 updatedAt）+ 败方存 conflict 副本（path.conflict.<ts>）→ 用户在文件管理器可见
```

- 本地镜像位置：应用私有目录 `files/workspace/`（proot bind 源，07 §3.5）。
- 同步范围默认 `home/`（用户文件）；`apps/` 由包管理器按版本下载（不进双向同步，避免与版本机制打架）。
- **会话日志同步（D15，02 §7）**：本地 AI 会话日志/记忆按 `agent/sessions/` 走同一 manifest 协议**加密**同步到服务端用户域（换机恢复、管理端 trace 排查）；同步为后台行为、设置页可关闭（隐私）。**同步 ≠ 对话链路依赖**——离线时本地会话完整可用，恢复后仅做 LWW 合并（同会话以 updatedAt 为准，不双写）。
- 离线：读走本地镜像秒开；写操作入队，网络恢复自动重放（WorkManager 约束：有网 + 低电量不跑大文件）。

## 4. 备份

| 类型 | 机制 | 保留 |
|---|---|---|
| 云端自动备份 | WorkManager/服务端定时：files manifest + DB 用户域（聊天/包指针/桌面布局/设置）打包加密归档 → 对象存储（M1 先存服务端磁盘目录） | 7 日 + 4 周 + 12 月 |
| 云端手动备份 | 设置页"立即备份"；可见上次备份时间与大小 | — |
| 本地导出 | SAF 导出同一格式的加密归档（用户自选目录，换机/离线场景） | 用户自持 |
| 恢复 | 导入归档 → 校验 → **以新版本指针落库**（App/桌面回滚到备份点，文件恢复快照）→ 可再回滚 | — |

红线：归档不含任何 Provider 密钥（DEEPSEEK/CHATST 等永不出服务端）；用户 secrets（05 的外部 API 密钥）加密后随归档，口令=账号会话派生；**端侧 BYOK 模型密钥（08 §6.2）永不入任何归档**（仅存 Android Keystore，不上传、不导出）。

## 5. 与单体拆分的衔接（落地顺序）

1. 新建 `server/src/webos/files/`（File Service）与 `server/src/webos/backup.ts`——纯新增，零风险。
2. agent_fs 双写适配——行为不变 + 回归用例（现有工作区冒烟脚本 + Playwright 手册流程）。
3. 从 webos.ts 抽出 workspace/files 相关路由进新模块（触及即瘦身纪律的第一次执行）。
4. 全部新域（packages/appApi/rooms/capability/media）只进 `webos/` 新模块（02 §6.2）。

## 6. 验收用例

- 50MB 视频经分块上传（中途杀网 3 次）续传成功，sha256 校验一致。
- 手机 A 改 `home/笔记.md` → 10 秒内网页端文件管理器可见同内容；两端同时改 → 产生 conflict 副本且双方可打开。
- AI 用 agent_fs_write 批量改 20 个文件 → 自动快照点存在 → "恢复到改写前"一键完成。
- 云备份后换新机登录 → 一键恢复：App 列表/版本/桌面布局/文件/聊天全量还原；恢复后再回滚到恢复前状态可用。
-  reconcile 跑批后，files 表与磁盘 diff 为空；配额展示与实际占用误差 <1%。