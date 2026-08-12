# Daily webOS 部署运维手册（线上实操版）

> 目的：任何 AI 或开发者拿到本文件即可完成 webOS Shell 的构建、部署、验证与常见故障排查，
> 不需要再向用户询问服务器域名、路径等信息。SSH 密钥、密码等敏感信息**不写在此文件**，
> 见服务器 `/root/daily/server/.env`（不入库）与 Android 沙箱 `/data/user/0/com.ai.assistance.operit/files/ssh-keys/`。

## 1. 线上环境速查

| 项目 | 值 |
|---|---|
| 访问域名 | `https://shadowshub.xyz` |
| webOS 入口 | `https://shadowshub.xyz/daily/` |
| 服务器 IP | `154.64.249.172` |
| SSH | `root@154.64.249.172`，端口 `22`，**仅密钥登录**（2026-08-03 起密码登录已禁用）；私钥 `~/.ssh/daily_server_ed25519`（Android 沙箱，备份在 `/data/user/0/com.ai.assistance.operit/files/ssh-keys/daily_server_ed25519`，勿删） |
| 项目目录（服务器） | `/root/daily` |
| 后端目录 | `/root/daily/server`（源码 TS，pm2 用 tsx 直接运行） |
| 前端产物 | `/root/daily/server/public/`（Express 静态托管，nginx 反代） |
| 进程管理 | pm2，应用名 `daily-server`（fork 模式） |
| 后端端口 | `3456`（HTTP + WS；**仅回环**，iptables 已封公网，见 §7.3） |
| 数据库 | SQLite `/root/daily/data/daily.db`（webOS state 存 entities 表 `type=webos_state`） |
| webOS API 前缀 | `/webos/api/`（JWT cookie 鉴权，`credentials: 'include'`） |
| 游客发放 | `POST /api/auth/guest`（免鉴权，IP 限频 20/小时） |
| AI 模型 | DeepSeek V4 Flash（pi 内置 `deepseek/deepseek-v4-flash`），`DEEPSEEK_API_KEY` 在服务器 `.env` |
| nginx 配置 | `/etc/nginx/sites-enabled/default`（`/daily/`、`/api/`、`/webos/api/`、`/daily/ws` 反代 127.0.0.1:3456）；admin 子域 `sites-enabled/admin-daily` |

## 1.5 SSH 访问（2026-08-03 起）

密码登录已禁用，**所有 SSH/scp 操作必须用私钥**：

```bash
# 私钥（Android 沙箱/开发机）
SSH_KEY=~/.ssh/daily_server_ed25519
# 执行远程命令
ssh -i "$SSH_KEY" -p 22 -o StrictHostKeyChecking=no root@154.64.249.172 '<命令>'
# 上传文件
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no <本地文件> root@154.64.249.172:/root/daily/<目标>
```

- 私钥丢失 = 失去 SSH 访问（可走云控制台 VNC 救援后重装密钥）。
- 服务器侧配置（勿回退）：`PasswordAuthentication no`、`PermitRootLogin prohibit-password`、`PubkeyAuthentication yes`。

## 2. 部署流程（前端 + 后端）

### 2.1 前端（client/shell-web）

```bash
# 本地（Android 工作区或开发机）
cd client/shell-web
npx tsc --noEmit          # 必须 exit 0
VITE_BASE_PATH=/daily/ npx vite build   # 产物在 dist/

# 上传到服务器（产物 + index.html 一起；SSH_KEY 见 §1.5）
cd dist
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  index.html icon-192.svg icon-512.svg manifest.webmanifest sw.js terms.html \
  root@154.64.249.172:/root/daily/server/public/
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  assets/index-XXXX.js assets/index-XXXX.css \
  root@154.64.249.172:/root/daily/server/public/assets/
# 上传后必做：权限修复（scp 保留源文件 600，nginx worker 读不了 → 403）
ssh -i "$SSH_KEY" -p 22 -o StrictHostKeyChecking=no root@154.64.249.172 \
  'chmod 644 /root/daily/server/public/index.html /root/daily/server/public/assets/*'
```

要点：
- **必须** `VITE_BASE_PATH=/daily/` 构建，否则资源路径错误。
- `index.html` 里的 `<script src>` 指向带 hash 的新 JS 文件名，务必同步上传。
- sw.js 对导航请求不缓存（发版安全），但**已打开的旧页面不会自动换新**：发版后用户需刷新/重开页面才能拿到新功能（如思考档位切换）。
- 旧 hash 的 JS 文件可留可删（无引用，无害）。

