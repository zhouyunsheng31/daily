/**
 * iframeProxy — Phase 3A
 *
 * HtmlCanvasWidget (iframe) 与父窗口的 postMessage 代理逻辑。
 * spec §5.2 定义了协议：
 * - 父窗口 → iframe：{ type: 'canvas_init', token }（首次加载注入 token）
 * - iframe → 父窗口：{ type: 'canvas_action', token, action, params, requestId }
 * - 父窗口 → iframe：{ type: 'canvas_response', requestId, success, data?, error? }
 * - iframe → 父窗口：{ type: 'html_widget_error', message, stack?, source }
 *
 * agent 生成的 HTML 通过 postMessage 请求父窗口代理执行 read_storage/write_storage/http_fetch。
 */

import { getKvValue, setKvValue } from './dbStores/kvStorage'
import { readFromLegacyTable } from './wsToolHandlers'

/** 生成随机 token（UUID v4） */
export function generateToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // fallback: 手动生成 UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** 返回 token 初始化脚本，注入到 iframe srcdoc 中 */
export function getInitScript(token: string): string {
  // 转义特殊字符防止注入
  const escaped = token.replace(/['"\\]/g, '\\$1')
  return `<script>window.__CANVAS_TOKEN__ = "${escaped}";</script>
<script>
window.canvasStorage = (function() {
  var token = "${escaped}";
  var pending = new Map();
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || d.type !== 'canvas_response') return;
    var p = pending.get(d.requestId);
    if (!p) return;
    pending.delete(d.requestId);
    if (d.success) p.resolve(d.data);
    else p.reject(new Error(d.error || 'canvas action failed'));
  });
  function call(action, params) {
    return new Promise(function(resolve, reject) {
      var requestId = (crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
      pending.set(requestId, { resolve: resolve, reject: reject });
      parent.postMessage({
        type: 'canvas_action', token: token, action: action,
        params: params, requestId: requestId
      }, '*');
    });
  }
  return {
    read: function(key, table) {
      var p = { key: key };
      if (table) p.table = table;
      return call('read_storage', p).then(function(r) { return r && r.value; });
    },
    write: function(key, value) {
      return call('write_storage', { key: key, value: value }).then(function() { return true; });
    },
    httpFetch: function(url, options) {
      return call('http_fetch', { url: url, options: options || {} });
    }
  };
})();
</script>`
}

/**
 * 处理 iframe 的 action 请求。
 * - read_storage：读 KV 存储
 * - write_storage：写 KV 存储
 * - http_fetch：发起 HTTP 请求（受 CORS 限制）
 * - create_widget：暂不实现（agent 应使用 create_html_widget 工具）
 */
export async function handleCanvasAction(action: string, params: Record<string, unknown>): Promise<unknown> {
  switch (action) {
    case 'read_storage': {
      const key = params?.key
      if (typeof key !== 'string' || key.length === 0) {
        throw new Error('read_storage: key is required')
      }
      const table = params?.table
      // 如果指定了 table，从旧表读取归档数据（复用 wsToolHandlers 的逻辑）
      if (typeof table === 'string' && table.length > 0) {
        const result = await readFromLegacyTable(table, key)
        if (!result.success) {
          throw new Error(result.error ?? 'read_storage: legacy table read failed')
        }
        return { value: (result.data as { value: unknown } | undefined)?.value }
      }
      // 否则从 kvStorage 读取
      const value = await getKvValue(key)
      return { value }
    }
    case 'write_storage': {
      const key = params?.key
      if (typeof key !== 'string' || key.length === 0) {
        throw new Error('write_storage: key is required')
      }
      await setKvValue(key, params.value)
      return { success: true }
    }
    case 'http_fetch': {
      const url = params?.url
      if (typeof url !== 'string' || url.length === 0) {
        throw new Error('http_fetch: url is required')
      }
      const options = (params?.options || {}) as RequestInit
      const res = await fetch(url, options)
      const data = await res.text()
      return { status: res.status, data }
    }
    case 'create_widget':
      throw new Error('not implemented: use create_html_widget tool instead')
    default:
      throw new Error(`unknown action: ${action}`)
  }
}

/** iframe postMessage 消息结构 */
export interface CanvasMessage {
  type: string
  token?: string
  action?: string
  params?: Record<string, unknown>
  requestId?: string
  message?: string
  stack?: string
  source?: string
}

/** 错误信息结构 */
export interface WidgetErrorInfo {
  message: string
  stack?: string
  source: string
}

/**
 * 创建 message 事件处理器。
 * - 校验 message 来源（如果提供 getExpectedSource，必须是 iframe 的 contentWindow）
 * - 校验 token（canvas_action 必须携带正确 token）
 * - 根据 message.type 分发：
 *   - canvas_action：调用 onAction，返回 canvas_response
 *   - html_widget_error：调用 onError
 *
 * @param _widgetId widget 标识（保留参数，供调用方语义对齐；当前未使用）
 * @param token 防伪 token
 * @param onAction action 处理函数
 * @param onError 错误处理函数
 * @param getExpectedSource 可选，返回期望的 message source（iframe contentWindow）
 */
export function createMessageHandler(
  _widgetId: string,
  token: string,
  onAction: (action: string, params: Record<string, unknown>) => Promise<unknown>,
  onError: (error: WidgetErrorInfo) => void,
  getExpectedSource?: () => Window | null,
): (event: MessageEvent) => void {
  return (event: MessageEvent) => {
    const data = event.data as CanvasMessage
    if (!data || typeof data !== 'object') return

    // 校验来源（必须是 iframe 的 contentWindow）
    if (getExpectedSource) {
      const expected = getExpectedSource()
      if (expected && event.source !== expected) return
    }

    // event.source 在 iframe 场景下为 Window
    const sourceWindow = event.source as Window | null

    if (data.type === 'canvas_action') {
      // 校验 token
      if (data.token !== token) return
      const requestId = data.requestId
      if (!requestId || typeof requestId !== 'string') return
      const action = typeof data.action === 'string' ? data.action : ''
      const params = data.params || {}

      // 异步处理，返回 canvas_response
      onAction(action, params)
        .then((result) => {
          sourceWindow?.postMessage(
            {
              type: 'canvas_response',
              requestId,
              success: true,
              data: result,
            },
            '*',
          )
        })
        .catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err)
          sourceWindow?.postMessage(
            {
              type: 'canvas_response',
              requestId,
              success: false,
              error: errMsg,
            },
            '*',
          )
        })
    } else if (data.type === 'html_widget_error') {
      const message = typeof data.message === 'string' ? data.message : '(unknown error)'
      const stack = typeof data.stack === 'string' ? data.stack : undefined
      const source = typeof data.source === 'string' ? data.source : 'runtime'
      onError({ message, stack, source })
    }
  }
}
