# 16 · 执行手册（Playbook）——构建 / 真机调试 / 协议速查 / 常见坑

> 面向：任何接手执行的 AI（含弱模型）与人类。目的：把「踩过的坑」从对话/时间线里捞出来变成可查手册。
> 约定：每次发现新坑，**当次会话就追加进本文对应小节**（这是纪律，见根 AGENT.md「文档与变更纪律」）。
> 版本：v1（2026-08-16，M0-4 白屏修复会话沉淀）

---

## 1. 环境速查（设备 / 服务器 / 身份）

| 项 | 值 |
|---|---|
| 开发机 | Android 手机（魅族 Lucky 08，aarch64，Android 12）；唯一开发机，Operit 内跑 proot Ubuntu |
| 被测 App | `xyz.shadowshub.daily`（debug），入口 `.MainActivity` |
| 构建服务器 | 香港 `root@154.64.249.172`（x86_64, 2h4g） |
| SSH key | `/data/user/0/com.ai.assistance.operit/files/ssh-keys/daily_server_ed25519` |
| 服务器构建目录 | `/root/android-build`（每次全量覆盖）；源码包 `/root/android-src.tar.gz` |
| 服务器 Gradle/SDK | `/opt/gradle-9.1.0/bin/gradle` + `ANDROID_HOME=/root/Android` |
| **生产服务器（daily-server）** | 同一台 `154.64.249.172`，**pm2 进程 `daily-server`，端口 3456**（不是 3000！） |
| 生产服务代码 | `/root/daily/server/`（生产与构建共用此机器） |
| spike 资源（M0-2） | 手机 `/data/local/tmp/{proot-static,daily-rootfs/}`；rootfs 源码服务器 `/root/daily-rootfs-src/` |
| 站长账号 user key | `user:fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6`（排查必须用真实账号，见根 AGENT.md） |

### 1.1 生产服务器 JWT 生成（查线上数据用）

```bash
ssh -i <SSH_KEY> root@154.64.249.172
cd /root/daily/server   # jsonwebtoken 只在这里 node_modules 里有
node -e "const jwt=require('jsonwebtoken');const fs=require('fs');const line=fs.readFileSync('.env','utf8').split('\n').find(l=>l.startsWith('JWT_SECRET='));const s=line.split('=').slice(1).join('=').trim();console.log(jwt.sign({authenticated:true,sub:'user:fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6',userId:'fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6',role:'admin'},s,{expiresIn:'1h'}))"
# 用法：curl -H "Cookie: access_token=<TOKEN>" http://127.0.0.1:3456/webos/api/apps
```

坑：`.env` 里 JWT_SECRET 行**不能**用 `slice(11)` 解析（值可能含 `=`），必须 `split('=').slice(1).join('=').trim()`。

---

## 2. 构建与安装 SOP

### 2.1 标准构建（一键）

```bash
cd /data/user/0/com.ai.assistance.operit/files/workspace/daily/daily
bash deploy/android-build.sh            # 打包→上传→服务器构建→拉回 APK
bash deploy/android-build.sh --install  # 顺带安装到手机（需 Shizuku/Root）
```

- 正常耗时 ≈ 3–4 分钟（上传 2MB + 构建 ~3m20s + 拉回 20MB）。
- 脚本在服务器端自动做三件事：移除手机 proot 专用的 ARM64 aapt2 hack、限制 Gradle 内存（2h4g 防 OOM）、写 `local.properties`。

### 2.2 安装（SELinux 坑：不能直接装 /sdcard）

```bash
# ❌ 直接装会失败：system_server 无权读 fuse context 的 sdcard 文件
# pm install /sdcard/Download/daily-debug.apk → avc denied

# ✅ 必须先落到 /data/local/tmp
cp /sdcard/Download/daily-debug.apk /data/local/tmp/daily-debug.apk
chmod 644 /data/local/tmp/daily-debug.apk
pm install -r -t /data/local/tmp/daily-debug.apk
am start -n xyz.shadowshub.daily/.MainActivity
```

### 2.3 构建超时 / 失败处理（重要）

**现象**：手机端工具调用超时（>10 分钟无输出）≠ 构建失败——SSH 会话被掐断后，**服务器上 gradle 继续跑**。多次重试会叠加多个 gradle/kotlin daemon 互相争抢 → 永远出不了产物。

处理：

