# Phase 0 Spec：基础设施准备

> 分支：client-v1
> 基于 roadmap_client_v1.md Phase 0
> 日期：2026-06-23

---

## 一、目标

1. **Electron 项目搭建**：在现有项目集成 Electron，保留 Vite + React 前端
2. **项目结构调整**：调整为 `client/desktop/` + `client/android/` + `server/` + `shared/` 结构
3. **开发环境配置**：配置 electron-vite，支持热更新
4. **git 分支策略**：创建 `client-v1` 分支（已完成）

---

## 二、验收标准

- [ ] Electron 能启动并加载现有 React 应用（所有 25 个组件正常渲染）
- [ ] 项目结构调整为 `client/desktop/` + `client/android/` + `server/` + `shared/`
- [ ] 开发热更新正常（渲染进程 HMR + 主进程/preload 热重载）
- [ ] 现有功能不破坏（画布、组件、AI 助手、WS 连接、IndexedDB 持久化）
- [ ] `npx tsc -b --noEmit` 零错误（包含 app/node/config 三个 project）
- [ ] `electron-vite build` 零错误

---

## 三、技术决策

### 3.1 electron-vite 版本选择

**决策**：使用 `electron-vite@6.0.0-beta.1`

**理由**：
- 项目当前用 Vite 8，electron-vite v5.0.0 稳定版只支持 Vite 7
- v6.0.0-beta.1 是唯一支持 Vite 8 的版本（2026-04-12 发布）
- 降级 Vite 到 7 影响范围大，不如用 beta 版本

**风险缓解**：
- beta 版本可能存在 bug，开发时充分测试
- 关注 GitHub Issues
- 如遇阻塞性 bug，回退方案：降级 Vite 到 7 + electron-vite v5.0.0

### 3.2 项目结构方案

**决策**：按 roadmap 第十二节验收标准调整为 `client/desktop/` + `client/android/` + `server/` + `shared/`

**与 roadmap 第七节的偏离说明**：

roadmap 自身存在矛盾：
- 第七节 Phase 0 表格说"保留现有 `src/` 不迁移，新增 `electron/` 目录"
- 第十二节验收标准说"项目结构调整为 `client/desktop/` + `client/android/` + `server/` + `shared/`"
- 附录 13.3 说"Phase 0 保留现有 `src/` 不迁移"

用户确认"一切以roadmap为主"。本 Spec 选择满足**第十二节验收标准**（迁移 src/ 到 client/desktop/src/），理由：
1. 验收标准是"必须满足"的硬性要求
2. 一次迁移到位，避免 Phase 1 再迁移的重复成本
3. 现有代码用相对路径（无 @/ 别名），src/ 内部相对路径在迁移后不变，只需更新入口文件

**目标结构**：
```
event/
├── client/
│   ├── desktop/                # 桌面端（Electron + React）
│   │   ├── electron/           # Electron 主进程
│   │   │   ├── main/
│   │   │   │   └── index.ts    # 主进程入口
│   │   │   └── preload/
│   │   │       └── index.ts    # preload 脚本
│   │   ├── src/                # React 前端（从根目录 src/ 迁移）
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   └── ...
│   │   ├── public/             # 静态资源（从根目录 public/ 迁移）
│   │   │   ├── favicon.svg
│   │   │   └── icons.svg
│   │   ├── index.html          # 渲染进程入口（从根目录迁移）
│   │   ├── tsconfig.app.json   # 渲染进程 TS 配置（从根目录迁移）
│   │   └── tsconfig.node.json  # 主进程/preload TS 配置（从根目录迁移）
│   └── android/                # 安卓端（Phase 4，暂为空目录）
│       └── .gitkeep
├── server/                     # 后端（保持不动，端口 3456）
│   ├── src/
│   ├── package.json
│   └── ...
├── shared/                     # 多端共享代码（类型定义、协议）
│   └── .gitkeep
├── docs/                       # 文档（保持不动）
├── electron.vite.config.ts     # electron-vite 配置（根目录）
├── electron-builder.yml        # 打包配置（根目录）
├── tsconfig.json               # 根 TS 配置（references）
├── tsconfig.config.json        # 配置文件 TS 配置（electron.vite.config.ts）
├── package.json                # 根 package.json（前端 + Electron 依赖）
├── .npmrc                      # Electron 下载镜像配置
├── eslint.config.js            # ESLint 配置（更新）
├── dev.bat                     # 开发启动脚本（更新）
├── start.bat                   # 启动脚本（更新）
└── .gitignore
```