### 2.2 后端（server）
```bash
# 上传源码（「AI 即系统」相关文件，2026-08-01 起必须全部上传；SSH_KEY 见 §1.5）
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  server/src/routes/webos.ts root@154.64.249.172:/root/daily/server/src/routes/webos.ts
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  server/src/piBridge.ts root@154.64.249.172:/root/daily/server/src/piBridge.ts
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  server/src/utils/webosWorkspace.ts root@154.64.249.172:/root/daily/server/src/utils/webosWorkspace.ts
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  server/src/webosDesktopV1.ts root@154.64.249.172:/root/daily/server/src/webosDesktopV1.ts
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  server/src/index.ts root@154.64.249.172:/root/daily/server/src/index.ts   # body limit 等入口配置（2026-08-03 起）
# 生图 + 图片编辑（2026-08-02 起；imagegen 是新目录，先 mkdir）
ssh -i "$SSH_KEY" -p 22 -o StrictHostKeyChecking=no \
  root@154.64.249.172 'mkdir -p /root/daily/server/src/imagegen'
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  server/src/imagegen/chatstImage.ts root@154.64.249.172:/root/daily/server/src/imagegen/chatstImage.ts
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  server/src/utils/imageEdit.ts root@154.64.249.172:/root/daily/server/src/utils/imageEdit.ts
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  server/src/routes/adminWebos.ts root@154.64.249.172:/root/daily/server/src/routes/adminWebos.ts
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  server/src/routes/emailAuth.ts root@154.64.249.172:/root/daily/server/src/routes/emailAuth.ts
# 计费核心（2026-08-02 积分制；billing 是新目录，先 mkdir）
ssh -i "$SSH_KEY" -p 22 -o StrictHostKeyChecking=no \
  root@154.64.249.172 'mkdir -p /root/daily/server/src/billing'
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  server/src/billing/pricing.ts root@154.64.249.172:/root/daily/server/src/billing/pricing.ts
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  server/src/db/schema.ts root@154.64.249.172:/root/daily/server/src/db/schema.ts
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  server/src/db/schema-sqlite.ts root@154.64.249.172:/root/daily/server/src/db/schema-sqlite.ts
# 2026-08-02 已移除 zpay（payment/zpay.ts、routes/zpayNotify.ts 已删，勿再上传）
# webOS 专用 skills（design 设计 skill）
ssh -i "$SSH_KEY" -p 22 -o StrictHostKeyChecking=no \
  root@154.64.249.172 'mkdir -p /root/daily/.pi/skills-webos/design'
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  .pi/skills-webos/design/SKILL.md root@154.64.249.172:/root/daily/.pi/skills-webos/design/SKILL.md
```

> **scp 权限陷阱（2026-08-02）**：scp 保留源文件权限（本地常为 600），nginx worker
> 读不了会导致 403。admin-web 等静态产物上传后必须 `chmod 644`。scp 端口参数是 `-P 22`
> （大写），`-p` 是保留权限。

# 服务器上类型检查（可选但推荐，服务器有 node_modules）
cd /root/daily/server && npx tsc --noEmit

# 重启
pm2 restart daily-server
sleep 3
pm2 ls | grep daily-server        # online
ss -tlnp | grep 3456              # 确认唯一监听（避免 EADDRINUSE）
```

> **EADDRINUSE 陷阱**：pm2 restart 偶发旧实例未完全退出导致端口被占。
> 处置：`ss -tlnp | grep 3456` 看监听 pid；若多个 node 监听则 `pm2 delete daily-server && pm2 start ...` 或等旧进程退出后重启。

> **余额豁免（2026-08-01 临时）**：体验阶段用户余额耗尽仍可继续使用——`chat/stream`
> 的 `INSUFFICIENT_BALANCE` 拦截已临时移除（`charge` 内部 `Math.max(0,...)` 保护，
> 余额最低 0 不变负）。支付/账号系统上线后恢复余额门槛（恢复 `if (state.balanceMinor < estimate)` 拦截）。

## 3. 部署后验证清单

### 3.1 静态与 API 可达

```bash
curl -sI https://shadowshub.xyz/daily/ | head -3                # 200
curl -s -X POST https://shadowshub.xyz/api/auth/guest \
  -H 'Content-Type: application/json' -d '{"deviceId":"ops-check-01"}'   # 发游客 JWT
