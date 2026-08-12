/**
 * SitePreview 组件（Phase 5 T7 浏览器主页网站预览 + Phase 7 批次5 性能优化）
 *
 * Phase 5 基础功能：
 * - 使用 Electron <webview> 标签渲染网站缩略图预览
 * - partition="persist:preview"：所有预览共享一个 partition，减少内存
 * - pointer-events: none：预览不响应交互
 * - transform: scale(0.2)：800x600 → 160x120
 * - did-finish-load 后调用 webview.stop() 减少资源占用
 *
 * Phase 7 批次5 优化（Phase 15 批次5 复核）：
 * - IntersectionObserver 懒加载：进入视口才创建 webview
 * - webview 并发限制：通过 useWebviewPool 限制最多 3 个并发 webview（spec 7.1.1）
 * - 缩略图缓存：did-finish-load 后通过 IPC capturePage 截图，缓存到 localStorage（24h TTL）
 * - 有缓存时直接显示图片，不创建 webview（零成本渲染）
 * - 偏差说明：spec 7.1.1 要求 IDB 缓存，实际用 localStorage（同步读取避免首帧闪烁，已稳定）
 */
import { useRef, useEffect, useState, memo } from 'react'
import { Globe, Loader2 } from 'lucide-react'
import type { WebviewTag, DidFailLoadEvent } from '../types/electron'
import { useWebviewPool } from '../hooks/useWebviewPool'

interface SitePreviewProps {
  url: string
  title: string
  onClick: () => void
}

// ============ 缩略图缓存（localStorage，24h TTL） ============

const THUMBNAIL_CACHE_PREFIX = 'ld_thumb_'
const THUMBNAIL_CACHE_TTL = 24 * 60 * 60 * 1000  // 24 小时

interface CachedThumbnail {
  dataUrl: string
  timestamp: number
}

/** 读取缓存的缩略图 dataURL，过期或不存在返回 null */
function getCachedThumbnail(url: string): string | null {
  try {
    const key = THUMBNAIL_CACHE_PREFIX + url
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedThumbnail
    if (Date.now() - cached.timestamp > THUMBNAIL_CACHE_TTL) {
      localStorage.removeItem(key)
      return null
    }
    return cached.dataUrl
  } catch {
    return null
  }
}

/** 写入缩略图缓存（localStorage 超限时静默失败） */
function setCachedThumbnail(url: string, dataUrl: string): void {
  try {
    const key = THUMBNAIL_CACHE_PREFIX + url
    const cached: CachedThumbnail = { dataUrl, timestamp: Date.now() }
    localStorage.setItem(key, JSON.stringify(cached))
  } catch (err) {
    // localStorage 超限或其他错误，静默忽略
    console.warn('[SitePreview] Failed to cache thumbnail:', err)
  }
}

