// ============================================================================
// Phase S10：GitHub 代理下载端点（spec 2.x 节）
// 端点：GET /api/github/proxy
// 作用：在服务器端注入 GitHub token，流式转发文件/资产/zip 归档给客户端
// 使得内地无梯子用户也能下载 GitHub 资源
// ============================================================================

import { Router, type Request, type Response } from 'express'
import { getSearchKey } from '../db/aiSettingsStore.js'
import { logApiUsage } from '../db/apiUsageLog.js'
import { extractFileName } from '../utils/searchApi.js'

export const githubProxyRouter = Router()
// 鉴权说明：`/api` 路由组在 `index.ts` L83 已全局应用 `authMiddleware`，
// 子路由 `/api/github/proxy` 自动继承，无需在 githubProxyRouter 内重复 use。
// 若需独立测试 githubProxyRouter，可在测试 setup 中单独 use(authMiddleware)。

const UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000  // 5 分钟无数据断开

githubProxyRouter.get('/', async (req: Request, res: Response) => {
  const { type, owner, repo, ref, path, sha, assetId, fileName } = req.query as Record<string, string>

  // 1. 参数校验
  if (!type || !owner || !repo) {
    res.status(400).json({ error: 'missing required params: type, owner, repo' })
    return
  }
  if (type === 'file' && !path && !sha) {
    res.status(400).json({ error: 'path or sha required for type=file' })
    return
  }
  if (type === 'asset' && !assetId) {
    res.status(400).json({ error: 'assetId required for type=asset' })
    return
  }

  // 2. 读 GitHub Key
  const key = await getSearchKey('github')
  if (!key) {
    res.status(500).json({ error: 'GitHub API Key not configured' })
    return
  }

  // 3. 构造上游 URL + headers
  let upstreamUrl: string
  let upstreamHeaders: Record<string, string>
  let needsBase64Decode = false  // sha 路径需要解码 base64

  if (type === 'zip') {
    const safeRef = ref || 'HEAD'
    upstreamUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${safeRef}`
    upstreamHeaders = {
      Authorization: `Bearer ${key}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'LivingDashboard-Server',
    }
  } else if (type === 'asset') {
    upstreamUrl = `https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`
    upstreamHeaders = {
      Authorization: `Bearer ${key}`,
      Accept: 'application/octet-stream',
      'User-Agent': 'LivingDashboard-Server',
    }
  } else {
    // type === 'file'
    if (sha) {
      // sha 路径走 git/blobs，返回 JSON {content: base64, encoding: 'base64'}
      // 服务器需解析 JSON + base64 解码 + 返回二进制
      upstreamUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`
      upstreamHeaders = {
        Authorization: `Bearer ${key}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'LivingDashboard-Server',
      }
      needsBase64Decode = true
    } else {
      // path 路径走 contents API，Accept: raw 直接拿二进制
      upstreamUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
      upstreamHeaders = {
        Authorization: `Bearer ${key}`,
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'LivingDashboard-Server',
      }
    }
  }

  // 4. 客户端中断检测 + 上游 fetch 超时
  const controller = new AbortController()
  let abortReason: 'client' | 'timeout' | null = null

  const onClientClose = () => {
    abortReason = 'client'
    controller.abort()
  }
  req.on('close', onClientClose)

  const timeout = setTimeout(() => {
    abortReason = 'timeout'
    controller.abort()
  }, UPSTREAM_TIMEOUT_MS)

  // 5. 发起上游请求（带 Range 透传）
  const rangeHeader = req.headers.range
  const upstreamHeadersWithRange: Record<string, string> = { ...upstreamHeaders }
  if (rangeHeader) upstreamHeadersWithRange['Range'] = rangeHeader

  let upstreamResp: globalThis.Response
  try {
    upstreamResp = await fetch(upstreamUrl, {
      method: 'GET',
      headers: upstreamHeadersWithRange,
      redirect: 'follow',
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeout)
    req.off('close', onClientClose)
    if (abortReason === 'client') return  // 客户端已断开，无需响应
    if (abortReason === 'timeout') {
      res.status(504).json({ error: 'upstream timeout (5min no data)' })
      return
    }
    res.status(504).json({ error: 'upstream network error', detail: String(err) })
    return
  }

  // 6. 上游错误处理（含 416 Range Not Satisfiable 透传）
  if (!upstreamResp.ok && upstreamResp.status !== 206 && upstreamResp.status !== 416) {
    const body = await upstreamResp.text().catch(() => '')
    clearTimeout(timeout)
    req.off('close', onClientClose)
    res.status(502).json({
      error: `GitHub upstream ${upstreamResp.status}`,
      body,
    })
    return
  }

  // 7. 透传响应头
  const contentType = needsBase64Decode
    ? 'application/octet-stream'  // sha 路径强制二进制（上游是 JSON，但我们要返回解码后的二进制）
    : (upstreamResp.headers.get('content-type') ?? 'application/octet-stream')
  const contentLength = needsBase64Decode
    ? undefined  // sha 路径解码后大小变化，不透传原 Content-Length
    : (upstreamResp.headers.get('content-length') ?? undefined)
  const contentRange = upstreamResp.headers.get('content-range') ?? undefined
  const contentDisposition = fileName
    ? `attachment; filename="${fileName}"`
    : (upstreamResp.headers.get('content-disposition') ?? `attachment; filename="${owner}-${repo}.bin"`)

  res.setHeader('Content-Type', contentType)
  if (contentLength) res.setHeader('Content-Length', contentLength)
  if (contentRange) res.setHeader('Content-Range', contentRange)
  res.setHeader('Content-Disposition', contentDisposition)
  res.status(upstreamResp.status === 206 ? 206 : (upstreamResp.status === 416 ? 416 : 200))

  // 8. 流式转发 body（sha 路径需先读 JSON 再 base64 解码）
  try {
    if (needsBase64Decode) {
      // sha 路径：读完整 JSON → 解析 → base64 解码 → 返回二进制
      const jsonBody = await upstreamResp.json() as { content?: string; encoding?: string }
      if (jsonBody.encoding === 'base64' && jsonBody.content) {
        const binaryBuffer = Buffer.from(jsonBody.content, 'base64')
        res.end(binaryBuffer)
      } else {
        res.status(502).end(JSON.stringify({ error: 'unexpected blob response format' }))
      }
    } else if (upstreamResp.body) {
      // 直接流式 pipe
      const reader = (upstreamResp.body as ReadableStream<Uint8Array>).getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (req.aborted) {
          controller.abort()
          break
        }
        res.write(value)
      }
    }
    res.end()
  } catch (err: unknown) {
    // 客户端中断或写入失败，主动 abort 上游
    controller.abort()
    if (err instanceof Error && err.name === 'AbortError') {
      // 已在上方 onClientClose / setTimeout 处理，仅需关闭连接
      try { res.end() } catch {}
      return
    }
    // 非 AbortError：未发送 headers 时返回 500，已发送则直接 end
    if (!res.headersSent) {
      res.status(500).json({ error: `代理失败: ${(err as Error).message}` })
    } else {
      try { res.end() } catch {}
    }
  } finally {
    clearTimeout(timeout)
    req.off('close', onClientClose)
    // 记录调用日志
    const status = res.statusCode && res.statusCode < 400 ? 'ok' : 'error'
    logApiUsage({
      provider: 'github_proxy',
      endpoint: `${type}:${owner}/${repo}`,
      status,
    }).catch(() => {})
  }
})