```

### 3.2 SSE 对话（curl 验证 AI 链路）

```bash
TOKEN=$(curl -s -X POST https://shadowshub.xyz/api/auth/guest \
  -H 'Content-Type: application/json' -d '{"deviceId":"ops-check-01"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -s -N -X POST https://shadowshub.xyz/webos/api/chat/stream \
  -H 'Content-Type: application/json' \
  -H "Cookie: access_token=$TOKEN" \
  -d '{"messages":[{"role":"user","content":"你好"}],"thinking":"medium"}'
# 期望事件流：start → 多个 delta → done（usage 非 0）；不期望仅有 start+done
```

> 注意：服务端 authMiddleware 只认 **JWT cookie**（`access_token`）或 SERVER_TOKEN Bearer；
> `Authorization: Bearer <JWT>` 会返回 Invalid token。curl 必须用 Cookie header。

### 3.3 服务器日志

```bash
tail -50 /root/.pm2/logs/daily-server-out.log     # 标准输出
grep 'chat prompt done' /root/.pm2/logs/daily-server-out.log | tail -3
grep 'agent_end lastMsg' /root/.pm2/logs/daily-server-out.log | tail -3
```

诊断关键日志：
- `[webos] chat prompt done ... events={...}`：确认 agent_end 是否触发、delta 数量。
- `[webos] agent_end lastMsg role=assistant ... stop=error err=400 Messages with role 'tool'...`：
  孤立 tool 消息 400（见故障 4.2）。
- `[webos] agent_end failed ... disposing sessions for ...`：自愈逻辑已触发。

### 3.4 桌面模板（webosDesktopV1.ts）必查

> **教训（2026-08-01）**：TS 模板字符串内嵌桌面 HTML/JS 时，内嵌 JS 里的 `\"`、`\u0022`
> 等转义序列会在**模板求值时被消费**（`\"`→`"`），生成坏 JS（SyntaxError），
> 桌面只剩静态背景+Dock、时钟/图标/点击全失效。**改模板后必须验证求值结果，不能只看源码文本。**

```bash
# 本地与服务器各跑一次（脚本放 server/ 下，import 模板后提取 <script> 用 vm 检查）
cat > /tmp/check_desktop_runtime.ts <<'EOF'
import { WEBOS_DESKTOP_V1_HTML } from './src/webosDesktopV1.js'
import { Script } from 'node:vm'
const h = WEBOS_DESKTOP_V1_HTML
console.log('len =', h.length, 'has_escaped_quote =', h.includes('\\"'))
for (const sc of h.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || []) {
  const code = sc.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
  new Script(code) // 抛错即模板坏了
}
console.log('desktop template JS OK')
EOF
cp /tmp/check_desktop_runtime.ts server/ && cd server && npx tsx check_desktop_runtime.ts && rm check_desktop_runtime.ts
# 期望：len=16777、has_escaped_quote=false、desktop template JS OK（无 SyntaxError）
```

- 浏览器验证：打开 `/daily/` → 进桌面 → 控制台必须无 `SyntaxError`；
  顶部有时钟、中间有图标网格、底部 Dock 可点（postMessage 直连，无握手依赖）。
- 存量坏桌面（仅非唯一版本会被自动升级跳过）：参考 2026-08-01 运维脚本
  （创建新模板版本切换 active，旧版保留回滚；数据库备份 `data/daily.db.bak-fixdesktop`）。

### 3.5 桌面/商店模板批量重置脚本（2026-08-09 起）

> **教训（2026-08-09）**：重置脚本**禁止用正则提取模板源码**——模板源码里的
> `\\'` 等转义序列只有**求值后**才变成 `\'`，正则提取会得到双反斜杠 → 生成的
> 商店 JS（`onerror` 内联属性）语法错误 `SyntaxError: Unexpected string`，商店
> 列表空白（静态壳在、脚本没跑）。必须用 tsx 导入求值后的常量。

```bash
# 服务器执行（脚本在 /root/daily/tmp/reset-desktops-v2.mts，幂等，保留历史可回滚）
pm2 stop daily-server && /root/daily/server/node_modules/.bin/tsx /root/daily/tmp/reset-desktops-v2.mts && pm2 start daily-server
# 期望输出：desktop/store template len 与本地一致，DONE ... skipped=N（再次运行 0 reset）
```

- 前端壳层改动（StoreView 顶栏删除、iframe 全屏）部署后**必须验证 iframe 可见**：
  `getBoundingClientRect().height > 0`（.os-screen 已是 absolute inset:0，给
  store-screen 再设 `position:relative` 会让区块高度变 0 → 商店视觉空白，
  详见 2026-08-09 回归记录）。

## 4. 常见故障排查
### 4.1 用户侧"AI 一直加载/没有回复"

- 后端已自愈：agent_end 检测 `stop=error` 或 usage 全 0 → dispose 会话 + 返回 error 事件
  `WEBOS_AI_EMPTY_RESPONSE`（不扣费），重发即恢复；前端流结束无内容时也会提示"连接中断，请重发"。
- 若用户持续"一直加载"：查 pm2 日志 `chat prompt done` 是否出现；没出现说明请求没到（nginx/网络），
  出现了且 events 里 `message_update` 极少则看 agent_end 是否 error。
- 用户看到旧界面：页面未刷新（SW 不缓存导航，但已打开的页面不自动换新）→ 让用户刷新/重开。

### 4.6 整页白屏（2026-08-01 事故，已防回归）

- 现象：`/daily/` 打开后一片空白（HTML 200，但 JS/CSS 没加载）。
- 根因：13:40 部署的 `index.html` 资源路径是**绝对路径 `/assets/...`**（无 `/daily` 前缀），
  而 nginx 根 `location /` 会拦截 `/assets/*` 返回**欢迎页 HTML**（470 字节，`Content-Type: text/html`），
  浏览器把 HTML 当 JS 解析 → 报错 → 白屏。正确路径 `/daily/assets/index-*.js` 实际可访问（245KB）。
- 触发原因：该次构建**漏了 `VITE_BASE_PATH=/daily/`**，vite 默认 `base='/'` 生成绝对路径。
- 已修复：
  - 线上 `sed` 把 `/assets/` 改为 `/daily/assets/`（已验证 md5 与本地正确产物一致）。
  - `vite.config.ts` 改为 `defineConfig(({command}) => ...)`：**build 模式默认 `base='/daily/'`**，
    不传 `VITE_BASE_PATH` 也不会再产出错误路径；dev 模式仍为 `/`。
- 验证命令：`curl -s https://shadowshub.xyz/daily/ | grep -oE '(src|href)="[^"]*"'` 必须看到
  `/daily/assets/...`；再 `curl -sI https://shadowshub.xyz/daily/assets/index-*.js` 应为 200 且
  `content-type: text/javascript`（不是 text/html）。
- 教训：部署后**必查 index.html 里资源路径带 `/daily` 前缀**（相当于部署手册 §3 检查清单的新增项）；
  用户遇到白屏先 `curl -s https://shadowshub.xyz/daily/ | grep index-` 核对路径，而不是怀疑后端。


### 4.2 孤立 tool 消息 400（历史根因，已防御）

- 现象：DeepSeek 返回 400 `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`；
  pi 把 provider 错误转成空 assistant 消息（usage 全 0）并写入会话历史，导致该会话此后每次请求都 400。
- 防御：服务端 agent_end 检测 stop=error / 空 usage+空内容 → `disposeWebosSessions(principal.key)`
  清空该用户全部 webOS 会话缓存，下次请求自动重建干净会话；不扣费；返回 error 事件。
- 根因在 pi/DeepSeek 兼容性（偶发）；若高频复现需考虑定期 dispose 或升级 pi 版本。

### 4.3 思考档位无法切换

- 前端新版本：composer 旁「思考」chip 点击循环 浅→中→深→极深（模型 chip 纯展示）。
- 用户仍无法切换 = 浏览器缓存旧 JS：确认 `curl -s https://shadowshub.xyz/daily/ | grep index-` 的 hash
  与 `server/public/assets/` 一致，然后让用户硬刷新。

### 4.4 余额/扣费（2026-08-02 积分制）

- **统一积分制**：1 积分 = ¥0.01。游客 100 积分（¥1）/ 会员 1000（¥10）/ 套餐 990（¥9.9）；
  旧 token 配额自动迁移（1亿→990、10万→1000、1万→100）。
- 计费核心 `server/src/billing/pricing.ts`：`chatCostMinor`（DeepSeek 官方价 ×1.5 售价 ×高峰倍率）、
  `imageCostMinor`（生图售价 ¥16/¥60 每百万）、`fixedCostMinor`（搜索 ¥0.02/次、TTS ¥0.5/千字符，预留）。
- **DeepSeek 峰谷定价**：北京时间每日 9:00-12:00、14:00-18:00 价格 ×2（`isDeepSeekPeak`，对应用户量时按 ×2 扣积分）。
- 扣费基于真实 usage（对话 `agent_end` 的 input+output tokens；生图 API 的 prompt/completion tokens），
  取不到才回退估算；不足 1 积分（1 分钱）的消耗 round 后为 0（小额对话免费，属积分粒度设计）。
- 余额不足：`chat/stream` 返回 402 `TOKEN_INSUFFICIENT`（文案含客服微信 fangyan876）；生图同样拦截。
- 若发现 0 扣费：查 agent_end 日志 usage 是否全 0（对应 4.2 场景，已不扣费）。

### 4.7 支付渠道（2026-08-02 zpay 已移除，爱发电待接入）

- 旧 zpay 易支付渠道**已整体删除**（源码、`webos_pay_orders` 表、回调路由、环境变量）；
  `POST /webos/api/payment/orders` 与订单查询统一返回 `503 PAYMENT_UNAVAILABLE`，不创建假订单/伪造到账。
- 计划接入 **爱发电（afdian.com）**：届时新增回调路由（免鉴权，挂 authMiddleware 之前）+ 验签 +
  `webos_state.credits.quota` 提升到 `PLAN_CREDITS`（990）入账；支付商品仍在 `webos.ts` `PAYMENT_PRODUCTS` 配置。

### 4.5 App 生成相关

- **2026-08-14 起：`create_webos_app` 工具已删除**，AI 创建 App 唯一路径 =「文件夹即 App」：
  `agent_fs_mkdir apps/<名称>/`（系统自动写骨架+注册）→ `agent_fs_write apps/<名称>/index.html`
  （系统自动校验+即时建版本+push app_created/app_updated）。
- **中文文件夹名已支持**：`APP_ID_PATTERN` 放宽为 Unicode 字母/数字/空格/._:-（排除路径分隔符，
  `appFilesRoot` 另有 `includes('..')` 防穿越）；trash 路由（restore/delete）与公开素材端点
  （`servePublicAppRawFile`）的 appId 校验同步 Unicode 化（URL 由前端 `encodeURIComponent` 编码）。
- REST `POST /webos/api/apps`（local_import）**保留**——日后可单独做「用户粘贴 HTML 生成 App」入口；
  前端 assistant 首页「粘贴 HTML 创建 App」按钮仍走该端点。
- App 运行在 `sandbox="allow-scripts"` iframe（opaque origin），localStorage 由 bootstrap polyfill
  兜底（内存态 + 异步落 `app.storage.private`）；bootstrap 注入 `<head>` 开头。
- 图标：`icon` 为内联 SVG 字符串（禁 script/外链/事件处理器），桌面用 data URI 渲染；
  文件夹内 `icon.svg`/`icon.png` 优先（readAppIconFile）。
- 修改 App：`update_webos_app` 创建新不可变版本并切换 active version，历史版本可回滚；
  或直接改工作区 `apps/<appId>/index.html`（即时建版本，等效）。
- `tool_execution_end` 的 `drainPendingAppEvents` 在所有工具分支之前消费（2026-08-14）：
  文件夹方式 mkdir/write 触发的 app_created/app_updated 推送不因工具名过滤而丢失。

## 5. 环境变量（webOS 相关，均在服务器 `.env`）

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | 必填，DeepSeek API Key，**只在服务端读取**，禁止进 VITE_*/bundle/git |
| `DEEPSEEK_MODEL` | 可选，覆盖默认 `deepseek/deepseek-v4-flash` |
| `SERVER_TOKEN` | 可选，桌面/移动端 Bearer fallback |
| `WEB_PUBLIC_DIR` | 默认 `./public`（服务器上已确认解析正确） |
| `CHATST_IMAGE_API_KEY` | 生图渠道（ChatST 聚合网关）API Key，**只在服务端读取**；未配置时生图工具返回 `IMAGE_GEN_NOT_CONFIGURED`（不伪造成功） |
| `CHATST_IMAGE_BASE_URL` | 可选，默认 `https://api.chatst.org/v1` |

**生图模型与定价（2026-08-02）**：模型固定 `gpt-image-2-super`；按 API 真实 usage 扣减用户 token 配额，金额按 **输入 ¥16 / 输出 ¥60 每百万 token** 折算（`server/src/imagegen/chatstImage.ts` 的 `IMAGE_PRICING`，管理后台展示）。每次调用落库 `webos_imagegen_usage`（含耗时/状态/错误码，管理后台「生图监测」页展示成功率/超时/报错）。

**服务器图像依赖（edit_image 其他操作需要；remove-background 纯 JS 零依赖）**：
```bash
apt-get install -y imagemagick ffmpeg   # 生产服务器 2026-08-02 已装（IM 6.9 / ffmpeg 5.1）
```

废弃变量（禁止恢复）：`DEEPSEEK_CHAT_MODEL`、`DEEPSEEK_REASONER_MODEL`、`DEEPSEEK_API_ENDPOINT`、
旧自研 `fetchProvider/requestCompletion`、`/webos/api/apps/generate` 端点。

## 6. 目录/代码地图（快速定位）

- `client/shell-web/src/App.tsx`：整个 Shell UI（AssistantHome/DesktopView/AppRuntime/Settings…）+ bootstrap/polyfill
- `client/shell-web/src/store.ts`：Zustand 状态 + SSE 事件处理（thinking/tool/app_created/app_updated）
- `client/shell-web/src/api.ts`：API client（含 reorderApps/deleteApp）
- `client/shell-web/src/runtime.ts`：Runtime SDK（MessageChannel + 私有存储）
- `server/src/routes/webos.ts`：webOS 全部 API + pi 会话 + App 工具集
- `server/src/piBridge.ts`：createWebosSession / registerDeepseekModels（四档思考映射）
- `shared/webos-contracts/index.ts`：前后端共享契约（事件/App/消息类型）

## 7. 安全基线（2026-08-03 加固，勿回退）

> 2026-08-03 安全审计（针对"人/AI 攻击拿到服务器 key"的威胁模型）后落地的加固清单。
> 审计结论：Web/AI 侧攻击面均有校验兜底（无未鉴权敏感端点、无路径穿越、AI 工具锁用户工作区、
> 密钥不进前端/日志）；真实薄弱点在运维侧，以下均已修复。

### 7.1 SSH（密码登录已禁用）

- 登录仅限 ed25519 密钥：`ssh -i ~/.ssh/daily_server_ed25519 root@154.64.249.172`（见 §1.5）
- `sshd_config`：`PasswordAuthentication no`、`PermitRootLogin prohibit-password`、`PubkeyAuthentication yes`
- **私钥是唯一入口**：丢失即失联（云控制台 VNC 可救援）。备份位置：
  `/data/user/0/com.ai.assistance.operit/files/ssh-keys/daily_server_ed25519`（Android 应用沙箱，勿删）
- 旧 SSH 密码已作废；`WEB_ACCESS_PASSWORD` 已轮换为 24 位随机强密码（2026-08-03，值存沙箱
  `ssh-keys/web_access_password.txt`，不入库、不写本手册）

### 7.2 fail2ban

- `sshd` jail：**10 分钟失败 5 次 → 封禁 30 分钟**
- 配置：`/etc/fail2ban/jail.local`（`backend = systemd`，本机无 auth.log，sshd 日志走 journald）
- 运维：`systemctl status fail2ban`、`fail2ban-client status sshd`、日志 `/var/log/fail2ban.log`
- 注意：云控制台安全组建议同步只放行 22/80/443

### 7.3 端口与防火墙

- 后端 3456 **仅回环**（nginx 反代不受影响）：
  ```bash
  iptables -A INPUT -p tcp --dport 3456 -s 127.0.0.1 -j ACCEPT
  iptables -A INPUT -p tcp --dport 3456 -j DROP
  iptables-save > /etc/iptables/rules.v4        # 持久化
  # /etc/rc.local 已配置开机 iptables-restore < /etc/iptables/rules.v4
  ```
- 公网实测：`echo > /dev/tcp/154.64.249.172/3456` 应失败（PORT_BLOCKED）

### 7.4 敏感文件权限（勿放宽）

- 所有 `.env`（`server/.env`、`/root/daily/.env`、`.env.prod`）：`chmod 600`
- 备份目录 `/root/daily-backup-0731`：`chmod 700`
- 部署后 scp 产物必须 `chmod 644`（nginx worker 可读），见 §2.1

### 7.5 其他加固与审计结论

- body limit：`express.json({ limit: '20mb' })`（`server/src/index.ts`，2026-08-03；单文件上传 ≤10MB 不受影响）
- 密钥强度（2026-08-03 复核）：JWT_SECRET/SERVER_TOKEN 65 字符、API key 36-52 字符，全部合格
- git 未追踪 .env（仅 example）；pm2 日志无 key 明文；nginx 无敏感路径暴露
- 代码层已确认安全：`/webos/api` 全量 authMiddleware、admin requireAdmin、WS 双路径鉴权、
  imagegen 文件路由正则白名单（无穿越）、工作区路径 `path.relative` 防越界、
  上传类型白名单 + 服务端随机文件名、登录验证码 + IP 限频 + 账户锁定

## 8. 对话排查速查（2026-08-13 起）

> 排查用户反馈的 AI 对话问题（消息重复/扣费异常/回复丢失/上下文错乱/「AI 改了没生效」），
> **第一步查对话记录**，不要只凭用量统计数字和 pm2 日志猜。三层查询：

### 8.1 三层查询

```bash
# ① 快速浏览（user/assistant 纯文本，按消息粒度）
#    GET /api/admin/webos/chat-logs?userKey=user:xxx&conversationId=&page=&limit=
# ② 完整过程（一次请求一行，events JSON 含 AI 思考 reasoning 全文 + 工具调用 + App 事件）
#    GET /api/admin/webos/sessions?userKey=user:xxx&conversationId=&limit=
# ③ 自动整合时间线（对话事件 + 工作区 execution.log 工具轨迹 + App 版本历史，一条命令看全）
#    GET /api/admin/webos/trace?userKey=user:xxx&conversationId=&appId=&hours=
# 示例：站长账号查「苍穹突袭」App 最近 12 小时 AI 干了什么
curl -s 'https://shadowshub.xyz/api/admin/webos/trace?userKey=user:fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6&appId=app-ffba5f82-df55-472a-8733-1605733a584b&hours=12' \
  -H "Cookie: access_token=$ADMIN_JWT" | python3 -m json.tool
```

- 生成管理员 JWT（服务器）：见 AGENT.md「用户账号速查」节（jwt.sign 的 sub/userId/role 同 auth.ts）。
- **reasoning 内容只存在 `webos_chat_sessions.events`**（2026-08-13 起）；更早的会话无 reasoning（历史不回溯）。
- 数据库直查：`node -e` + better-sqlite3（服务器 node_modules 下）或管理后台接口，两者等价。

### 8.2 常见判断

| 现象 | 查什么 | 结论 |
|---|---|---|
| 消息重复发送/双倍扣费 | `/trace` 看同内容 user 事件间隔 | <5s 同内容 = 前端重试 bug（409 防御已拦截，看 chat_sessions.status） |
| AI 改了 App 但用户看不到 | `/trace?appId=` 看 version 事件 + exec 的 agent_fs_* 轨迹 | 无 version 事件 = 只改了工作区文件未同步（2026-08-13 起已即时化，不应出现）；有 version 但用户仍旧版 = 前端缓存（已加 versionId 校验） |
| 回复丢失/空回复 | `/sessions` 看 events 尾部 + status | status=empty_response + 无 delta = 模型空响应（WEBOS_AI_EMPTY_RESPONSE）；status=failed + error_code 看具体错误 |
| 积分扣错 | `/sessions` 的 cost_minor + webos_ai_usage | 按真实 usage 计费；不足 1 分 round 为 0 属粒度设计 |
| AI 来回折腾/乱试 | `/trace` 的 exec 轨迹（工具名+参数摘要+成败） | 直观看到重复操作/失败重试/读源码自我纠错全过程 |

### 8.3 相关表

- `webos_chat_sessions`：统一对话 log（2026-08-13；一次请求一行，events JSON 含 reasoning）
- `webos_chat_logs`：对话纯文本（2026-08-11；按消息粒度，快速浏览）
- `webos_ai_usage`：用量审计（new-api 风格，每请求一行）
- 工作区 `logs/execution.log`：AI 工具调用轨迹（JSON Lines，20MB 轮转）
- entities 表 `webos-state:<key>`：App 版本历史（apps[].versions）
