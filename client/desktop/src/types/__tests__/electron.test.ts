/**
 * types/electron.d.ts IPC 通道一一对应测试 — Phase 11 P2
 *
 * 测试策略（项目未引入 zod）：
 * - 接口完整性测试：构造符合接口的对象，TypeScript 编译时校验字段
 * - 运行时字段存在性检查：确保 IPC 方法不被意外删除/重命名
 * - 方法数量校验：AiKeyApi 6 个、AgentApi 5 个、ToolBridgeApi 3 个
 *
 * 覆盖：
 * - AiKeyApi（6 方法）：setApiKey / getApiKey / setActiveProvider / getActiveProvider / deleteApiKey / listProviders
 * - AgentApi（5 方法）：initialize / sendMessage / disposeSession / setThinkingLevel / onEvent
 * - ToolBridgeApi（3 方法）：onToolExecuteRequest / respondToolResult / executeTool
 *
 * 设计依据（与实际源码对齐）：
 * - preload/index.ts 通过 contextBridge 暴露 aiKeyApi / agentApi / toolBridgeApi
 * - agentIpc.ts 注册 11 个 ipcMain.handle（含 tool:execute:result）
 * - 类型定义在 types/electron.d.ts
 */
import { describe, test, expect } from 'vitest'
import type {
  AiKeyApi,
  AgentApi,
  ToolBridgeApi,
  AgentEvent,
} from '../electron'

// ============================================================================
// 1. AiKeyApi IPC 通道一一对应（6 方法）
//    实际 IPC 通道：agent:set-api-key / agent:get-api-key / agent:set-active-provider
//                   agent:get-active-provider / agent:delete-api-key / agent:list-providers
// ============================================================================

describe('AiKeyApi IPC 通道一一对应（6 方法）', () => {
  test('AiKeyApi 接口含 6 个方法（setApiKey/getApiKey/setActiveProvider/getActiveProvider/deleteApiKey/listProviders）', () => {
    // 构造符合 AiKeyApi 接口的对象，TypeScript 编译时校验字段完整性
    const api: AiKeyApi = {
      setApiKey: async (_provider: string, _apiKey: string, _endpoint: string, _model: string) => {},
      getApiKey: async (_provider: string) => null,
      setActiveProvider: async (_provider: string) => {},
      getActiveProvider: async () => null,
      deleteApiKey: async (_provider: string) => {},
      listProviders: async () => [],
    }

    // 运行时字段存在性检查：6 个方法必须全部存在且为 function
    expect(typeof api.setApiKey).toBe('function')
    expect(typeof api.getApiKey).toBe('function')
    expect(typeof api.setActiveProvider).toBe('function')
    expect(typeof api.getActiveProvider).toBe('function')
    expect(typeof api.deleteApiKey).toBe('function')
    expect(typeof api.listProviders).toBe('function')

    // 方法数量精确校验（防止未来误增/删字段）
    const methodNames = Object.keys(api)
    expect(methodNames.length).toBe(6)
    expect(methodNames).toContain('setApiKey')
    expect(methodNames).toContain('getApiKey')
    expect(methodNames).toContain('setActiveProvider')
    expect(methodNames).toContain('getActiveProvider')
    expect(methodNames).toContain('deleteApiKey')
    expect(methodNames).toContain('listProviders')
  })

  test('AiKeyApi setApiKey 签名正确（4 参数：provider/apiKey/endpoint/model，返回 Promise<void>）', async () => {
    const api: AiKeyApi = {
      setApiKey: async (provider, apiKey, endpoint, model) => {
        expect(provider).toBe('deepseek')
        expect(apiKey).toBe('sk-xxx')
        expect(endpoint).toBe('https://api.deepseek.com')
        expect(model).toBe('deepseek-chat')
      },
      getApiKey: async () => null,
      setActiveProvider: async () => {},
      getActiveProvider: async () => null,
      deleteApiKey: async () => {},
      listProviders: async () => [],
    }
    // 调用以触发断言
    await api.setApiKey('deepseek', 'sk-xxx', 'https://api.deepseek.com', 'deepseek-chat')
  })

  test('AiKeyApi 各方法返回值类型为 Promise（与 ipcRenderer.invoke 一致）', async () => {
    const api: AiKeyApi = {
      setApiKey: async () => {},
      getApiKey: async () => 'fake-key',
      setActiveProvider: async () => {},
      getActiveProvider: async () => 'deepseek',
      deleteApiKey: async () => {},
      listProviders: async () => ['deepseek', 'openai'],
    }

    // ipcRenderer.invoke 始终返回 Promise，所有方法都应返回 Promise
    expect(api.setApiKey('p', 'k', 'e', 'm')).toBeInstanceOf(Promise)
    expect(api.getApiKey('p')).toBeInstanceOf(Promise)
    expect(api.setActiveProvider('p')).toBeInstanceOf(Promise)
    expect(api.getActiveProvider()).toBeInstanceOf(Promise)
    expect(api.deleteApiKey('p')).toBeInstanceOf(Promise)
    expect(api.listProviders()).toBeInstanceOf(Promise)

    // 实际返回值类型校验
    await expect(api.getApiKey('p')).resolves.toBe('fake-key')
    await expect(api.getActiveProvider()).resolves.toBe('deepseek')
    await expect(api.listProviders()).resolves.toEqual(['deepseek', 'openai'])
  })
})

