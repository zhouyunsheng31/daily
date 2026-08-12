/**
 * BrowserHome 组件（Phase 4 任务 5.3 浏览器主页）
 *
 * 内容：
 * - 搜索框（输入网址或搜索，回车导航）
 * - Logo/书签一体区域
 * - 常用网站网格（书签标记"显示在主页"，可预览）
 *   - Phase 4 先做图标形式，预览功能 Phase 5 做
 *   - + 添加常用网站按钮
 * - 书签入口
 *
 * 数据来源：useAppStore.bookmarks（showOnHome=true 的书签显示在主页网格）
 *
 * Phase 15 批次1 任务1.4：输入卡顿辅助优化
 * - SearchBox / BookmarkCard / BookmarkIcon / BookmarkRow 抽为 memo 子组件，避免输入时整体重渲染
 * - homeBookmarks 用 useMemo，避免 bookmarks 引用变化但内容不变时重复计算
 * - 不变 style 抽到文件顶部 const，避免每次渲染重建对象
 */
import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react'
import { Search, Plus, Star, Globe, X, Bookmark as BookmarkIcon, LayoutGrid, Eye, Settings } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { useToastStore } from '../stores/useToastStore'
import { isUrl, normalizeUrl, buildSearchUrl } from '../utils/browserToolBridge'
import SitePreview from './SitePreview'
import LdLogo from './LdLogo'
import type { SearchEngine } from '../types'

interface BrowserHomeProps {
  /** 关联的网页标签 ID（用于导航时更新标签 URL） */
  tabId?: string
}

// ============ Phase 15 批次1 任务1.4：不变的 style 常量 ============

const browserHomeStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '48px 24px 24px',
  background: 'var(--bg-canvas)',
  position: 'relative',
}

const settingsBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 32,
  height: 32,
  borderRadius: 6,
  border: 'none',
  background: 'rgba(0,0,0,0.04)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
}

const logoWrapperStyle: React.CSSProperties = {
  marginBottom: 32,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
}

const logoImgStyle: React.CSSProperties = {
  width: 72,
  height: 72,
  borderRadius: '50%',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const logoTextStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: 13,
}

const searchContainerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 640,
  marginBottom: 32,
  position: 'relative',
}

const searchIconStyle: React.CSSProperties = {
  position: 'absolute',
  left: 16,
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--text-tertiary)',
}

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 16px 14px 44px',
  borderRadius: 'var(--radius-full)',
  border: 'none',
  background: 'rgba(0,0,0,0.04)',
  color: 'var(--text-primary)',
  fontSize: 14,
  outline: 'none',
  transition: 'background 0.15s',
}

const shortcutsContainerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 800,
  marginBottom: 32,
}

const shortcutsHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 12,
}

const shortcutsHeaderLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-secondary)',
}

const shortcutsHeaderButtonsStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const previewToggleBtnBaseStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
}

const addBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 6,
  border: 'none',
  background: 'rgba(0,0,0,0.04)',
  color: 'var(--text-secondary)',
  fontSize: 12,
  cursor: 'pointer',
}

const addDialogStyle: React.CSSProperties = {
  padding: 12,
  marginBottom: 12,
  borderRadius: 8,
  border: 'none',
  background: 'rgba(0,0,0,0.03)',
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
}

const addDialogInputStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 4,
  border: 'none',
  background: 'rgba(0,0,0,0.04)',
  color: 'var(--text-primary)',
  fontSize: 12,
  outline: 'none',
}

const addDialogSubmitBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 4,
  border: 'none',
  background: 'var(--color-primary)',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
}

const bookmarkCardWrapperStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  justifyContent: 'center',
}

const bookmarkRemoveBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 4,
  width: 18,
  height: 18,
  borderRadius: '50%',
  border: 'none',
  background: 'var(--bg-elevated)',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  opacity: 0,
  transition: 'opacity 0.15s',
  zIndex: 2,
}

const bookmarkIconCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '12px 8px',
  borderRadius: 12,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  transition: 'background 0.15s',
  position: 'relative',
}

const bookmarkIconWrapperStyle: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: '50%',
  background: 'rgba(255,255,255,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--color-primary)',
  transition: 'background 0.15s',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
}

const bookmarkTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  textAlign: 'center',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
}

const bookmarkRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'transparent',
  cursor: 'pointer',
  transition: 'all 0.15s',
}

const bookmarkRowTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-secondary)',
  flex: 1,
}

const bookmarkRowUrlStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-tertiary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 240,
}

const bookmarkRowToggleBtnStyle: React.CSSProperties = {
  padding: '2px 6px',
  borderRadius: 4,
  border: 'none',
  background: 'rgba(0,0,0,0.04)',
  color: 'var(--text-tertiary)',
  fontSize: 10,
  cursor: 'pointer',
}

const bookmarksListContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const emptyHomeBookmarksStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  padding: 24,
  textAlign: 'center',
  color: 'var(--text-tertiary)',
  fontSize: 12,
}

const emptyAllBookmarksStyle: React.CSSProperties = {
  padding: 16,
  textAlign: 'center',
  color: 'var(--text-tertiary)',
  fontSize: 12,
}

const bookmarksEntryContainerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 800,
}

const bookmarksEntryHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 12,
}

const bookmarksEntryLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-secondary)',
}

// ============ Phase 15 批次1 任务1.4：memo 子组件 ============

// ============ Phase 15 批次1 任务1.5：Favicon 自动加载 ============

const FAVICON_CACHE_PREFIX = 'ld_favicon_'
const FAVICON_CACHE_TTL = 7 * 24 * 60 * 60 * 1000  // 7 天

interface CachedFavicon {
  /** favicon URL（Google s2）；null 表示加载失败，应 fallback 到 Globe */
  url: string | null
  timestamp: number
}

/** 读取缓存的 favicon URL，过期或不存在返回 undefined（未缓存） */
function getCachedFavicon(domain: string): CachedFavicon | undefined {
  try {
    const key = FAVICON_CACHE_PREFIX + domain
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const cached = JSON.parse(raw) as CachedFavicon
    if (Date.now() - cached.timestamp > FAVICON_CACHE_TTL) {
      localStorage.removeItem(key)
      return undefined
    }
    return cached
  } catch {
    return undefined
  }
}

/** 写入 favicon 缓存（localStorage 超限时静默失败） */
function setCachedFavicon(domain: string, url: string | null): void {
  try {
    const key = FAVICON_CACHE_PREFIX + domain
    const cached: CachedFavicon = { url, timestamp: Date.now() }
    localStorage.setItem(key, JSON.stringify(cached))
  } catch (err) {
    console.warn('[Favicon] Failed to cache:', err)
  }
}

/** 从 URL 提取 domain（用于构建 Google s2 favicon URL） */
function extractDomain(url: string): string | null {
  try {
    // 用 normalizeUrl 确保 URL 有协议头，new URL 才能解析
    const normalized = normalizeUrl(url)
    if (normalized === 'about:blank') return null
    const u = new URL(normalized)
    return u.hostname || null
  } catch {
    return null
  }
}

interface FaviconProps {
  url: string
  size?: number
}

/**
 * Favicon 组件：用 Google s2 favicon API 加载真实 favicon
 * - 缓存到 localStorage（7 天 TTL），避免重复请求
 * - 加载失败时 fallback 到 Globe 图标
 * - 包 memo 避免父组件重渲染时重复加载
 */
const Favicon = memo(function Favicon({ url, size = 28 }: FaviconProps) {
  const domain = extractDomain(url)
  const [faviconUrl, setFaviconUrl] = useState<string | null>(() => {
    if (!domain) return null
    const cached = getCachedFavicon(domain)
    return cached?.url ?? null
  })
  const [failed, setFailed] = useState<boolean>(() => {
    if (!domain) return true
    const cached = getCachedFavicon(domain)
    return cached?.url === null
  })

  useEffect(() => {
    if (!domain) {
      setFailed(true)
      return
    }
    const cached = getCachedFavicon(domain)
    if (cached) {
      setFaviconUrl(cached.url)
      setFailed(cached.url === null)
      return
    }
    // 未缓存：用 Google s2 favicon API 加载
    const googleS2Url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
    const img = new Image()
    img.onload = () => {
      setFaviconUrl(googleS2Url)
      setFailed(false)
      setCachedFavicon(domain, googleS2Url)
    }
    img.onerror = () => {
      setFailed(true)
      setCachedFavicon(domain, null)
    }
    img.src = googleS2Url
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [domain])

  if (failed || !faviconUrl) {
    return <Globe size={size} style={{ padding: 0 }} />
  }
  return (
    <img
      src={faviconUrl}
      alt=""
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
      }}
      onError={() => {
        setFailed(true)
        if (domain) setCachedFavicon(domain, null)
      }}
    />
  )
})