// Phase 15 批次1 任务1.4：包 memo 避免父组件 BrowserHome 重渲染时 SitePreview 跟着重渲染
function SitePreview({ url, title, onClick }: SitePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<WebviewTag | null>(null)
  // 是否进入视口（IntersectionObserver 触发后置 true，不再重置）
  const [inViewport, setInViewport] = useState(false)
  // 是否已获取 webview pool 位置
  const [acquired, setAcquired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  // 缩略图缓存（初始化时同步读取，避免首帧闪烁）
  const [cachedThumb, setCachedThumb] = useState<string | null>(() => getCachedThumbnail(url))
  const { acquire, release } = useWebviewPool()
  // 用 ref 跟踪 acquired 状态，cleanup 时能正确判断是否需要 release
  const acquiredRef = useRef(false)

  // url 变化时重置状态并刷新缓存
  useEffect(() => {
    setCachedThumb(getCachedThumbnail(url))
    setLoading(true)
    setFailed(false)
    // 重置 acquired，强制重新获取 pool 位置（避免 url 变化后绕过并发限制）
    setAcquired(false)
  }, [url])

  // IntersectionObserver：进入视口才触发加载（rootMargin 100px 提前预加载）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setInViewport(true)
            observer.disconnect()
          }
        })
      },
      { rootMargin: '100px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 获取 webview pool 位置（进入视口 + 无缓存时才申请）
  useEffect(() => {
    if (!inViewport || cachedThumb) return

    let cancelled = false
    acquire().then(() => {
      if (cancelled) {
        // 已被取消（组件卸载或 cachedThumb 变化），立即释放刚获取的位置
        release()
        return
      }
      acquiredRef.current = true
      setAcquired(true)
    })

    return () => {
      cancelled = true
      if (acquiredRef.current) {
        release()
        acquiredRef.current = false
      }
    }
  }, [inViewport, cachedThumb, acquire, release])

  // webview 加载 + 截图缓存（进入视口 + 无缓存 + 已获取 pool 位置时执行）
  useEffect(() => {
    if (!inViewport || cachedThumb || !acquired) return

    const webview = webviewRef.current
    if (!webview) return

    setLoading(true)
    setFailed(false)

    let cancelled = false

    const onDidFinishLoad = async (): Promise<void> => {
      setLoading(false)
      try {
        webview.stop()
      } catch {
        // ignore
      }
      if (cancelled) return

      // 通过 IPC 调用主进程 capturePage 生成缩略图
      try {
        const webContentsId = webview.getWebContentsId()
        const dataUrl = await window.thumbnailApi?.capture(webContentsId)
        if (dataUrl && !cancelled) {
          setCachedThumbnail(url, dataUrl)
          setCachedThumb(dataUrl)
          // Phase 15 批次1 任务1.4：截图完成后 setAcquired(false) 触发 webview 卸载，
          // 释放 webview pool 位置（useEffect 2/3 的 cleanup 会 release + removeEventListener）
          setAcquired(false)
        }
      } catch (err) {
        console.warn('[SitePreview] Failed to capture thumbnail:', err)
      }
    }

    const onDidFailLoad = (e: unknown): void => {
      const event = e as CustomEvent<DidFailLoadEvent>
      const detail = event.detail
      if (detail && detail.isMainFrame === false) return
      setLoading(false)
      setFailed(true)
    }

    webview.addEventListener('did-finish-load', onDidFinishLoad as EventListener)
    webview.addEventListener('did-fail-load', onDidFailLoad as EventListener)

    return () => {
      cancelled = true
      webview.removeEventListener('did-finish-load', onDidFinishLoad as EventListener)
      webview.removeEventListener('did-fail-load', onDidFailLoad as EventListener)
      try {
        webview.stop()
      } catch {
        // ignore
      }
    }
  }, [url, inViewport, cachedThumb, acquired])

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      style={{
        width: 160,
        height: 120,
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
        cursor: 'pointer',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'
      }}
    >
      {/* 有缓存：直接显示图片（零成本渲染，不创建 webview） */}
      {cachedThumb && (
        <img
          src={cachedThumb}
          alt={title}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      )}
      {/* 无缓存 + 进入视口 + 已获取 pool 位置：渲染 webview 加载并截图 */}
      {!cachedThumb && inViewport && acquired && (
        <webview
          ref={webviewRef}
          src={url}
          partition="persist:preview"
          webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
          style={{
            width: 800,
            height: 600,
            transform: 'scale(0.2)',
            transformOrigin: 'top left',
            pointerEvents: 'none',
            border: 'none',
            display: 'block',
          }}
        />
      )}
      {/* 加载中遮罩（无缓存 + 未完成加载时显示） */}
      {loading && !failed && !cachedThumb && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-surface)',
            color: 'var(--text-tertiary)',
          }}
        >
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}
      {/* 加载失败遮罩 */}
      {failed && !cachedThumb && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-surface)',
            color: 'var(--text-tertiary)',
          }}
        >
          <Globe size={24} />
        </div>
      )}
      {/* 底部 label */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          color: '#fff',
          fontSize: 11,
          padding: '2px 6px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </div>
    </div>
  )
}

// Phase 15 批次1 任务1.4：memo 包裹，避免父组件重渲染时 SitePreview 跟着重渲染
export default memo(SitePreview)