**关键决策**：
- `package.json` 保留在根目录（不拆分为 monorepo，避免 Phase 0 复杂度）
- `electron.vite.config.ts` 放根目录（electron-vite 默认在根目录查找）
- `server/package.json` 保持独立（后端依赖隔离）
- `client/android/` 和 `shared/` 暂为空目录（预留，Phase 4 填充）
- `public/` 迁移到 `client/desktop/public/`（与 src/ 一起迁移，保持结构一致）
- `server/` 端口保持 3456（与 useAIStore.ts 默认值 `ws://localhost:3456/ws` 一致；roadmap Phase 1 的 3001 是后续调整）

### 3.3 Electron 主进程加载方式

**决策**：开发时 `loadURL`，生产时 `loadFile`

```typescript
// 开发：loadURL(process.env.ELECTRON_RENDERER_URL) → http://localhost:5173
// 生产：loadFile(out/renderer/index.html)
```

### 3.4 ESM 处理

项目 `package.json` 有 `"type": "module"`，需注意：
- 主进程和 preload 打包后为 ESM（.mjs 后缀）
- ESM 中 `__dirname` 不可用，用 `import.meta.url` + `fileURLToPath` 替代
- preload 引用路径用 `../preload/index.mjs`

---

## 四、详细实施计划

### 4.1 目录迁移

#### 4.1.1 创建新目录

```
client/desktop/electron/main/
client/desktop/electron/preload/
client/android/
shared/
```

#### 4.1.2 迁移文件

| 源文件 | 目标文件 | 说明 |
|--------|----------|------|
| `src/` | `client/desktop/src/` | 整个目录迁移（git mv） |
| `index.html` | `client/desktop/index.html` | 渲染进程入口 |
| `tsconfig.app.json` | `client/desktop/tsconfig.app.json` | 渲染进程 TS 配置 |
| `tsconfig.node.json` | `client/desktop/tsconfig.node.json` | 主进程/preload TS 配置 |

#### 4.1.3 删除旧文件

| 文件 | 说明 |
|------|------|
| `vite.config.ts` | 被 electron.vite.config.ts 替代 |
| `tsconfig.json`（旧） | 替换为新的根 tsconfig.json |

#### 4.1.4 新增文件

| 文件 | 说明 |
|------|------|
| `client/desktop/electron/main/index.ts` | Electron 主进程入口 |
| `client/desktop/electron/preload/index.ts` | preload 脚本 |
| `electron.vite.config.ts` | electron-vite 配置（根目录） |
| `electron-builder.yml` | 打包配置（根目录） |
| `tsconfig.json`（新） | 根 TS 配置（references 指向 client/desktop/） |
| `client/android/.gitkeep` | 预留目录占位 |
| `shared/.gitkeep` | 预留目录占位 |

### 4.2 配置文件

#### 4.2.1 electron.vite.config.ts（根目录）

