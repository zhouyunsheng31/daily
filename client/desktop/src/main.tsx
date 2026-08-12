import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import GlobalErrorBoundary from './components/GlobalErrorBoundary'
import { loadAndRegisterDynamicWidgets } from './utils/evaluateWidget'
import { registerBuiltInWidgets, registerBuiltInCapabilities } from './registry/builtIn'
import { syncCapabilitiesToServer } from './registry/capabilityRegistry'
import { initV2Storage } from './utils/dbV2'
import { registerAllDataSources } from './registry/dataSources'

// Phase 15 批次5：启动性能 profiling（spec 7.2.4）—— 渲染进程启动时间起点
const __rendererStartTime = performance.now()

async function bootstrap() {
  try {
    await initV2Storage()
    const { getAllDynamicWidgets } = await import('./utils/db')
    const defs = await getAllDynamicWidgets()
    loadAndRegisterDynamicWidgets(defs)
  } catch (err) {
    console.error('[Bootstrap] Storage init failed:', err)
  }

  registerBuiltInWidgets()
  registerBuiltInCapabilities()
  registerAllDataSources()

  // Phase 14.4.5：异步同步组件能力声明到服务器（不阻塞渲染）
  syncCapabilitiesToServer().catch(err => {
    console.warn('[Bootstrap] syncCapabilitiesToServer failed:', err)
  })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <GlobalErrorBoundary>
        <App />
      </GlobalErrorBoundary>
    </StrictMode>,
  )
  // Phase 15 批次5：渲染进程 React 挂载完成（spec 7.2.4）
  console.log(`[Profiling] Renderer mounted: ${Math.round(performance.now() - __rendererStartTime)}ms`)
}

bootstrap()
