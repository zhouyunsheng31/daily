# Web 端 App API 体系安全威胁建模（2026-08-16）

> 来源：DSH sub-agent（dsh-msuobv41-1c3fpv，31 步）+ 现有代码事实核验
> 适用范围：Web 端（PWA）新增「App API 体系」的三项能力：① App 接入外部 API（服务端代理出站）② App 间 API 调用（记账 App 提供余额 API 给其他 App）③ 系统级 API（AI 对话能力封装进任意 App，不暴露 key）
> 配套文档：`docs/webos-app-api.md`（架构设计）、`docs/android/04-app-api.md`、`05-external-apps.md`、`07-permissions.md`（安卓端已拍板设计）
> 用户红线：**"这个构想可能比较危险，要做好安全措施"**——本文档即安全基线。

---

## 现有代码事实（威胁面基础）

- `server/src/routes/webos.ts` 已有 `proxyHttp()`、`/webos/api/http`、`app.storage` 路由、能力白名单 `DEFAULT_APP_CAPABILITIES`。
- `client/shell-web/src/runtime.ts` 已有 MessageChannel SDK、`http`、`api.register`、`api.call`、`appRuntimePorts`。
- `client/shell-web/src/App.tsx` 中 App iframe 使用 `sandbox="allow-scripts"`，无 `allow-same-origin`（方向正确）。
- `server/src/webos/appApi.ts` **尚不存在**（目标态设计）；`server/src/sandbox/` 目前只是 shell 命令白名单执行器，不是 JS vm 沙箱。
- 服务端已有 `/webos/api/chat/stream`，`DEEPSEEK_API_KEY` 只在服务端环境变量——Phase 3 可复用的安全基础。

---

## 威胁 1：SSRF —— 服务端代理出站被滥用（危害：高）

**威胁**：恶意/被打洞 App 通过 `ctx.http` 让服务端请求任意 URL：云元数据 169.254.169.254、内网管理口、Redis/MongoDB；DNS rebinding 绕过"先解析再检查"；重定向跳到内网；IPv6/整数 IP/域名别名绕过；把服务端当端口扫描器。

**现有缺口**（代码事实）：
- `proxyHttp()` 只校验 IPv4 私网段（且本轮审计发现 redirect 后不复查）；
- `redirect:'follow'` 重定向后不重新校验；
- 无 `api.json` 的 `network.domains` 白名单绑定；
- 无调用方 App/包区分，只有全局每用户 30 次/分钟限频；
- DNS 解析结果与实际连接 IP 存在 TOCTOU。

**防护设计**：
1. **域名白名单绑定包声明**：只有声明 `network.domains` 的包能出站；代理接口必须带服务端签发的调用方身份，服务端从包版本读 domains（不信任前端传入）。匹配粒度：`api.exchangerate.host` 精确；`*.example.com` 仅最左一级通配、不匹配裸域；禁止 IP 字面量白名单；默认仅 443 端口。
2. **DNS 与连接绑定（防 rebinding）**：`dns.lookup(hostname,{all:true,verbatim:true})` 同时取 A/AAAA，**每个** IP 过黑名单；用自定义 `lookup` 回调在**实际建连时**再次解析校验，或解析后直接 IP 建连 + `Host`/TLS `servername` 保持原始域名。
3. **IP 段黑名单（含 IPv6）**：IPv4 `0/8,10/8,127/8,169.254/16,172.16/12,192.168/16,100.64/10,198.18/15,224/4,240/4`；IPv6 `::1/128,::/128,fc00::/7,fe80::/10,::ffff:0:0/96,2001:db8::/32`；拒绝 `169.254.169.254`、`metadata.google.internal`、userinfo@host、非标准端口、localhost。
4. **重定向**：默认 `redirect:'manual'`；如需跟随则每跳重跑（协议/白名单/DNS/IP/端口），最大 3 跳，跨域剥离 Authorization/Cookie/X-Api-Key。
5. **资源限制**：连接超时 5s、总超时 15s；响应流式计数（ctx.http 256KB / 普通代理 2MB）；禁止透传 Set-Cookie/Location。
6. **网络层兜底**：出站独立网段/容器，iptables/安全组默认拒绝内网；元数据 IP 网络层强制 drop。
7. **审计与配额**：每次出站记录包/版本/用户/域名/IP/耗时/字节/状态；日志不记录 query/body/header 敏感值；限频细化为"每用户×每包×每端点"。

