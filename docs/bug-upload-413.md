# Bug：文件上传全部失败（413 Request Entity Too Large）

> 2026-08-13 排查记录。现象：用户反馈"无法上传文件，只要上传文件就是失败"。
> **状态：已修复、已部署、已线上验证（2026-08-13 16:31 UTC+8）。**

## 根因（已实测确认）

**服务器 nginx 未配置 `client_max_body_size`，使用默认值 `1m`。**

前端上传链路：文件 → `blobToBase64`（base64 膨胀 ~4/3）→ JSON body → `POST /webos/api/workspace/files`。

实测（沙箱 curl → https://shadowshub.xyz）：

| body 大小 | 结果 |
|---|---|
| 500KB / 900KB | ✅ 200 |
| 1.1MB / 1.5MB / 15MB / 30MB | ❌ 413，响应为 nginx HTML 错误页 `<html><title>413 Request Entity Too Large` |

- 413 错误页是 **HTML**（nginx 特征），不是 Express 的 JSON `{error:...}` → 请求在 nginx 反代层被拦截，**根本没到后端**。
- 阈值 ~1MB：任何原文件 >约 **750KB**（base64 后 >1MB）的上传全部失败。
- 手机相册照片（2-5MB）、文档、视频、压缩包 → 全部 413 → 用户感知"只要上传就失败"。
- 2026-08-12「取消单文件大小限制」只改了业务代码（`webosWorkspace.ts`/`webos.ts`），**漏改了两处传输层限制**：
  1. nginx `client_max_body_size`（默认 1m，从未配置）
  2. Express `express.json({ limit: '20mb' })`（`server/src/index.ts`，2026-08-03 安全加固从 100mb 降到 20mb，注释仍写"单文件 ≤10MB"——旧决策残留）

## 修复

### 1. nginx（服务器）— 关键

在 `/etc/nginx/sites-enabled/default`（及 admin-daily 如需上传）的 **server 块**内添加：

```nginx
client_max_body_size 600m;
```

然后 `nginx -t && systemctl reload nginx`（宝塔：面板重载 nginx）。

### 2. Express（代码已改，待部署）

`server/src/index.ts`：

```ts
// 2026-08-12 用户决策：取消所有单文件大小限制，工作区配额是唯一闸门。
app.use(express.json({ limit: '600mb' }))
```

已修改完成，上传 `server/src/index.ts` 到服务器 + `pm2 restart daily-server`。

### 3. 对齐说明

- 600MB body ≈ 450MB 原文件（base64 膨胀 4/3），覆盖常规上传；
- 业务闸门不变：工作区配额（游客 200MB / 登录 512MB / 月卡 10-100GB）在 `POST /workspace/files` 内检查（`WORKSPACE_FULL` 413 JSON）；
- 其它 JSON 上传（App 素材、appStorage、头像）同样受益。

## 部署清单（SSH）

```bash
SSH_KEY=/data/user/0/com.ai.assistance.operit/files/ssh-keys/daily_server_ed25519
# 1. 上传后端
scp -i $SSH_KEY -P 22 -o StrictHostKeyChecking=no \
  server/src/index.ts root@154.64.249.172:/root/daily/server/src/index.ts
# 2. nginx 加 client_max_body_size 600m（见上，需手动编辑服务器配置）
# 3. 重载 + 重启
ssh -i $SSH_KEY -p 22 -o StrictHostKeyChecking=no root@154.64.249.172 \
  'nginx -t && systemctl reload nginx && pm2 restart daily-server'
```

## 验证（2026-08-13 部署后线上实测）

```bash
# 1. 公网 2MB body → 200（此前 413）
python3 -c "import json;print(json.dumps({'deviceId':'pub','pad':'x'*2000000}))" > /tmp/v.json
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://shadowshub.xyz/api/auth/guest \
  -H 'Content-Type: application/json' --data-binary @/tmp/v.json   # 200 ✓

# 2. 真实登录用户公网上传 1.1MB jpg → {"ok":true,"size":1100000} ✓
#    （验证后已删除测试文件并清理测试工作区）
```

部署后 `nginx -t` 通过、`systemctl reload nginx` 成功、`pm2 restart daily-server` online；
服务器本机 2MB body 探测 200；公网 nginx 层 2MB 探测 200；公网真实上传 1.1MB 成功。

## 部署实录（2026-08-13）

1. `server/src/index.ts` 已 scp 到服务器（`express.json({ limit: '600mb' })` 第 161 行）+ `pm2 restart`；
2. nginx 采用 **`/etc/nginx/conf.d/upload-size.conf`**（内容 `client_max_body_size 600m;`，http 级全站生效）——
   **教训**：不要往 sites-enabled 的 server 文件顶部直接加指令（多个站点文件会被 include 进同一 http 上下文造成 duplicate）；
   **教训**：备份文件勿留在 sites-enabled 内（`*.bak` 会被 `include /etc/nginx/sites-enabled/*;` 一起加载，
   软链接备份会重复加载同一文件 → 指令重复、listen 重复）；
3. nginx 原配置备份移至 `/root/daily/backups/nginx-uploadfix-20260813/`。

## 备注

- 排查时 SSH（22 端口）TCP 可达但 KEX 握手超时（跨境链路丢包），曾用 413 行为探测（guest 端点 body 大小阈值）定位 nginx 限制，无需 SSH 即可确认根因。
- 部署文档：`deploy/nginx-client-body-size.conf`（含建议放置位置）。
