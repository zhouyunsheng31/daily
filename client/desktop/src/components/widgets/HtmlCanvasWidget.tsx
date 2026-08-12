import { useState, useEffect, useMemo, useRef } from 'react'
import {
  generateToken,
  getInitScript,
  handleCanvasAction,
  createMessageHandler,
  type WidgetErrorInfo,
} from '../../utils/iframeProxy'
import { useAIStore } from '../../stores/useAIStore'
import { getHtmlWidget, updateHtmlWidget, createHtmlWidget } from '../../utils/dbStores/htmlWidgets'

interface Props {
  widgetId: string
  panelId: string
  state: Record<string, unknown>
  onUpdateState: (partial: Record<string, unknown>) => void
  onEditingChange?: (editing: boolean) => void
}

const ERROR_SCRIPT = `<script>
(function() {
  window.addEventListener('error', function(e) {
    try {
      parent.postMessage({
        type: 'html_widget_error',
        message: e.message,
        stack: e.error && e.error.stack,
        source: 'runtime'
      }, '*');
    } catch (_) {}
  });
  window.addEventListener('unhandledrejection', function(e) {
    try {
      var reason = e.reason;
      parent.postMessage({
        type: 'html_widget_error',
        message: (reason && reason.message) || String(reason),
        stack: reason && reason.stack,
        source: 'promise'
      }, '*');
    } catch (_) {}
  });
})();
</script>`

function wrapAgentHtml(html: string, token: string): string {
  const initScript = getInitScript(token)
  const lower = html.toLowerCase()
  const hasDoctype = lower.includes('<!doctype html')
  const hasHtmlTag = lower.includes('<html')

  if (hasDoctype || hasHtmlTag) {
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head[^>]*>/i, (match) => match + initScript + ERROR_SCRIPT)
    }
    if (/<html[^>]*>/i.test(html)) {
      return html.replace(/<html[^>]*>/i, (match) => match + initScript + ERROR_SCRIPT)
    }
    return html
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${initScript}${ERROR_SCRIPT}<style>body{margin:0;padding:8px;font-family:system-ui,sans-serif;}</style></head><body>${html}</body></html>`
}

export default function HtmlCanvasWidget({ widgetId, panelId, state, onUpdateState }: Props) {
  const htmlWidgetId = state.htmlWidgetId as string | undefined
  const stateHtml = typeof state.html === 'string' ? state.html : ''
  const title = typeof state.title === 'string' ? state.title : ''

  // 本地 html 状态：优先从 state.html 初始化（兼容旧数据），有 htmlWidgetId 时从服务器加载
  const [html, setHtml] = useState(stateHtml)

  // 加载改造：如果 state 中有 htmlWidgetId，从服务器获取 HTML 内容
  useEffect(() => {
    if (htmlWidgetId) {
      getHtmlWidget(htmlWidgetId).then(data => {
        if (data?.html) setHtml(data.html)
      }).catch(console.error)
    }
  }, [htmlWidgetId])

  // 编辑保存改造：state.html 变化时（agent 生成新内容），同步到服务器
  const prevStateHtmlRef = useRef<string>(stateHtml)
  useEffect(() => {
    if (prevStateHtmlRef.current === stateHtml) return
    prevStateHtmlRef.current = stateHtml
    // state.html 变化，更新本地 html
    setHtml(stateHtml)
    if (!stateHtml) return
    // 同步到服务器
    const syncToServer = async () => {
      try {
        if (htmlWidgetId) {
          await updateHtmlWidget(htmlWidgetId, { html: stateHtml })
        } else {
          // 首次保存，创建 htmlWidget 记录
          const created = await createHtmlWidget({ html: stateHtml, title: title || 'HTML Widget' })
          onUpdateState({ htmlWidgetId: created.id, html: stateHtml })
        }
      } catch (err) {
        console.error('Failed to sync HTML widget to server:', err)
      }
    }
    void syncToServer()
  }, [stateHtml, htmlWidgetId, title, onUpdateState])

  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [prevHtml, setPrevHtml] = useState(html)
  if (html !== prevHtml) {
    setPrevHtml(html)
    setIframeLoaded(false)
    setLastError(null)
  }

  // token 在组件 mount 时生成，生命周期内保持稳定
  const [token] = useState(() => generateToken())
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const loading = html !== '' && !iframeLoaded
  const srcDoc = useMemo(() => wrapAgentHtml(html, token), [html, token])

  useEffect(() => {
    // 修复：error_report 防抖，避免 iframe JS 错误导致 error_report → prompt → 修复 → 又报错的无限循环。
    // 同一 widget 的同一错误消息 5 秒内只上报一次。
    let lastErrorReport: { msg: string; time: number } | null = null

    const onError = (error: WidgetErrorInfo) => {
      queueMicrotask(() => setLastError(error.message))
      // 防抖：同一错误消息 5 秒内只上报一次，阻断循环
      const now = Date.now()
      if (lastErrorReport && lastErrorReport.msg === error.message && now - lastErrorReport.time < 5_000) {
        return
      }
      lastErrorReport = { msg: error.message, time: now }
      // 回传错误到 useAIStore（S2 缺口 D：携带 panelId 让服务器三级兜底路由）
      const aiState = useAIStore.getState() as {
        reportWidgetError?: (widgetId: string, panelId: string, error: WidgetErrorInfo) => void
      }
      aiState.reportWidgetError?.(widgetId, panelId, error)
    }

    const handler = createMessageHandler(
      widgetId,
      token,
      handleCanvasAction,
      onError,
      () => iframeRef.current?.contentWindow ?? null,
    )
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [widgetId, panelId, token])

  if (!html) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-tertiary)',
        fontSize: 13,
        padding: 16,
        textAlign: 'center',
      }}>
        等待 agent 生成内容...
      </div>
    )
  }

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {loading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 13,
          background: 'var(--bg-surface)',
          zIndex: 1,
          pointerEvents: 'none',
        }}>
          加载中...
        </div>
      )}
      {lastError && (
        <div style={{
          padding: '4px 8px',
          fontSize: 11,
          color: 'var(--color-error)',
          background: 'var(--bg-canvas)',
          borderBottom: '1px solid var(--border-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }} title={lastError}>
          ⚠ {lastError}
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={title || 'HTML Canvas'}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        onLoad={() => setIframeLoaded(true)}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
          background: '#fff',
        }}
      />
    </div>
  )
}