```typescript
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'client/desktop/electron/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'client/desktop/electron/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'client/desktop'),
    publicDir: resolve(__dirname, 'client/desktop/public'),
    envDir: resolve(__dirname, '.'),  // .env / .env.local 仍从根目录读取
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'client/desktop/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'client/desktop/src'),
      },
    },
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3456',
          changeOrigin: true,
        },
        '/llm-proxy/api.st0722.top': {
          target: 'https://api.st0722.top',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/llm-proxy\/api\.st0722\.top/, ''),
          secure: true,
        },
        '/llm-proxy/chat.st0722.top': {
          target: 'https://chat.st0722.top',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/llm-proxy\/chat\.st0722\.top/, ''),
          secure: true,
        },
        '/llm-proxy/api.stepfun.com': {
          target: 'https://api.stepfun.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/llm-proxy\/api\.stepfun\.com/, ''),
          secure: true,
        },
      },
    },
  },
})
```

**关键点**：
- `__dirname` 用 `fileURLToPath` 显式定义（ESM 兼容，不依赖隐式注入）
- `publicDir` 显式指向 `client/desktop/public`（避免 favicon 404）
- `envDir` 显式指向根目录（.env / .env.local 仍从根目录读取，避免 VITE_STEPFUN_API_KEY 等环境变量丢失）
- `renderer.root` 指向 `client/desktop`（index.html 所在目录）
- `@` alias 仅在 renderer 配置（main/preload 暂不配置，未来需要时再加）

#### 4.2.2 tsconfig.json（根目录，新）

```json
{
  "files": [],
  "references": [
    { "path": "./client/desktop/tsconfig.app.json" },
    { "path": "./client/desktop/tsconfig.node.json" },
    { "path": "./tsconfig.config.json" }
  ]
}
```

#### 4.2.2a tsconfig.config.json（根目录，新增）

用于类型检查 `electron.vite.config.ts`：

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.config.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "types": ["node"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "composite": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["electron.vite.config.ts"]
}
```

#### 4.2.3 client/desktop/tsconfig.app.json（迁移+更新）

原 tsconfig.app.json 的 `include` 从 `["src"]` 改为 `["src"]`（相对于 client/desktop/），新增 `@` 路径别名（为 Phase 1+ 预留，现有代码用相对路径不依赖 @/）：

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "module": "esnext",
    "types": ["vite/client", "node"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

#### 4.2.4 client/desktop/tsconfig.node.json（迁移+更新）

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "types": ["node"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["electron/main", "electron/preload"]
}
```

#### 4.2.5 package.json（根目录，更新）

新增依赖和 scripts：

```json
{
  "name": "event",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "lint": "eslint .",
    "typecheck": "tsc -b --noEmit",
    "build:win": "npm run build && electron-builder --win",
    "build:unpack": "npm run build && electron-builder --dir",
    "postinstall": "electron-builder install-app-deps"
  },
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "6.0.0-beta.1",
    "@electron-toolkit/utils": "^3.0.0",
    "@electron-toolkit/preload": "^3.0.0"
  }
}
```

**说明**：
- 删除 `dev:web` 和 `build:web`（vite.config.ts 已删除，纯 web 模式无法工作；所有开发走 electron-vite）
- `main` 字段指向 Electron 主进程产物
- `postinstall` 用于 electron-builder 重建原生依赖（首次安装会较慢）
- `typecheck` 用 `tsc -b --noEmit`（构建所有 references project 并做类型检查）
- `electron-vite` 用精确版本 `6.0.0-beta.1`（无 `^`，因为 npm 对 prerelease 版本的 `^` 不匹配正式版；等正式版发布后改为 `^6.0.0`）

#### 4.2.6 electron-builder.yml（根目录）

```yaml
appId: com.allmylife.event
productName: Living Dashboard
directories:
  buildResources: build
files:
  - '!**/.vscode/*'
  - '!client/desktop/src/**'
  - '!client/desktop/electron/**'
  - '!client/desktop/public/**'
  - '!client/desktop/tsconfig*.json'
  - '!client/android/**'
  - '!shared/**'
  - '!docs/**'
  - '!server/**'
  - '!electron.vite.config.{js,ts,mjs,cjs}'
  - '!{.env,.env.*}'
  - '!{tsconfig.json,tsconfig.config.json}'
  - '!{dev.bat,start.bat,AGENT.md,README.md,SPEC.md}'
asarUnpack:
  - resources/**
win:
  executableName: living-dashboard
  target:
    - nsis
nsis:
  artifactName: ${name}-${version}-setup.${ext}
  shortcutName: ${productName}
  uninstallDisplayName: ${productName}
  oneClick: false
  allowToChangeInstallationDirectory: true
npmRebuild: false
electronDownload:
  mirror: https://npmmirror.com/mirrors/electron/
```

