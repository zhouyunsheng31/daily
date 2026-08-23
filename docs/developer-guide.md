# Daily webOS 开发者指南

> **适用版本**：Daily webOS 架构体系
> **配套文档**：[API 权威参考手册](api-reference.md) · [包体系与市场指南](routes/web/10-package-market-guide.md) · [App API 规范](routes/web/04-app-api.md) · [Agent 规范](../AGENT.md)

---

## 1. 系统定位与开发理念

Daily 是一个**移动端优先、AI-Native 的网页操作系统（webOS）**。

### 1.1 核心原则
* **双端同构**：Web PWA 与 Android 客户端同构消费同一套 HTML 模板，零双端业务逻辑分裂。
* **一切皆包 · 组合式包（Package Spec v2）**：将应用、能力、技能、主题统一抽象为 13 种包类型，支持不可变版本快照与一键回滚。
* **服务即包（App API 体系）**：`App = UI + 数据 + API`。通过声明式 `api.json` 与受限 Node vm handler，实现安全代跑与托管 secrets，提供 owner 级及 public 跨应用数据互通管道。
* **虚拟工作区隔离**：每个用户拥有独立的工作区环境，AI 助手通过标准工作区工具（`agent_fs_*`）安全创建与修改包。

---

## 2. 快速开始与本地开发

### 2.1 环境要求
- **Node.js**：`>= 20.0.0`
- **npm** 或 **pnpm**
- **Git**

### 2.2 安装与启动

```bash
# 1. 克隆代码并安装依赖
git clone git@github.com:zhouyunsheng31/daily.git
cd daily
npm install
cd server && npm install && cd ..

# 2. 启动服务（前后端同时运行）
# Windows 环境
.\dev.bat

# Linux / macOS 环境
npm run dev &
cd server && npm run dev
```

* **Web Shell 前端**：`http://localhost:5173`
* **webOS 后端服务**：`http://localhost:3456`

---

## 3. 开发一个 HTML App

在 Daily 中，App 以沙箱 HTML 的形态运行，双端均可沉浸渲染。

### 3.1 App 结构与 Manifest (`daily.pkg.json`)
```jsonc
{
  "schema_version": 2,
  "id": "com.developer.quick-notes",
  "type": "app",
  "version": "1.0.0",
  "entry": "index.html",
  "display_name": { "zh": "便签应用", "en": "Quick Notes" },
  "description": { "zh": "轻量级便签管理应用" },
  "capabilities": ["app.storage.private"],
  "network": { "domains": ["api.example.com"] }
}
```

### 3.2 在 App 中使用宿主 SDK (`window.daily`)
App 运行环境会自动注入 `window.daily` 对象：

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>便签</title>
</head>
<body>
  <textarea id="note" placeholder="写下你的想法..."></textarea>
  <button id="save">保存</button>

  <script>
    const input = document.getElementById('note');
    
    // 读取持久化数据
    window.addEventListener('load', async () => {
      const saved = await daily.storage.get('my_note');
      if (saved) input.value = saved;
    });

    // 写入持久化数据
    document.getElementById('save').addEventListener('click', async () => {
      await daily.storage.set('my_note', input.value);
      alert('已保存！');
    });
  </script>
</body>
</html>
```

---

## 4. 为 App 声明 App API (`api.json`)

通过声明 `api.json`，可以让你的 App 数据与能力**直接暴露给 AI 助手与系统其他 App**。

### 4.1 声明规范
```json
{
  "schema_version": 1,
  "namespace": "notes",
  "display_name": { "zh": "便签 API" },
  "endpoints": [
    {
      "name": "get_note",
      "method": "GET",
      "path": "/note",
      "description": { "zh": "获取用户的便签内容" },
      "storage": { "read": ["my_note"] },
      "handler": "handlers/get_note.js",
      "visibility": "owner"
    }
  ]
}
```

### 4.2 编写 Handler (`handlers/get_note.js`)
```javascript
async function main(ctx) {
  const content = await ctx.storage.get('my_note');
  return {
    content: content || '（暂无便签）',
    timestamp: Date.now()
  };
}
```

---

## 5. 打包、测试与市场发布

1. **工作区测试**：在 Web Shell 的文件工作区或通过 `POST /webos/api/packages` 上传包。
2. **AI 工具验证**：在 AI 对话中直接询问相关问题，AI 会通过动态注册的 `appapi_notes_get_note` 实时调用。
3. **市场发布**：调用 `POST /webos/api/market/publish` 将包上架，其他用户可一键安装并自动解析依赖。

---

## 6. 更多文档参考

* [API 权威参考手册](api-reference.md)
* [包体系与市场开发指南](routes/web/10-package-market-guide.md)
* [App API 体系深度解析](routes/web/04-app-api.md)