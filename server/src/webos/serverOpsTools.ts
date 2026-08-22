// server/src/webos/serverOpsTools.ts —— 云服务器远程运维与微信通道管理工具集
// ----------------------------------------------------------------------------
// 职责：为 Daily AI 注入直接操作远程云服务器 (154.219.108.99) 的工具链：
//   1. remote_server_exec: 远程执行任意 Shell 命令
//   2. remote_server_get_wechat_qr: 毫秒级抓取 OpenClaw 微信绑定的最新二维码图片与链接
//   3. remote_server_status: 获取内存、磁盘、OpenClaw 通道实时健康状态
// ============================================================================

import { Type } from 'typebox'
import { spawn } from 'node:child_process'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

const SERVER_HOST = '154.219.108.99'
const SERVER_PORT = 22
const SERVER_USER = 'root'
const SERVER_PWD = 'hD5eOaCQ3PZl'

/** 通过 python paramiko 执行远程 SSH 命令并收集结果 */
function executeSshCommand(cmd: string, timeoutSec: number = 30): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const pyScript = `
import paramiko
import sys

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    ssh.connect('${SERVER_HOST}', port=${SERVER_PORT}, username='${SERVER_USER}', password='${SERVER_PWD}', timeout=10)
    stdin, stdout, stderr = ssh.exec_command('''${cmd.replace(/'''/g, "\\'\\'\\'")}''', timeout=${timeoutSec})
    out = stdout.read().decode('utf-8', errors='ignore')
    err = stderr.read().decode('utf-8', errors='ignore')
    sys.stdout.write(out)
    sys.stderr.write(err)
    exit_code = stdout.channel.recv_exit_status()
    ssh.close()
    sys.exit(exit_code)
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`
    const proc = spawn('python3', ['-c', pyScript])
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch {}
      resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', exitCode: -1 })
    }, (timeoutSec + 12) * 1000)

    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code ?? 0 })
    })
  })
}

/** 毫秒级抓取 OpenClaw 微信绑定的最新二维码 */
function fetchWechatQr(): Promise<{ ok: boolean; url?: string; qrImageUrl?: string; raw?: string; error?: string }> {
  return new Promise((resolve) => {
    const pyScript = `
import paramiko
import time
import re
import urllib.parse
import json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    ssh.connect('${SERVER_HOST}', port=${SERVER_PORT}, username='${SERVER_USER}', password='${SERVER_PWD}', timeout=10)
    chan = ssh.invoke_shell(width=120, height=50)
    chan.send("openclaw channels login --channel openclaw-weixin\\n")

    found_url = None
    start = time.time()
    while time.time() - start < 18:
        time.sleep(0.5)
        out = ''
        while chan.recv_ready():
            out += chan.recv(4096).decode('utf-8', errors='ignore')
        m = re.search(r'(https://liteapp\\\\.weixin\\\\.qq\\\\.com/q/[^\\\\s\\\\n\\\\r]+)', out)
        if m:
            found_url = m.group(1)
            break

    ssh.close()
    if found_url:
        encoded = urllib.parse.quote(found_url)
        img_url = f"https://api.qrserver.com/v1/create-qr-code/?size=350x350&data={encoded}"
        print(json.dumps({"ok": True, "url": found_url, "qrImageUrl": img_url}))
    else:
        print(json.dumps({"ok": False, "error": "NO_QR_IN_OUTPUT", "raw": out}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`
    const proc = spawn('python3', ['-c', pyScript])
    let stdout = ''
    proc.stdout.on('data', (d) => { stdout += d.toString() })

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch {}
      resolve({ ok: false, error: 'TIMEOUT_FETCHING_QR' })
    }, 25000)

    proc.on('close', () => {
      clearTimeout(timer)
      try {
        const res = JSON.parse(stdout.trim())
        resolve(res)
      } catch (e) {
        resolve({ ok: false, error: 'PARSE_FAILED', raw: stdout })
      }
    })
  })
}

export function createServerOpsTools(): ToolDefinition[] {
  return [
    {
      name: 'remote_server_exec',
      label: '云服务器命令执行',
      description: '在远程 Linux 云服务器 (154.219.108.99) 上执行指定 Shell 命令并返回结果。可用于管理 Docker、Git 同步、运行脚本、查看进程与系统日志。',
      parameters: Type.Object({
        command: Type.String({ description: '要在服务器上执行的 Shell 命令（如: openclaw channels status, git pull, docker ps 等）' }),
        timeout_seconds: Type.Optional(Type.Number({ description: '超时秒数，默认 30 秒' })),
      }),
      execute: async (_toolCallId: string, params: { command: string; timeout_seconds?: number }) => {
        try {
          const res = await executeSshCommand(params.command, params.timeout_seconds ?? 30)
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: res.exitCode === 0, ...res }) }],
            details: {},
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }) }],
            details: {},
            isError: true,
          }
        }
      },
    },
    {
      name: 'remote_server_get_wechat_qr',
      label: '获取微信绑定二维码',
      description: '向云服务器的 OpenClaw 发送绑定请求，毫秒级抓取全新的微信扫码绑定 URL 与二维码图片。拿到后请立即渲染给用户供其在 40 秒内扫码绑定。',
      parameters: Type.Object({}),
      execute: async () => {
        try {
          const res = await fetchWechatQr()
          return {
            content: [{ type: 'text', text: JSON.stringify(res) }],
            details: {},
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) }],
            details: {},
            isError: true,
          }
        }
      },
    },
    {
      name: 'remote_server_status',
      label: '云服务器运行状态',
      description: '获取云服务器 (154.219.108.99) 的内存使用率、Swap、数据盘容量、OpenClaw 网关及微信通道当前连接健康状态。',
      parameters: Type.Object({}),
      execute: async () => {
        try {
          const res = await executeSshCommand('free -h && df -h /data && openclaw channels status', 15)
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: res.exitCode === 0, output: res.stdout, error: res.stderr }) }],
            details: {},
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }) }],
            details: {},
            isError: true,
          }
        }
      },
    },
  ]
}
