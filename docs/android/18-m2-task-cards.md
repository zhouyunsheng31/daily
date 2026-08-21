# 18 · Android M2 任务执行卡（统一包市场消费与服务即包生产）

> 版本：v1（2026-08-21 定稿）
> 定位：执行 AI 必读。移动端消费统一包市场（W3 体系）、端侧 AI 文件夹建包与 API 云端托管发布（服务即包），以及账号登录资产漫游。

---

## 任务进度概览

| 卡 | 任务 | 状态 | 目标 |
|---|---|---|---|
| **M2-1** | 统一包市场消费 | ✅ 完成 | 市场列表、包详情（含数据范围/依赖）、一键安装闭包、我的安装、包下架 |
| **M2-2** | 端侧服务即包生产与托管发布 | ✅ 完成 | 端侧建包、发布到市场、公开 API 管道发布与脱敏 secrets 托管 |
| **M2-3** | 账号认证与跨端资产漫游 | ✅ 完成 | 邮箱验证码注册/登录/重置密码、游客资产迁移、多端数据同步 |

---

## 卡 M2-1：统一包市场消费

**目标**：在 Android 客户端内完整支持统一包市场（万物皆可包：App / API / Theme / Skill）的浏览、搜索、详情与安装。

**验收标准**：
- [ ] `WebosApi` / `DailyJsBridge` 覆盖 `listMarket`、`getMarketDetail`、`installMarketPackage`、`listMarketMine`、`unpublishMarketPackage`；
- [ ] 商店模板（`system.store`）在沉浸 WebView 中正常渲染市场条目与作者信息；
- [ ] 点击安装带有依赖的包时，后端依赖闭包安装并实时刷新客户端已装包列表。

---

## 卡 M2-2：端侧服务即包生产与托管发布

**目标**：移动端 AI 或创作者在本地工作区创建「文件夹即包」（含 `daily.pkg.json`、`api.json`、`main.js` 受限 handler）后，支持一键发布到云端托管代跑。

**验收标准**：
- [ ] 支持 `publishMarketPackage(packageId)` 发布包到市场；
- [ ] 支持 `publishAppApiNamespace(namespace)` 发布公网受限 API 管道；
- [ ] 支持 `setAppApiSecrets(namespace, values)` 托管私有 API Key（明文绝不出服务器，脱敏注入）；
- [ ] 支持 `getAppApiSecretsStatus(namespace)` 查看已配置状态。

---

## 卡 M2-3：账号认证与跨端资产漫游

**目标**：支持邮箱验证码注册/登录，自动将游客资产（包/工作区/私有数据）迁移至账号，多端漫游。

**验收标准**：
- [ ] 支持邮箱验证码发送、注册、登录与密码重置；
- [ ] 登录成功后 CookieJar 自动更新 `access_token`，`WebosRepository` 自动刷新全量资产。