**检查点**：api.json 强制 domains；拒绝未绑定包身份的调用；URL 解析拒绝 IP/localhost/userinfo/非白名单端口；A/AAAA 全过黑名单；自定义 lookup 或 IP 直连+Host/SNI；重定向逐跳校验≤3 跳；IPv6 黑名单落地；169.254.169.254 双重封禁；流式大小/超时限制；每用户/包/端点限频；出站审计脱敏落库。

---

## 威胁 2：密钥泄露（危害：高）

**威胁**：外部 API key / AI provider key 明文存储、进日志、进 AI 上下文、进工具结果；App A 调 B 时把 B 的 key 泄露给 A；恶意 App 从返回结构/错误信息/调试接口拿 secrets；备份/导出包含 secrets。

**现有缺口**：`server/src/utils/crypto.ts` 只有密码哈希，无通用 secrets 加密；无脱敏模块；proxyHttp 会过滤客户端 cookie/authorization/host，但无服务端 secrets 框架。

**防护设计**：
1. **加密托管**：新增 `app_secrets` 表（owner_key/package_id/secret_name/ciphertext/iv/auth_tag/updated_at），AES-256-GCM，主密钥来自环境变量/KMS，独立随机 IV，服务端只存密文；用户/作者界面只能看"是否已配置"。
2. **作者 vs 调用者边界**：secrets 只注入服务端 handler 执行上下文 `ctx.secrets.NAME`；不进 AI 工具参数/日志/审计/返回；App A 调 B 时 A 只能拿 B handler 的**最终返回值**，且过 `returns` JSON Schema 校验剥离未声明字段；再对返回值做敏感模式脱敏（sk-、Bearer、key=、token=）。
3. **日志/上下文脱敏**：统一 `redactSecrets(value)`：精确 key 脱敏 + 高熵 token 模式脱敏 + URL query 敏感参数打码；所有日志写入前过 redactor（tlog、工具调用记录、execution.log、错误堆栈）；AI 工具结果进上下文前脱敏+截断。
4. **轮换与吊销**：用户/作者可重置 secret（旧值立即失效）；管理端可吊销某包全部 secrets；主密钥支持轮换（envelope encryption）。

**检查点**：secrets AES-256-GCM；主密钥不在代码库/DB；界面只读"是否已设置"；ctx.secrets 只在 VM handler 内；跨 App 返回过 schema 校验+脱敏；统一 redactor 全覆盖；重置/吊销能力；备份导出排除或保持加密。

---

## 威胁 3：跨 App 数据隔离（危害：高）

**威胁**：App A 调 B 的 API 时越权读写 B 的私有 storage；handler 的 storage 前缀声明不强制导致 `../../other/...` 越权；调用方身份可伪造（前端直接传 appId）；现有 storage 路由只验登录不验调用方 App。

**现有缺口**：`/apps/:appId/storage` 只 `findApp(state,appId)` 不校验调用方；前端 `handleHostRequest` 会查 `params.appId === context.app.id` 但这是前端可信边界；`api.call` 走客户端 appRuntimePorts 无服务端可见身份。