interface SearchBoxProps {
  isInitializing: boolean
  searchEngine: SearchEngine
  tabId?: string
  setActiveWebTab: (tabId: string) => void
  setMainView: (view: { type: 'web-tab'; tabId: string }) => void
}

/** 搜索框子组件：useState 局部化，输入时只重渲染 SearchBox，不重渲染 BrowserHome */
const SearchBox = memo(function SearchBox({
  isInitializing,
  searchEngine,
  tabId,
  setActiveWebTab,
  setMainView,
}: SearchBoxProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Phase 15 批次1 任务1.1：移除 autoFocus，改为 isInitializing 完成后聚焦
  useEffect(() => {
    if (!isInitializing) {
      inputRef.current?.focus()
    }
  }, [isInitializing])

  const handleSearch = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed) return

    let targetUrl: string
    if (isUrl(trimmed)) {
      targetUrl = normalizeUrl(trimmed)
    } else {
      // Phase 6.3：使用用户配置的搜索引擎
      targetUrl = buildSearchUrl(trimmed, searchEngine)
    }

    if (tabId) {
      // Phase 15 批次2 任务2.0：合并三次独立 set 为单次 setState，减少订阅组件重渲染次数
      useAppStore.setState({
        webTabs: useAppStore.getState().webTabs.map(t =>
          t.id === tabId ? { ...t, url: targetUrl, title: trimmed, updatedAt: Date.now() } : t
        ),
        activeWebTabId: tabId,
        mainView: { type: 'web-tab', tabId },
      })
    } else {
      const addWebTab = useAppStore.getState().addWebTab
      const newTabId = await addWebTab(targetUrl)
      setActiveWebTab(newTabId)
      setMainView({ type: 'web-tab', tabId: newTabId })
    }
    setValue('')
  }, [value, tabId, setActiveWebTab, setMainView, searchEngine])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSearch()
    }
  }

  return (
    <div className="browser-home__search" style={searchContainerStyle}>
      <Search size={18} style={searchIconStyle} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入网址或搜索..."
        style={searchInputStyle}
        onFocus={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.06)')}
        onBlur={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
      />
    </div>
  )
})

interface BookmarkCardProps {
  url: string
  title: string
  onClick: () => void
  onRemove: () => void
}

/** 预览模式下的书签卡片（含 SitePreview） */
const BookmarkCard = memo(function BookmarkCard({ url, title, onClick, onRemove }: BookmarkCardProps) {
  return (
    <div style={bookmarkCardWrapperStyle}>
      <SitePreview
        url={url}
        title={title}
        onClick={onClick}
      />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        title="移除"
        style={bookmarkRemoveBtnStyle}
        className="bookmark-remove-btn"
      >
        <X size={10} />
      </button>
    </div>
  )
})

interface BookmarkIconProps {
  url: string
  title: string
  onClick: () => void
  onRemove: () => void
}

/** 图标模式下的书签卡片（Phase 15 批次1 任务1.5：用真实 favicon 替换 Globe） */
const BookmarkIconCard = memo(function BookmarkIconCard({ url, title, onClick, onRemove }: BookmarkIconProps) {
  return (
    <div
      onClick={onClick}
      style={bookmarkIconCardStyle}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(0,0,0,0.03)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        title="移除"
        style={bookmarkRemoveBtnStyle}
        className="bookmark-remove-btn"
      >
        <X size={10} />
      </button>
      <div
        style={bookmarkIconWrapperStyle}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.8)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.6)'
        }}
      >
        <Favicon url={url} size={28} />
      </div>
      <span style={bookmarkTitleStyle}>
        {title}
      </span>
    </div>
  )
})

interface BookmarkRowProps {
  title: string
  url: string
  showOnHome: boolean
  onClick: () => void
  onToggleHome: () => void
}

