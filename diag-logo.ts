import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'

// 读服务器 .env
const envText = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf-8')
const secret = envText.match(/^JWT_SECRET=(.+)$/m)?.[1]?.trim()
if (!secret) { console.log('NO SECRET'); process.exit(1) }

const token = jwt.sign(
  { authenticated: true, userId: 'fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6', role: 'member' },
  secret,
  { algorithm: 'HS256', expiresIn: '1h' },
)

const res = await fetch('http://127.0.0.1:3456/webos/api/bootstrap', {
  headers: { cookie: `access_token=${token}` },
})
const json = await res.json() as Record<string, unknown>
console.log('status:', res.status)
const logo = json.logo as { mime?: string; base64?: string } | null
console.log('logo:', logo ? `${logo.mime} len=${logo.base64?.length} head=${logo.base64?.slice(0, 40)}` : 'NULL')
const boot = json.boot as { html?: string | null; durationMs?: number } | null
console.log('boot:', boot ? `html=${boot.html ? boot.html.slice(0, 60) : 'null'} durationMs=${boot.durationMs}` : 'MISSING')
console.log('keys:', Object.keys(json).join(','))