**防护设计**：
1. **服务端调用方身份注入**：为每个 App 运行实例签发短期 `appRuntimeToken`（userKey/appId/versionId/capabilities/exp/nonce，服务端签名，10 分钟有效，Shell 刷新）；App API 端点从 token 取调用方，**不信任请求体里的 appId**。
2. **storage 前缀声明与强制**：api.json `storage.read/write` 必须是自己的命名空间（映射 `owner:<userKey>:<appId>/notes/*`）；拒绝 `..`、绝对路径、空段、非末尾 `*`；`ctx.storage` 是带允许前缀闭包的受限对象，每次读写检查；服务端 storage REST 路由也要调用方 App token + version capability 校验。
3. **visibility 数据边界**：`owner` 仅同 userKey；`shared` 必须 roomId + 成员身份，视图=房间共享命名空间；`public` 任何登录用户可调但只能访问发布者显式 `publishes` 的公共命名空间，写仍需成员/作者身份。执行顺序：JWT 用户认证 → app token 识别调用方 → 包/版本解析 → visibility → storage 前缀求交 → handler。
4. **App 间调用走服务端**：废弃/严格限制客户端 appRuntimePorts 直连；A 调 B 时 Shell 把 A 的 token + B 的 endpoint 发服务端统一执行；目标 App 不需要已打开（handler 在服务端）。

**检查点**：服务端签发校验 appRuntimeToken；端点从 token 取 caller；storage 前缀解析器拒绝越权；ctx.storage 每次读写边界检查；visibility 服务端强制；App 间调用改服务端代理；现有 storage REST 补调用方校验。

---

## 威胁 4：App 间调用滥用（危害：中高）

**威胁**：恶意 App 高频调用他人 API 刷爆速率/消耗积分；调用链无法追踪；visibility=public 写接口被灌数据投毒。

**现有缺口**：`api.call` 客户端内存路由无服务端限频/计费/审计；`api.register` 只返回 ok 无注册表校验；现有积分体系无 App API 计费表。

**防护设计**：
1. **配额与限流**：按"调用方 App × 目标 App × 端点 × 用户"令牌桶；端点可声明 `rateLimit`；每用户单日 API 总额/积分上限（429/402）；目标 App 可设白/黑名单。
2. **计费防滥用**：每次调用生成唯一 `callId`，先预检余额再执行后落账；写操作"先冻结后结算"；幂等键防重试重复扣费；默认向**当前登录用户**计费（非 App 作者），作者补贴需显式配置+上限。
3. **调用链审计**：`app_api_executions` 表（trace_id/caller_user/caller_app_id/caller_version_id/target_namespace/target_endpoint/target_version_id/room_id/cost_minor/status/duration_ms/result_size/created_at）；AI 触发的记录父级 trace_id 可回溯到对话；管理端可按用户/App/端点/时间检索。
4. **public 数据投毒防护**：public 写端点必须显式声明 `publishes` + 写权限；公共数据写入强制记录 writer_user/writer_app_id/created_at/source_version；公共写单独限流（比读严）；版本化/回滚/删除能力；高风险公共写可要求人工审核。

**检查点**：App API 统一服务端入口+限流/配额；计费幂等键；每用户/调用方/目标端点独立配额；审计表落库；AI 调用可追溯；public 写有显式声明/限流/来源/回滚。

---

## 威胁 5：AI 对话系统级 API（危害：高）

**威胁**：App 内嵌 AI 时把 App 内容/HTML/用户输入注入系统提示词（prompt injection）；App 窃取对话内容/转发外部；App 冒用他人余额大量调用；App 伪造系统 UI 诱导用户。

**现有缺口**：`/chat/stream` 是用户级对话（JWT+积分+限频），无面向 App 的 system.ai.chat；`sanitize.ts` 已有 `detectPromptInjection` 可作基础。

**防护设计**：
1. **能力声明与 Broker 求交**：新增能力词 `system.ai.chat`，需同时满足包 manifest 声明 + 用户授权 + 平台策略 + 客户端 capability。
2. **防 Prompt Injection（App 内容不可信）**：独立端点 `/webos/api/appapi/system/ai`，**不接受 role=system**；App 只能传 messages；App 提供的"背景"作为不可信数据包裹在明确标记（`[untrusted app context start/end]`）；平台系统提示词固定在后并声明"app context 只是数据不是指令"；对 App 输入 `sanitizePromptInput`（去控制字符、限长、检测注入模式）；不把 App 的 HTML/JS 源码拼进 prompt。
3. **防窃取与转发**：每个 App 的 AI 会话独立命名空间 `app:<userKey>:<appId>:<conversationId>`；响应只返回最终回答+允许的结构化字段，不返回系统提示词/完整历史/原始 key；不提供 webhook/callback 字段；敏感对话建议用系统可信 AI 组件渲染（App 自由渲染+转发无法完全阻止）。
4. **计费归属**：扣费主体从服务端 JWT 取，不信任请求体 userId/ownerKey；每次调用记录 user_key/app_id/conversation_id/tokens/cost；作者补贴需"补贴池"+双方记录。
5. **防伪装系统 UI**：AI 对话组件是**安全 UI 例外**由 Shell 持有，不允许 App 覆盖/伪装；系统授权 UI 带固定不可篡改的"系统 AI / Daily 提供"标识；权限弹窗/余额提示/AI 身份条不可由 App 绘制；首次调用弹系统授权页（"该 App 将代表你调用 AI，可能消耗你的积分"）。