```bash
# 1. 清残留（注意：pkill -f 会匹配命令行文本，命令里别出现"gradle"字样避免自杀）
ssh -i <SSH_KEY> root@154.64.249.172 'pkill -9 -f "GradleDaemon"; pkill -9 -f "KotlinCompileDaemon"; pkill -9 -f "gradle-cli"; sleep 2; pgrep -c java || echo CLEAN'

# 2. 后台构建（推荐模式：不依赖手机端长连接）
ssh -i <SSH_KEY> root@154.64.249.172 'cat > /tmp/run-build.sh << "EOF"
#!/bin/bash
cd /root/android-build
echo sdk.dir=/root/Android > local.properties
export ANDROID_HOME=/root/Android
/opt/gradle-9.1.0/bin/gradle :app:assembleDebug --no-daemon --max-workers=1 --console=plain > /tmp/build.log 2>&1
echo "EXIT=$?" >> /tmp/build.log
touch /tmp/build.done
EOF
chmod +x /tmp/run-build.sh; rm -f /tmp/build.done; nohup /tmp/run-build.sh > /dev/null 2>&1 & echo BG_STARTED'

# 3. 轮询（每 2-4 分钟一次，直到看到 EXIT=0）
ssh -i <SSH_KEY> root@154.64.249.172 'ls /tmp/build.done 2>/dev/null && echo DONE; tail -2 /tmp/build.log'

# 4. 拉回
scp -i <SSH_KEY> root@154.64.249.172:/root/android-build/app/build/outputs/apk/debug/app-debug.apk /sdcard/Download/daily-debug.apk
```

注：源码未变时可跳过打包上传（服务器 `/root/android-build` 已有），直接从第 2 步开始；改了代码则先跑标准构建的 1-2 步（上传）再走后台模式。

### 2.4 提交纪律（根 AGENT.md 摘要 + Android 特化）

- 精确 `git add <文件>`，禁止 `git add -A`。
- 每个里程碑/独立修复一个 commit，禁止混提。
- 本地 git 是唯一权威（GitHub 不可达，推送挂起）。

---

## 3. 真机调试 SOP（Operit 宿主内操作，规则最密）

### 3.1 铁律：每次操作前先导航

Operit 的工具执行（shell/终端）会把悬浮面板顶到前台，被测 App 会被盖住。因此：

```bash
# ✅ 标准模式：导航 → 确认焦点 → 操作 → 采集，全部放同一条命令链
am start -n xyz.shadowshub.daily/.MainActivity; sleep 2; \
dumpsys window | grep mCurrentFocus; \
input tap <X> <Y>; sleep 3; \
logcat -d -s AppRuntime:V | tail -10; \
screencap -p /data/local/tmp/shot.png
```

- **截图 / uiautomator dump 必须在导航命令链内**——单独执行时拍到的可能是 Operit 悬浮层（表现为"纯白/无关界面"，曾误导排障多轮）。
- **输入注入红线**（根 AGENT.md）：只允许对**被测应用**注入（input tap/text/keyevent），注入前必须 `dumpsys window | grep mCurrentFocus` 确认前台窗口属于被测应用；**严禁向 Operit 宿主注入**；输入法操作（ime set/force-stop IME）须用户许可。
- `am start` 可能返回 "delivered to currently running top-most instance"——说明 App 已在前台，正常。

### 3.2 屏幕坐标

- `wm size`：Lucky 08 = 1264×2780 物理（520dpi）。
- 底部 Tab（现行四 Tab 布局，M1-1 改造后作废）：「桌面」Tab 中心 ≈ (469,2621)。
- 通用法：`uiautomator dump /data/local/tmp/ui.xml` → grep `text="xxx"` 取 bounds，算中心点。dump 也须在导航链内。

### 3.3 App Runtime 日志（AppRuntime tag 全家桶）

```bash
logcat -d -s AppRuntime:V | tail -20
```

| 日志行 | 含义 |
|---|---|
| `appDetail(id): detail=…, versions=N, activeVersionId=…, activeHtmlLen=N` | 列表详情拉取结果（null/0 = 服务端或解析问题） |
| `loadApp(id): htmlLen=N` | 进入 WebView 加载（缺此行 = activeHtml 为 null 或 factory 没跑） |
| `pageFinished: <url>` | 页面加载完成（`about:blank` 是 loadDataWithBaseURL 的正常表现） |
| `pageState: {…}` | 自检 JSON：`title/bodyLen/docLen/hasSDK/hasBridge/vw/vh/bg/disp/pages/pgH` |
| `bridge req: <method> (requestId=…)` | JS→native 请求到达（缺此行 = JS 侧没发出或 bootstrap 未注入） |
| `bridge resp: <method> ok=… error=… dataLen=N` | native 响应（error 非 `-` = 方法失败，看错误串） |

**pageState 字段判读**（白屏排障第一步）：

