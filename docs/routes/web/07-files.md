# 07 · 文件工作区 + File Service 一阶段（web 路线）

> 现状：工作区目录 + agent_fs_* + 文件夹即 App + 分片上传已验证。本文定义 File Service 一阶段——**为移动端同步铺路（manifest 锚点），并补齐用户文件版本与元数据**。方案同源 docs/android/09，web 先行落地。

## 1. 现状盘点（实证）

```
data/workspace/webos/<userKey>/
├── meta.json / README.md / logs/execution.log
├── home/      # 用户可见区（文件管理器展示；上传/下载走这里）
├── apps/<appId>/   # App 源码+素材镜像（版本化；文件夹即 App）
├── shared/    # 跨 App 共享区（app.fs.shared）
├── system/    # 品牌/主题/桌面模板素材
├── agent/     # AI 私有区（草稿/中间产物）
└── skills/    # 用户级技能
```

- 已有：分片上传（8MB 片 + 断点续传）、公开素材免鉴权端点（UUID 不可枚举）、回收站（system.trash）、配额（workspaceBytes）。
- 缺口（同 android/09 病灶）：文件只有磁盘没有元数据层（无 etag/清单 → 移动端无法增量同步）；用户文件无版本；配额统计散落。

## 2. File Service 一阶段（`server/src/webos/files/`）

### 2.1 元数据层

```sql
files         (id TEXT PK, user_key TEXT, path TEXT, size BIGINT, sha256 TEXT(etag),
               mime TEXT, version BIGINT, deleted_at BIGINT, updated_at BIGINT)
file_versions (id TEXT PK, file_id TEXT FK, sha256 TEXT, size BIGINT, created_at BIGINT)  -- 按需快照
```

- **路径语义不变**：home/ agent/ system/ apps/ skills/ 与现有 agent_fs 工具、文件夹即 App 机制完全兼容——AI 工作方式零变化。
- **元数据先行**：每次写（agent_fs_write / REST / 同步推送）同时落 files 行（upsert，sha256+size+mtime）；后台 reconcile 兜底对齐（磁盘 ↔ 表 diff 为空）。
- **用户文件版本**：AI 批量改写前自动建轻量快照点（记录变更前 sha256 引用；blob 按内容寻址去重）；提供"恢复到改写前"粒度，不做全量 Git。

### 2.2 REST API（web 与移动端共用）

```
GET    /webos/api/files/manifest?prefix=home/    # 全量清单（path/size/etag/mtime）——移动端同步锚点
GET    /webos/api/files/blob?path=               # 下载（支持 Range）
PUT    /webos/api/files/blob?path=               # 小文件直传（≤8MB）
POST   /webos/api/files/upload/init              # 大文件分块 {path,size,sha256} → {uploadId, chunkSize}
PUT    /webos/api/files/upload/:id/:chunkIndex   # 分块上传（断点续传）
POST   /webos/api/files/upload/:id/complete      # 合并+校验 sha256 → 落 files 行
DELETE /webos/api/files?path=                    # 删（进回收站语义）
POST   /webos/api/files/snapshot                 # 手动快照点
```

### 2.3 agent_fs 双写适配

`agent_fs_*` 实现体内嵌双写（磁盘 + files 元数据），工具签名与行为不变（AI 无感知）；`apps/` 写路径的即时建版本回调保持现状。

## 3. 配额与公开素材

- 配额统计改以 files 表为准（reconcile 对齐磁盘）；workspaceBytes 展示误差 <1%。
- 公开素材双写目录继续（App 沙箱 iframe 不带 cookie → 免鉴权 + UUID 不可枚举），删除时清理孤儿副本。

## 4. 与移动端的衔接

- **manifest 端点是移动端同步的锚点**（routes/mobile.md D-M4）：移动端 M1-7 文件同步依赖本文一阶段先落地。
- 同步语义（LWW + conflict 副本 + 加密会话日志同步）见 docs/android/09 §3；web 路线只负责把服务端侧端点/元数据做扎实。

## 5. 验收用例

- 50MB 视频分块上传（中途断网 3 次）续传成功，sha256 一致。
- AI 用 agent_fs_write 批量改 20 个文件 → 自动快照点存在 → "恢复到改写前"一键完成。
- reconcile 跑批后 files 表与磁盘 diff 为空；配额展示与实际占用误差 <1%。
- manifest 端点返回结构与 fixtures 一致（移动端契约守卫直接消费）。