**关键点**：
- 排除所有源代码目录（client/desktop/src、client/desktop/electron、client/desktop/public）
- 排除 client/android/、shared/、docs/、server/（不打包进 app）
- 排除配置文件和脚本
- electron 下载镜像与 .npmrc 统一（https://npmmirror.com/mirrors/electron/）

#### 4.2.7 .npmrc（根目录，新增）

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

**关键点**：
- 镜像 URL 与 electron-builder.yml 中的 electronDownload.mirror 统一
- .npmrc 提交到仓库（仅含镜像配置，无敏感信息），但打包时不包含进 app（electron-builder.yml 排除）

### 4.3 Electron 主进程代码

#### 4.3.1 client/desktop/electron/main/index.ts

```typescript
import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// 注：electron-vite 在 ESM 模式下会自动注入 __dirname（= import.meta.dirname）
// 不需要手动定义，否则会报 "Identifier '__dirname' has already been declared"

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    show: false,
    autoHideMenuBar: true,
    title: 'Living Dashboard',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 开发环境：加载 Vite dev server URL（支持 HMR）
  // 生产环境：加载本地打包后的 HTML 文件
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.allmylife.event')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

**关于 preload 后缀**：
- 项目 `package.json` 有 `"type": "module"`，electron-vite 会将 preload 打包为 ESM（.mjs 后缀）
- **已验证**：`npm run build` 输出 `out/preload/index.mjs`，与预期一致
- **已验证**：`npm run dev` 启动成功，无 preload 加载错误

**关于 __dirname**（实施时发现的问题）：
- electron-vite 在 ESM 模式下会自动注入 `const __dirname = import.meta.dirname`（CJS 兼容 shim）
- 主进程代码中**不需要**手动定义 `__dirname`，否则会报 `SyntaxError: Identifier '__dirname' has already been declared`
- `electron.vite.config.ts` 中仍需手动定义（配置文件运行在 Node.js，不经过 electron-vite 的 shim 注入）

#### 4.3.2 client/desktop/electron/preload/index.ts

```typescript
import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 通过 contextBridge 安全地暴露 API 给渲染进程
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
}
```

### 4.4 index.html 更新

`client/desktop/index.html` 中的 script 路径保持 `/src/main.tsx`（相对于 renderer root）：

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Living Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**变更**：
- title 从 `fallmylifeevent-temp` 改为 `Living Dashboard`

### 4.5 .gitignore 更新

新增：

```
# Electron build output
out/
dist-electron/
```

**注意**：`.npmrc` 仅含镜像配置（无敏感信息），应该提交到仓库。

### 4.5a eslint.config.js 更新

```javascript
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'out', 'dist-electron']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    // Electron 主进程/preload 用 Node 环境
    files: ['client/desktop/electron/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
```

**变更**：
- `globalIgnores` 加 `out`、`dist-electron`
- 新增 `client/desktop/electron/**/*.ts` 的 Node 环境配置

### 4.5b dev.bat 和 start.bat 更新

**dev.bat**：
```bat
@echo off
set PATH=D:\nodejs\node-v22.16.0-win-x64;%PATH%
cd /d F:\allmylife\event

echo Starting backend server...
start "Living Dashboard API" cmd /c "cd /d F:\allmylife\event\server && npm run dev"

timeout /t 2 /nobreak >nul

echo Starting Electron dev server...
npm run dev
pause
```

**start.bat**：与 dev.bat 相同（统一用 `npm run dev`）

**变更**：
- 开头加 `set PATH=D:\nodejs\node-v22.16.0-win-x64;%PATH%`（确保 npm 可用）
- 前端启动从 `node_modules\vite\bin\vite.js` 改为 `npm run dev`（electron-vite dev）
- 后端启动从 `npx tsx src\index.ts` 改为 `npm run dev`（与 Spec 7.2 一致，有 watch）

### 4.6 AGENT.md 更新

更新开发命令：

```bash
# 需要 Node.js，路径：D:\nodejs\node-v22.16.0-win-x64
$env:PATH = "D:\nodejs\node-v22.16.0-win-x64;" + $env:PATH

# 启动后端服务（终端 1）
cd f:\allmylife\event\server
npm run dev

# 启动 Electron 开发服务器（终端 2，前端 + 主进程）
cd f:\allmylife\event
npm run dev

# TypeScript 类型检查
npm run typecheck

# 构建 Electron 应用
npm run build

# 打包成 Windows exe
npm run build:win
```

**变更**：
- 删除 `dev:web` 和 `build:web`（vite.config.ts 已删除，纯 web 模式不可用）
- 类型检查从 `npx tsc --noEmit` 改为 `npm run typecheck`（= `tsc -b --noEmit`）
- 前端启动从 `npx vite --host` 改为 `npm run dev`（electron-vite dev）

---

## 五、实施步骤

### 步骤 0：验证分支
```bash
git branch --show-current
```
- 确认输出 `client-v1`（如果不是，执行 `git checkout client-v1`）

### 步骤 1：创建目录结构
- 创建 `client/desktop/electron/main/`
- 创建 `client/desktop/electron/preload/`
- 创建 `client/android/`（加 .gitkeep）
- 创建 `shared/`（加 .gitkeep）

### 步骤 2：迁移现有文件（git mv）
- `git mv src/ client/desktop/src/`
- `git mv public/ client/desktop/public/`
- `git mv index.html client/desktop/index.html`
- `git mv tsconfig.app.json client/desktop/tsconfig.app.json`
- `git mv tsconfig.node.json client/desktop/tsconfig.node.json`

### 步骤 3：删除旧配置
- `git rm vite.config.ts`（被 electron.vite.config.ts 替代）

### 步骤 4：创建新文件
- `electron.vite.config.ts`（根目录）
- `electron-builder.yml`（根目录）
- `.npmrc`（根目录）
- `tsconfig.json`（根目录，新内容）
- `tsconfig.config.json`（根目录，新增）
- `client/desktop/electron/main/index.ts`
- `client/desktop/electron/preload/index.ts`
- `client/android/.gitkeep`
- `shared/.gitkeep`

### 步骤 5：更新配置文件
- `client/desktop/tsconfig.app.json`（加 paths 别名）
- `client/desktop/tsconfig.node.json`（更新 include 为 electron/main、electron/preload）
- `client/desktop/index.html`（更新 title）
- `package.json`（加依赖和 scripts）
- `.gitignore`（加 out/、dist-electron/）
- `eslint.config.js`（加 out/dist-electron 忽略，加 electron/ 的 Node 环境配置）
- `dev.bat`（改为 npm run dev）
- `start.bat`（改为 npm run dev）
- `AGENT.md`（更新开发命令）

### 步骤 6：安装依赖
```bash
npm install
```

### 步骤 7：验证

#### 7.1 类型检查
```bash
npx tsc -b --noEmit
```
- 零错误（包含 app/node/config 三个 project）

#### 7.2 启动后端服务
```bash
cd server && npm run dev
```
- 确认监听 3456 端口
- 确认 SQLite 初始化成功
- 确认 pi bridge 初始化（需要 .env 中的 VITE_STEPFUN_API_KEY）

#### 7.3 启动 Electron
```bash
cd .. && npm run dev
```
- Electron 窗口正常启动
- 加载 React 应用（不是白屏）
- DevTools 自动打开（开发模式）
- DevTools Console 无 preload 加载错误

#### 7.4 验证 React 应用加载
- 25 个组件在 AddWidgetMenu 中可见
- 画布正常渲染（平移、缩放）
- 创建一个组件（如文本框），验证渲染正常

#### 7.5 验证 WS 连接
- AI 助手组件显示"已连接"状态
- DevTools Console 无 WS 连接错误
- DevTools Network 看 /ws 连接成功（101 Switching Protocols）

#### 7.6 验证 IndexedDB 持久化
- 创建一个笔记或组件
- 刷新 Electron 窗口（Ctrl+R）
- 确认数据保留

#### 7.7 验证 proxy 配置
- DevTools Network 看 /api 请求是否转发到 localhost:3456
- AI 助手对话时 /llm-proxy 请求是否正常

#### 7.8 验证 HMR
- 修改 client/desktop/src/ 下的任意 .tsx 文件
- 确认页面热更新（不刷新整个页面）
- 修改 client/desktop/electron/main/index.ts
- 确认 Electron 重启（主进程热重载）

#### 7.9 验证构建
```bash
npm run build
```
- out/main/index.js 生成
- out/preload/index.mjs 生成
- out/renderer/index.html 生成

---

## 六、风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| electron-vite@6.0.0-beta.1 不稳定 | 充分测试；回退方案见下方 |
| 文件迁移后 import 路径断裂 | 现有代码用相对路径，src/ 内部相对路径不变；只需更新入口文件 |
| ESM 兼容性问题 | 主进程用 fileURLToPath 替代 __dirname；preload 引用 .mjs 后缀；实施时验证实际输出 |
| Electron 下载慢 | 配置 npmmirror 镜像（.npmrc） |
| 现有功能破坏（WS、IndexedDB） | 迁移后逐一验证（步骤 7.2-7.7）；proxy 配置完整迁移 |
| Tailwind CSS v4 配置丢失 | electron.vite.config.ts 中保留 tailwindcss 插件 |

**electron-vite beta 版本回退方案**：

触发条件（满足任一即回退）：
- `npm run dev` 启动失败且无法在 1 小时内修复
- `npm run build` 构建失败且无法在 1 小时内修复
- preload 加载失败（.mjs 后缀问题且无法解决）
- HMR 不工作且无法在 1 小时内修复

回退步骤：
1. 修改 package.json：`vite` 降级到 `^7.0.0`，`electron-vite` 改为 `^5.0.0`
2. 删除 node_modules 和 package-lock.json
3. `npm install`
4. 验证 `npm run dev` 和 `npm run build`
5. 如果 Vite 7 与 React 19 不兼容（JSX 转换问题），进一步回退 React 到 18

---

## 七、不在 Phase 0 范围

以下功能属于后续 Phase，Phase 0 不实现：
- 标签页管理（Phase 1）
- 侧边栏面板库（Phase 1）
- 浏览器引擎集成（Phase 2）
- 网页组件（Phase 2）
- AI 操控浏览器（Phase 2）
- 服务器化（Phase 3）
- 安卓端（Phase 4）
- 系统托盘（Phase 1）
- 打包成 exe（Phase 1，Phase 0 只验证 build 能成功）

---

## 八、对抗审查重点

审查时请重点关注：
1. **项目结构是否满足验收标准**：client/desktop/ + client/android/ + server/ + shared/ 是否齐全
2. **现有功能是否破坏**：WS 连接、IndexedDB、AI 助手、画布、组件是否正常
3. **热更新是否正常**：渲染进程 HMR + 主进程/preload 热重载
4. **配置是否完整**：proxy、tailwindcss、tsconfig paths 是否正确迁移
5. **ESM 处理是否正确**：__dirname 替代、.mjs 后缀
6. **electron-vite beta 版本风险**：是否需要回退方案