/** 书签列表行（所有书签区域） */
const BookmarkRow = memo(function BookmarkRow({ title, url, showOnHome, onClick, onToggleHome }: BookmarkRowProps) {
  return (
    <div
      onClick={onClick}
      style={bookmarkRowStyle}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--bg-hover)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Star
        size={12}
        style={{
          color: showOnHome ? 'var(--color-warning)' : 'var(--text-tertiary)',
          fill: showOnHome ? 'var(--color-warning)' : 'none',
        }}
      />
      <span style={bookmarkRowTitleStyle}>
        {title}
      </span>
      <span style={bookmarkRowUrlStyle}>
        {url}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggleHome()
        }}
        title={showOnHome ? '从主页移除' : '显示在主页'}
        style={bookmarkRowToggleBtnStyle}
      >
        {showOnHome ? '主页' : '加入'}
      </button>
    </div>
  )
})

export default function BrowserHome({ tabId }: BrowserHomeProps) {
  // 订阅 store
  const bookmarks = useAppStore(s => s.bookmarks)
  const addBookmark = useAppStore(s => s.addBookmark)
  const removeBookmark = useAppStore(s => s.removeBookmark)
  const toggleBookmarkHome = useAppStore(s => s.toggleBookmarkHome)
  const updateWebTab = useAppStore(s => s.updateWebTab)
  const setMainView = useAppStore(s => s.setMainView)
  const setActiveWebTab = useAppStore(s => s.setActiveWebTab)
  // Phase 6.3：订阅搜索引擎设置
  const searchEngine = useAppStore(s => s.settings.behavior.searchEngine)
  // Phase 7 批次2 任务3: toast 反馈
  const showToast = useToastStore(s => s.showToast)
  const updateToast = useToastStore(s => s.updateToast)
  // Phase 15 批次1 任务1.1：订阅 isInitializing，传给 SearchBox 控制聚焦时机
  const isInitializing = useAppStore(s => s.isInitializing)

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [previewMode, setPreviewMode] = useState(false)

  // Phase 15 批次2 任务2.0：预连接搜索引擎域名，加速首次搜索/导航
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = 'https://www.bing.com'
    document.head.appendChild(link)
    return () => { document.head.removeChild(link) }
  }, [])

  // Phase 15 批次1 任务1.4：homeBookmarks 用 useMemo，避免 bookmarks 引用变化但内容不变时重复计算
  const homeBookmarks = useMemo(() => bookmarks.filter(b => b.showOnHome), [bookmarks])
  // 所有书签（用于书签入口区域显示）
  const allBookmarks = bookmarks

  // 点击书签导航
  const handleBookmarkClick = useCallback(async (url: string) => {
    if (tabId) {
      updateWebTab(tabId, { url, title: url })
      setActiveWebTab(tabId)
      setMainView({ type: 'web-tab', tabId })
    } else {
      const addWebTab = useAppStore.getState().addWebTab
      const newTabId = await addWebTab(url)
      setActiveWebTab(newTabId)
      setMainView({ type: 'web-tab', tabId: newTabId })
    }
  }, [tabId, updateWebTab, setActiveWebTab, setMainView])

  // 移除书签
  const handleRemoveBookmark = useCallback((bookmarkId: string) => {
    removeBookmark(bookmarkId).catch(console.error)
  }, [removeBookmark])

  // 切换书签主页显示
  const handleToggleBookmarkHome = useCallback((bookmarkId: string) => {
    toggleBookmarkHome(bookmarkId).catch(console.error)
  }, [toggleBookmarkHome])

  // 添加常用网站（Phase 7 批次2 任务3: 包裹 toast loading/success/error 反馈）
  const handleAddBookmark = useCallback(async () => {
    const url = newUrl.trim()
    const title = newTitle.trim() || url
    if (!url) return
    const toastId = showToast({ type: 'loading', message: '正在添加书签...' })
    try {
      await addBookmark(url, title)
      setNewUrl('')
      setNewTitle('')
      setShowAddDialog(false)
      updateToast(toastId, { type: 'success', message: '已添加书签', duration: 2000 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '添加书签失败'
      updateToast(toastId, { type: 'error', message: msg, duration: 4000 })
    }
  }, [newUrl, newTitle, addBookmark, showToast, updateToast])

  return (
    <div className="browser-home" style={browserHomeStyle}>
      {/* Phase 15 批次1 任务1.2：BrowserHome 设置入口（顶部右上角齿轮按钮） */}
      <button
        onClick={() => useAppStore.setState({ showSettings: true })}
        title="设置"
        style={settingsBtnStyle}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.08)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
      >
        <Settings size={18} />
      </button>

      {/* Logo 区域（Phase 7 批次1 任务2.6：用 LdLogo SVG 替换 img） */}
      <div className="browser-home__logo" style={logoWrapperStyle}>
        <div style={logoImgStyle}>
          <LdLogo size={72} />
        </div>
        <span style={logoTextStyle}>Daily</span>
      </div>

      {/* 搜索框（Phase 15 批次1 任务1.4：抽为 memo 子组件，输入时只重渲染 SearchBox） */}
      <SearchBox
        isInitializing={isInitializing}
        searchEngine={searchEngine}
        tabId={tabId}
        setActiveWebTab={setActiveWebTab}
        setMainView={setMainView}
      />

      {/* 常用网站网格 */}
      <div className="browser-home__shortcuts" style={shortcutsContainerStyle}>
        <div style={shortcutsHeaderStyle}>
          <span style={shortcutsHeaderLabelStyle}>常用网站</span>
          <div style={shortcutsHeaderButtonsStyle}>
            <button
              onClick={() => setPreviewMode(!previewMode)}
              title={previewMode ? '切换到图标模式' : '切换到预览模式'}
              style={{
                ...previewToggleBtnBaseStyle,
                background: previewMode ? 'var(--color-primary)' : 'rgba(0,0,0,0.04)',
                color: previewMode ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {previewMode ? <Eye size={14} /> : <LayoutGrid size={14} />}
            </button>
            <button
              onClick={() => setShowAddDialog(!showAddDialog)}
              style={addBtnStyle}
            >
              <Plus size={12} /> 添加
            </button>
          </div>
        </div>

        {/* 添加常用网站对话框 */}
        {showAddDialog && (
          <div style={addDialogStyle}>
            <input
              type="text"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder="网址（如 https://example.com）"
              style={{ ...addDialogInputStyle, flex: '1 1 200px' }}
            />
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="名称（可选）"
              style={{ ...addDialogInputStyle, flex: '1 1 120px' }}
            />
            <button onClick={handleAddBookmark} style={addDialogSubmitBtnStyle}>
              添加
            </button>
          </div>
        )}

        {/* 网格 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: previewMode
              ? 'repeat(auto-fill, minmax(160px, 1fr))'
              : 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 12,
          }}
        >
          {homeBookmarks.map((bookmark, index) => {
            // 预览模式下前 6 个用 SitePreview 渲染
            if (previewMode && index < 6) {
              return (
                <BookmarkCard
                  key={bookmark.id}
                  url={bookmark.url}
                  title={bookmark.title}
                  onClick={() => handleBookmarkClick(bookmark.url)}
                  onRemove={() => handleRemoveBookmark(bookmark.id)}
                />
              )
            }
            // 图标形式（图标模式 或 预览模式下超过 6 个的）
            return (
              <BookmarkIconCard
                key={bookmark.id}
                url={bookmark.url}
                title={bookmark.title}
                onClick={() => handleBookmarkClick(bookmark.url)}
                onRemove={() => handleRemoveBookmark(bookmark.id)}
              />
            )
          })}
          {homeBookmarks.length === 0 && (
            <div style={emptyHomeBookmarksStyle}>
              还没有常用网站，点击"添加"创建
            </div>
          )}
        </div>
      </div>

      {/* 书签入口（所有书签列表） */}
      <div className="browser-home__bookmarks" style={bookmarksEntryContainerStyle}>
        <div style={bookmarksEntryHeaderStyle}>
          <BookmarkIcon size={14} style={{ color: 'var(--text-secondary)' }} />
          <span style={bookmarksEntryLabelStyle}>书签</span>
        </div>
        <div style={bookmarksListContainerStyle}>
          {allBookmarks.map(bookmark => (
            <BookmarkRow
              key={bookmark.id}
              title={bookmark.title}
              url={bookmark.url}
              showOnHome={bookmark.showOnHome}
              onClick={() => handleBookmarkClick(bookmark.url)}
              onToggleHome={() => handleToggleBookmarkHome(bookmark.id)}
            />
          ))}
          {allBookmarks.length === 0 && (
            <div style={emptyAllBookmarksStyle}>还没有书签</div>
          )}
        </div>
      </div>
    </div>
  )
}