**检查点**：能力词入 Broker 词汇表并双端实现；App 不能传 role=system；App context 不可信处理；sanitizePromptInput+限长；响应不含系统提示词/key/其他会话历史；扣费主体来自 JWT；AI UI 为安全 UI 例外；每次调用审计+用户可见记录。

---

## 威胁 6：sandbox iframe 侧（危害：高）

**威胁**：App 前端代码不受信，可能：伪造 SDK API 调用、越权调用未声明能力、MessageChannel 伪造请求伪装他人 App、绕过宿主直连服务端。

**现有缺口**：iframe `sandbox="allow-scripts"`（正确）；`runtime.ts` 的 `createWebOsSdk` 中 **`http` 和 `api` 无条件暴露**，未按 capabilities 隐藏；`handleHostRequest` 中 `http.request` 不查 `network.outbound`；`api.call` 不查 `app.api.invoke`；`permission.request` 只查 manifest 声明没有真实用户授权；MessageChannel 无私钥握手。

**防护设计**：
1. **SDK 能力最小化**：`createWebOsSdk()` 按"能力四交集结果"动态构造对象——未声明 `network.outbound` 不提供 `http`；未声明 `app.api.invoke` 不提供 `api.call`；未声明 `system.ai.chat` 不提供 AI 方法；Object.freeze + 不挂未授权方法。
2. **MessageChannel 校验与绑定**：保持 opaque origin；每次 createRuntimeChannel 生成一次性 `runtimeNonce` 注入 bootstrap；iframe 连接消息必须携带 nonce；端口只存当前 appId 实例；destroy() 清理端口；不依赖 event.origin，依赖"端口私有性+nonce+消息 schema+服务端身份 token"。
3. **宿主侧逐次授权**：`permission.request` 从"看 manifest 就 granted"改为真实用户授权 UI（本次/拒绝/记住选择），结果写入策略；http/api/AI 敏感操作首次使用必须用户确认。
4. **参数校验与限流**：宿主处理每个 SDK 方法校验类型/长度/枚举；storage.key 强制格式；fs.path 走服务端校验；http.url 必须服务端做域名白名单；api.call target/name 符合声明格式；每 App SDK 调用频率限制+超时防死循环。
5. **防直连服务端**：服务端所有 App API/storage/http 代理要求 `appRuntimeToken` 或等价身份，不能只靠 Cookie；App 绕过 SDK 直连也会因缺 token 被拒；服务端不能只依赖 CORS。

**检查点**：iframe 保持 allow-scripts（不开放 allow-same-origin/forms/popups/top-navigation）；SDK 按能力裁剪；http/api/AI 都查能力声明；permission.request 接真实授权 UI；MessageChannel nonce/实例绑定+destroy 清理；SDK 入参双端校验；服务端 App API 强制 app token。

---

## 威胁 7：管理面（危害：中高）

**威胁**：恶意 api 包上架影响大量用户；已上架包发现漏洞无法快速下架/封禁/强制回滚；被入侵包继续用泄露 secrets；无应急响应和全局 kill switch。

**现有缺口**：`webos_store_apps` status 默认 published 无 review 状态；adminWebosRouter 主要管用户/积分/用量，无包审核/封禁/吊销；包体系在文档中规划未见完整实现。