| 症状 | 判定 |
|---|---|
| `vh: 0` | **WebView 视口 0 高**——布局时机问题（见 §5.2） |
| `hasSDK:false / hasBridge:false` | bootstrap / JS 桥未注入 |
| `bodyLen:-1` | DOM 都没建（HTML 解析失败） |
| `pages:0 / pgH:0` | 桌面模板容器没渲染（apps.list 没回来） |
| 全正常但视觉白 | 截图时机问题（Operit 悬浮层盖屏）或渲染层问题（像素采样验证） |

### 3.4 像素级验证（区分"真白屏"与"截图被盖"）

```bash
# screencap 后用 python PIL 采样（terminal/proot 里跑，shell 环境无 python3）
python3 -c "
from PIL import Image
im = Image.open('/data/local/tmp/shot.png').convert('RGB')
w,h = im.size
print({'top':im.getpixel((w//2,h//10)),'center':im.getpixel((w//2,h//2)),'bottom':im.getpixel((w//2,int(h*.9)))})"
# 全 (255,255,255) = 真白屏；接近模板底色 rgb(248,247,243) = 渲染正常
```

### 3.5 崩溃排查

```bash
logcat -d -b crash -t 50          # crash buffer 专职看
# 注意 buffer 里可能残留旧崩溃（看时间戳）；logcat -c 清后再复现
```

---

## 4. 协议速查（App Runtime 桥 / 服务端 API）

### 4.1 桌面桥方法（DailyJsBridge ↔ PWA runtime.ts 镜像）

契约权威源 = `client/shell-web/src/runtime.ts` 的 `handleDesktopRequest`（改协议先改它，Android 端镜像跟随）。

| method | Android 状态 | 说明 |
|---|---|---|
| `apps.list` | ✅ | data = `[{id,name,icon(null可能),source,installed}]`；**过滤 system.desktop 自身** |
| `apps.open` | ✅ | params `{id}` → 宿主导航（daily.ai→对话页 / system.store→商店 / 其他→AppRunScreen） |
| `system.navigate` | ✅ | view: `assistant|desktop`（其他返回明确失败） |
| `storage.get/set/remove/list` | ✅ | App 私有存储（native OkHttp 带 cookie） |
| `api.register / api.call` | 部分 | register ok；call 明确失败（M0 范围外） |
| `apps.reorder/remove/share/shareToFriend/export/download`、`system.copy` | ❌ | **明确 respond(false)**（不伪造成功）；M1-3/M1-4 按需补 |

请求格式（JS→native）：`{channel:"daily-webos-sdk", kind:"request", requestId, method, params}`；
响应（native→JS）：`{channel:"daily-webos-sdk", kind:"response", requestId, ok, data, error}`。
requestId 约定：桌面模板用 `r1` 递增，bootstrap SDK shim 用 `req-N`——都在同一管道。

### 4.2 服务端 API（Android 端已消费）

| 端点 | 说明 / 坑 |
|---|---|
| `GET /webos/api/apps` | **返回 BUILTIN_APPS + 用户 state.apps，system.* 可能出现两次** → 客户端必须按 id 去重（`WebosApi.listApps` 已做，LinkedHashMap 后者覆盖） |
| `GET /webos/api/apps/:appId` | 详情 `{app:{versions:[{id,version,html…}], activeVersionId}}`；system.* 保留 html，普通 App 的版本 html 在 bootstrap 瘦身后为空串但**详情端点全量返回** |
| `GET/PUT/DELETE /webos/api/apps/:appId/storage(/:key)` | 私有存储；鉴权靠 cookie（PersistentCookieJar） |
| `POST /apps/:appId/rollback`、`PUT /apps/:appId/active-version`、`POST /apps/:appId/versions` | M1-3 版本时间线/回滚用（服务端已就绪） |
| bootstrap | 大账号 payload 曾 1.6MB → 已瘦身：普通 App 版本 html 不随 bootstrap 下发 |

### 4.3 WebView 沙箱加载模型（AppRuntimeHost）

- `loadDataWithBaseURL(null, 注入后的HTML)` + `<base href="https://shadowshub.xyz/webos/api/apps/<id>/files/raw?scope=app&path=">`（相对素材走 raw 端点，公开免鉴权）。
- 注入：`__DAILY_WEBOS_CONTEXT__` 全局 + `app-runtime-bootstrap.js`（SDK shim + localStorage polyfill + postMessage 直连拦截）。
- 导航白名单：`shadowshub.xyz / 127.0.0.1 / localhost`，外链阻断。
- **加载时机**：必须 `wv.post { loadApp }`（等首次布局），factory 里直接加载会 vh=0 白屏（§5.2）。

