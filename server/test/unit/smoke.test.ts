import { describe, it, expect } from 'vitest'

describe('test infrastructure smoke', () => {
  it('vitest works', () => {
    expect(1 + 1).toBe(2)
  })

  it('env is set to test', () => {
    expect(process.env.NODE_ENV).toBe('test')
    expect(process.env.DB_DRIVER).toBe('sqlite')
    expect(process.env.SERVER_TOKEN).toBe('test-token')
  })
})