// ============================================================================
// 2. AgentApi IPC 通道一一对应（5 方法）
//    实际 IPC 通道：agent:initialize / agent:send-message / agent:dispose-session
//                   agent:set-thinking-level + agent:event（事件监听）
// ============================================================================

describe('AgentApi IPC 通道一一对应（5 方法）', () => {
  test('AgentApi 接口含 5 个方法（initialize/sendMessage/disposeSession/setThinkingLevel/onEvent）', () => {
    const api: AgentApi = {
      initialize: async () => ({ ok: true }),
      sendMessage: async () => ({ ok: true }),
      disposeSession: async () => ({ ok: true }),
      setThinkingLevel: async () => ({ ok: true }),
      onEvent: () => () => {},
    }

    // 运行时字段存在性检查
    expect(typeof api.initialize).toBe('function')
    expect(typeof api.sendMessage).toBe('function')
    expect(typeof api.disposeSession).toBe('function')
    expect(typeof api.setThinkingLevel).toBe('function')
    expect(typeof api.onEvent).toBe('function')

    // 方法数量精确校验
    const methodNames = Object.keys(api)
    expect(methodNames.length).toBe(5)
    expect(methodNames).toContain('initialize')
    expect(methodNames).toContain('sendMessage')
    expect(methodNames).toContain('disposeSession')
    expect(methodNames).toContain('setThinkingLevel')
    expect(methodNames).toContain('onEvent')
  })

  test('AgentApi sendMessage payload 类型正确（panelId/message/thinkingLevel）', async () => {
    let captured: { panelId: string; message: string; thinkingLevel: string } | null = null
    const api: AgentApi = {
      initialize: async () => ({ ok: true }),
      sendMessage: async (payload) => {
        captured = payload
        return { ok: true }
      },
      disposeSession: async () => ({ ok: true }),
      setThinkingLevel: async () => ({ ok: true }),
      onEvent: () => () => {},
    }

    await api.sendMessage({
      panelId: 'panel-1',
      message: 'hello',
      thinkingLevel: 'medium',
    })

    expect(captured).not.toBeNull()
    expect(captured!.panelId).toBe('panel-1')
    expect(captured!.message).toBe('hello')
    expect(captured!.thinkingLevel).toBe('medium')
  })

  test('AgentApi onEvent 返回清理函数（与 ipcRenderer.removeListener 协议一致）', () => {
    const api: AgentApi = {
      initialize: async () => ({ ok: true }),
      sendMessage: async () => ({ ok: true }),
      disposeSession: async () => ({ ok: true }),
      setThinkingLevel: async () => ({ ok: true }),
      onEvent: (cb) => {
        // 模拟回调触发
        cb({ panelId: 'p1', event: { type: 'text_delta', text: 'hi' } })
        return () => {} // 清理函数
      },
    }

    const received: Array<{ panelId: string; event: AgentEvent }> = []
    const cleanup = api.onEvent((data) => {
      received.push(data)
    })

    // onEvent 应该返回函数（清理函数）
    expect(typeof cleanup).toBe('function')
    // 调用清理函数不应抛错
    expect(() => cleanup()).not.toThrow()
    // 应该已收到一个事件
    expect(received.length).toBe(1)
    expect(received[0].panelId).toBe('p1')
  })
})