---

## 5. 常见坑索引（历史根因，按症状查）

### 5.1 App 启动即崩：Koin null single

- **症状**：`IllegalStateException: Single instance created couldn't return value`，栈指向 AppModule。
- **根因**：`single<T?> { null }` —— Koin 的 `SingleInstanceFactory.getValue` 对 null value 直接抛异常，**不能用 null 占位注册可空依赖**。
- **修复**：删掉该注册，注入处改 `getOrNull<T>()`（无注册安全返回 null）。

### 5.2 WebView DOM 正常但视觉白屏：视口 0 高

- **症状**：pageState `vw:389, vh:0`、bg 正常、hasSDK/hasBridge true、截图像素全白。
- **根因**：Compose `AndroidView(factory)` 时机 View 未 attach/测量，此时 `loadDataWithBaseURL` 页面以 viewport 高 0 布局，**之后 WebView 尺寸就绪也不会自动 relayout**。
- **修复**（两件套，缺一不可）：
  1. `createWebView()` 显式设 `layoutParams = MATCH_PARENT/MATCH_PARENT`；
  2. `factory` 里 `wv.post { host.loadApp(wv, detail) }` 延迟到首次布局后。

### 5.3 桌面/系统 App 白屏：桥方法缺失

- **症状**：`bridge resp: apps.list ok=false error="unknown method: apps.list"`，或桌面模板静默无渲染（模板 catch 吞错）。
- **根因**：系统桌面模板（webosDesktopV1）启动即 `SDK.apps.list()`（postMessage 直连协议），native bridge 未实现该方法。
- **修复**：DailyJsBridge 补方法（§4.1 清单），未实现的方法**明确 respond(false)**。

### 5.4 顶栏与状态栏重叠

- **修复**：根布局 `Modifier.statusBarsPadding()`（AppRunScreen 已做）；M1-1 沉浸式改造后会整体换成 edge-to-edge 方案。

### 5.5 图标重复（两个市场/两个回收站）

- **根因**：bootstrap 返回 builtin+user 双份 system.*（服务端结构，非 bug）。
- **修复**：客户端去重（§4.2）。

### 5.6 pm install 报 avc denied

见 §2.2（先 cp 到 /data/local/tmp）。

### 5.7 logcat grep 混入 Operit 对话日志

- Operit 自身的 DeepseekProvider/AIService 日志也进 main buffer，宽泛 grep（如 `grep AppRuntime`）会捞到**对话里引用的日志文本**。
- **正确姿势**：`logcat -d -s AppRuntime:V`（按 tag 过滤），或 `--pid=$(pidof xyz.shadowshub.daily)`。

### 5.8 WebosApi 解析编译错（Unresolved reference）

- `jsonPrimitive` 扩展属性可直接用（文件顶部已 import）；裸 `JsonPrimitive` 类名需要单独 import——统一用 `?.jsonPrimitive?.contentOrNull` 链式写法最稳。

---

## 6. 手势/沉浸改造前置知识（M1-1/M1-4 必读）

- 宿主-桌面两层职责边界：宿主（Compose）= edge-to-edge、系统栏、跨页横滑（对话⇄桌面）；桌面 HTML = 网格/多页/文件夹/图标拖拽。
- 桌面模板现状：`#pages` 容器 CSS 已有 `scroll-snap-type: x mandatory`，但 **JS 只渲染单页**（`renderApps()` 只填一个 grid）；拖拽中 `#pages.locked` 锁页。多页/边缘翻页/叠放建文件夹 = M1-4 主体工作（见 17 任务卡 M1-4）。
- WebView 手势与 Compose 手势嵌套：桌面 HTML 的横向滚动会消费触摸事件；让渡机制（桌面在最左页且继续右拉 → 桥通知宿主接管）是 M1-4 最大技术点，设计未定稿前**不要**自行实现。
- 性能预算（11 §2）：50 图标 + 拖拽 60fps；对话页 Compose（非 WebView）。

---

## 7. 文档维护规则（谁改什么）

| 场景 | 动作 |
|---|---|
| 当天完成功能/修复 | 当天记 `CHANGELOG.md`（`### YYYY-MM-DD：标题` + Added/Fixed/验证） |
| 踩到新坑/新排障手段 | 追加进本文（16）对应小节 |
| 里程碑状态变化 | 更新 `14-dev-status.md` §4.5 表格 + §5 时间线 |
| 新建分篇文档 | `README.md` §3 文档地图加行 |
| 用户拍板决策 | `README.md` §2 决策清单加 D 行 + 相关分篇同步 |
