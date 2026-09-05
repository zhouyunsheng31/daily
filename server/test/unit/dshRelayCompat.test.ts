import { describe, it, expect } from 'vitest'
import { endpointRejectsDeveloperRole } from '../../src/piBridge.js'

describe('endpointRejectsDeveloperRole（dsh 中转接入 2026-09-05）', () => {
  it('火山 Ark / volces 域名 → true', () => {
    expect(endpointRejectsDeveloperRole('https://ark.cn-beijing.volces.com/api/plan/v3')).toBe(true)
    expect(endpointRejectsDeveloperRole('https://api.volcengine.com/v1')).toBe(true)
  })

  it('dsh 中转公网地址（154.219.108.99）→ true', () => {
    expect(endpointRejectsDeveloperRole('https://154.219.108.99:10443/dsh-relay/v1')).toBe(true)
  })

  it('其它 IP 字面量网关 → true（保守处理）', () => {
    expect(endpointRejectsDeveloperRole('https://10.0.0.5/v1')).toBe(true)
    expect(endpointRejectsDeveloperRole('https://192.168.1.10:8080/v1')).toBe(true)
  })

  it('已知支持 developer 角色的正规域名 → false', () => {
    expect(endpointRejectsDeveloperRole('https://opencode.ai/zen/go/v1')).toBe(false)
    expect(endpointRejectsDeveloperRole('https://api.deepseek.com/v1')).toBe(false)
    expect(endpointRejectsDeveloperRole('https://api.openai.com/v1')).toBe(false)
    expect(endpointRejectsDeveloperRole('https://api.stepfun.com/step_plan/v1')).toBe(false)
  })

  it('URL 解析失败 → false（不误伤）', () => {
    expect(endpointRejectsDeveloperRole('not-a-url')).toBe(false)
    expect(endpointRejectsDeveloperRole('')).toBe(false)
  })
})