**防护设计**：
1. **上架审核**：api 包发布公共商店前必须 `pending_review`；自动静态审核（manifest schema、能力词白名单、domains/storage/visibility 合法、handler AST/正则扫描禁 require/process/fs/child_process/eval/Function/动态 import/裸 fetch——只允许 ctx.http/storage/secrets）；自动沙箱测试（超时/输出大小/storage 越权/secret 不可读）；`visibility=public`/写操作/system.ai.chat/外部域名/secrets 使用的包人工复核；新作者默认低配额。
2. **版本不可变与签名**：每版本内容哈希入库，安装校验；已发布不可变；修改=新版本重新审核；扩大能力/域名/storage 范围必须重新走授权确认页。
3. **撤销/封禁**：管理端支持 suspend（暂停新调用）/ban（禁装禁调下架）/revoke_version（版本哈希黑名单）/force_rollback（强制回滚）；封禁联动吊销 appRuntimeToken + secrets；用户可撤销某 App 的 API 权限。
4. **应急响应**：全局 kill switch（api.enabled/http_proxy.enabled/system_ai.enabled）；bootstrap 下发封禁名单/禁用策略；安全通告模板（发现→封禁→吊销→通知→黑名单）；审计日志不可删、保留 ≥180 天。

**检查点**：商店 schema 加 review_status 枚举；api 包发布必过自动审核+沙箱测试；管理端有封禁/版本吊销/强制回滚接口；客户端能收 kill switch 和黑名单；secrets 吊销与封禁联动；应急 runbook。

---

## 安全基线总结

### 必须做（第一优先级，不满足不开这些能力）

1. **SSRF 防护完整**：域名白名单、IPv4/IPv6 私网黑名单、DNS rebinding 防护、重定向逐跳校验、超时/响应大小限制。
2. **Secrets 加密且不可达前端**：服务端加密存储，ctx.secrets 只在 VM 内，日志/AI 上下文/返回值全脱敏。
3. **跨 App 数据隔离服务端强制**：服务端 app token 识别调用方，storage 前缀声明强制，visibility 不可绕过。
4. **App API 调用计费+限流+审计**：否则刷积分、刷外部 API、无法溯源。
5. **SDK 能力最小化**：未声明能力不暴露；http/api/AI 不能无条件可用。
6. **系统 AI 保护用户余额和系统提示词**：扣费主体来自 JWT；App 内容按不可信数据处理；AI UI 为安全 UI 例外。
7. **管理端封禁/下架/吊销能力**：至少最简版（封包、封版本、吊销 secrets、全局关能力）。

### 可后置（增强项）

1. 高级异常检测/自动风控（先固定配额+限流）。
2. public 写数据人工审核流（先只 owner/shared 写，public 先只读）。
3. 密钥自动轮换/KMS 集成（第一版环境变量主密钥+AES-GCM 即可）。
4. 细粒度逐次授权（第一版"首次使用授权+可撤销"；每次弹窗影响体验可后置）。
5. 完整包签名/供应链验证（先版本哈希不可变；正式签名后置）。
6. 对话内容外发 DLP（平台无法完全阻止 App 转发用户输入，用"系统可信 UI+审计+用户知情"缓解，完整 DLP 后置）。

---

## 与既有审计的联动

- 既有漏洞 C1（entities 全量越权）直接威胁本体系：App API 的 storage 若仍走通用 entities 表，等于把新能力接在已沦陷的数据层上——**先修 C1 再上 App API**。
- H3（SSRF 重定向绕过）与本威胁 1 直接相关：Phase 1 代理必须从第一天就按威胁 1 的完整防护实现，不能沿用现有 proxyHttp。
- H8（客户端 apiConfig 任意 endpoint）与本威胁 5 相关：系统 AI 的 App 端调用必须由服务端固定 provider，禁止 App 传 endpoint。
- 建议实施顺序：先修既有审计 C1/C3/H6 → 再开发 App API Phase 1（外部代理带完整 SSRF+secrets）→ Phase 2（vm 沙箱+visibility+计费审计）→ Phase 3（system.ai.chat 按威胁 5 防护）。