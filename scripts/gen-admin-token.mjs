// 生成站长账号 JWT（排查/验证用，1h 过期）——服务器上运行：cd /root/daily/server && node /tmp/gen-admin-token.mjs
import jwt from 'jsonwebtoken'
import fs from 'fs'
const envRaw = fs.readFileSync('/root/daily/server/.env', 'utf8')
const line = envRaw.split('\n').find((l) => l.startsWith('JWT_SECRET='))
if (!line) { console.error('JWT_SECRET not found'); process.exit(1) }
const secret = line.split('=').slice(1).join('=').trim()
const token = jwt.sign(
  { authenticated: true, sub: 'user:fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6', userId: 'fb9f2d90-a79c-4ab4-af3e-c3b13fb668d6', role: 'admin' },
  secret,
  { expiresIn: '1h' },
)
process.stdout.write(token)