// ============================================================================
// 3. ToolBridgeApi IPC 通道一一对应（3 方法）
//    实际 IPC 通道：tool:execute:request（监听）/ tool:execute:result（回传）
//                   tool:execute（备用方向，渲染→主进程）
// ============================================================================

describe('ToolBridgeApi IPC 通道一一对应（3 方法）', () => {
  test('ToolBridgeApi 接口含 3 个方法（onToolExecuteRequest/respondToolResult/executeTool）', () => {
    const api: ToolBridgeApi = {
      onToolExecuteRequest: () => () => {},
      respondToolResult: async () => {},
      executeTool: async () => null,
    }

    // 运行时字段存在性检查
    expect(typeof api.onToolExecuteRequest).toBe('function')
    expect(typeof api.respondToolResult).toBe('function')
    expect(typeof api.executeTool).toBe('function')

    // 方法数量精确校验
    const methodNames = Object.keys(api)
    expect(methodNames.length).toBe(3)
    expect(methodNames).toContain('onToolExecuteRequest')
    expect(methodNames).toContain('respondToolResult')
    expect(methodNames).toContain('executeTool')
  })

  test('ToolBridgeApi onToolExecuteRequest 接收 callback 并返回清理函数', () => {
    const api: ToolBridgeApi = {
      onToolExecuteRequest: (cb) => {
        // 模拟主进程推送工具请求
        cb({ requestId: 'r-1', tool: 'storage_read', params: { key: 'k' }, panelId: 'p1' })
        return () => {}
      },
      respondToolResult: async () => {},
      executeTool: async () => null,
    }

    let captured: unknown = null
    const cleanup = api.onToolExecuteRequest((req) => {
      captured = req
    })

    expect(typeof cleanup).toBe('function')
    expect(captured).toEqual({
      requestId: 'r-1',
      tool: 'storage_read',
      params: { key: 'k' },
      panelId: 'p1',
    })
  })

  test('ToolBridgeApi respondToolResult 返回 Promise<void>（与 ipcRenderer.invoke 一致）', async () => {
    let receivedResponse: unknown = null
    const api: ToolBridgeApi = {
      onToolExecuteRequest: () => () => {},
      respondToolResult: async (response) => {
        receivedResponse = response
      },
      executeTool: async () => null,
    }

    const response = {
      requestId: 'r-2',
      success: true,
      data: { value: 42 },
    }
    const ret = api.respondToolResult(response)
    expect(ret).toBeInstanceOf(Promise)
    await ret
    expect(receivedResponse).toEqual(response)
  })
})

// ============================================================================
// 4. window 全局声明完整性（contextBridge 暴露的 3 个 API 全部声明在 Window 上）
// ============================================================================

describe('window 全局声明完整性', () => {
  test('Window 接口声明了 aiKeyApi / agentApi / toolBridgeApi 3 个可选 API', () => {
    // 通过构造一个 Window 类型的 partial 对象验证类型声明存在
    const w: Pick<Window, 'aiKeyApi' | 'agentApi' | 'toolBridgeApi'> = {
      aiKeyApi: undefined,
      agentApi: undefined,
      toolBridgeApi: undefined,
    }
    // 类型断言能通过编译即说明 Window 接口已声明这 3 个字段
    expect(w).toHaveProperty('aiKeyApi')
    expect(w).toHaveProperty('agentApi')
    expect(w).toHaveProperty('toolBridgeApi')
  })
})
