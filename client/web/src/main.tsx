import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import WebContextMenu from './components/WebContextMenu'
// C1 修复：registerBuiltInCapabilities 在 builtIn.tsx 中导出（L325），不在 capabilityRegistry.ts
import { registerBuiltInWidgets, registerBuiltInCapabilities } from './registry/builtIn'
import { syncCapabilitiesToServer } from './registry/capabilityRegistry'
import { registerAllDataSources } from './registry/dataSources'
import { useAppStore } from './stores/useAppStore'  // C6 修复：通过 refreshDynamicWidgets 一次性完成 fetch + register + setState
import './index.css'

// C4 修复：同步部分在 render 前执行（避免白屏），异步部分在 render 后执行
// 1. 同步注册（必须在 App 渲染前完成，否则 getBuiltInWidgetConfigs() 返回空）
registerBuiltInWidgets()
registerBuiltInCapabilities()
registerAllDataSources()

// 2. 先渲染 UI（避免白屏——getAllDynamicWidgets 是网络请求，期间不应阻塞页面）
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <WebContextMenu>
        <App />
      </WebContextMenu>
    </BrowserRouter>
  </React.StrictMode>,
)

// 3. 异步初始化（render 之后执行，动态 widget 加载完成后通过 store 触发 UI 更新）
void (async () => {
  try {
    // C6+M4 修复：通过 refreshDynamicWidgets 一次性完成 fetch + register + setState
    // refreshDynamicWidgets 内部调用：
    //   getAllDynamicWidgets({ desktop: false })  → HTTP GET /api/dynamic-widgets?desktop=false
    //   loadAndRegisterDynamicWidgets(defs)       → 注册组件到 registry（M3：local-dependent 跳过注册）
    //   set({ dynamicWidgets: defs })             → 更新 store，触发 CanvasHome 响应式重渲染（C7 修复）
    await useAppStore.getState().refreshDynamicWidgets({ desktop: false })
  } catch (err) {
    console.error('[bootstrap] load dynamic widgets failed:', err)
  }
  // 4. 同步 capabilities 到 server（最后执行，避免阻塞 UI）
  void syncCapabilitiesToServer()
})()
