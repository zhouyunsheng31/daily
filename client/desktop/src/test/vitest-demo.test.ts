/**
 * Vitest 基础验证测试（Phase 11.1）
 *
 * 目的：验证 vitest + happy-dom + jest-dom matchers 全链路可用
 * 后续 P0 单元测试（Phase 11.2）会替换此 demo
 */
import { describe, it, expect } from 'vitest'

describe('vitest setup', () => {
  it('should run basic assertion', () => {
    expect(1 + 1).toBe(2)
  })

  it('should support happy-dom environment', () => {
    expect(document).toBeDefined()
    expect(window).toBeDefined()
  })

  it('should support jest-dom matchers', () => {
    const div = document.createElement('div')
    div.textContent = 'hello'
    document.body.appendChild(div)
    expect(div).toHaveTextContent('hello')
    expect(div).toBeInTheDocument()
  })
})
