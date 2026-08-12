import type { Response } from 'supertest'

export function expectOk(res: Response, status = 200): Response {
  if (res.status !== status) {
    throw new Error(`Expected status ${status}, got ${res.status}: ${JSON.stringify(res.body)}`)
  }
  return res
}

export function expectJson(res: Response, status = 200): Response {
  expectOk(res, status)
  if (!res.headers['content-type']?.includes('application/json')) {
    throw new Error(`Expected JSON, got ${res.headers['content-type']}`)
  }
  return res
}

export function expectError(res: Response, status: number, code?: string): Response {
  if (res.status !== status) {
    throw new Error(`Expected status ${status}, got ${res.status}: ${JSON.stringify(res.body)}`)
  }
  if (code && res.body?.code !== code) {
    throw new Error(`Expected code ${code}, got ${res.body?.code}: ${JSON.stringify(res.body)}`)
  }
  return res
}
