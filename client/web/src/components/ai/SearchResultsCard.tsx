import { useState } from 'react'
import type {
  SearchSourceEntry,
  LocalSearchHit,
  WebSearchHit,
  AcademicPaper,
  GithubRepoHit,
  GithubCodeHit,
  GithubUserHit,
  GithubIssueHit,
  GithubDownloadResult,
} from '../../types/ai'
import { useAppStore } from '../../stores/useAppStore'

interface Props {
  entry: SearchSourceEntry
}

const KIND_LABELS: Record<SearchSourceEntry['kind'], string> = {
  local: '本地',
  web: '网页',
  academic: '论文',
  github: 'GitHub',
}

// 类型守卫
function isLocalHit(h: unknown): h is LocalSearchHit {
  return typeof h === 'object' && h !== null && 'type' in h && 'score' in h
}
function isWebHit(h: unknown): h is WebSearchHit {
  // 加 !('score' in h) 排除 LocalSearchHit（防止未来 LocalSearchHit 扩展 url 字段时误判）
  return typeof h === 'object' && h !== null && 'url' in h && 'snippet' in h && !('paperId' in h) && !('score' in h)
}
function isAcademicHit(h: unknown): h is AcademicPaper {
  return typeof h === 'object' && h !== null && 'paperId' in h && 'abstract' in h
}
function isGithubRepoHit(h: unknown): h is GithubRepoHit {
  // 加 'stargazersCount' in h 加强判别（GithubRepoHit 必有此字段）
  return typeof h === 'object' && h !== null && 'fullName' in h && 'htmlUrl' in h && 'stargazersCount' in h
}
// S14.2-T6：新增 GitHub 子类型守卫
// S14 修复：字段名 repository → repo，与 server 返回对齐
function isGithubCodeHit(h: unknown): h is GithubCodeHit {
  return typeof h === 'object' && h !== null && 'name' in h && 'path' in h && 'repo' in h
}
function isGithubUserHit(h: unknown): h is GithubUserHit {
  return typeof h === 'object' && h !== null && 'login' in h && 'avatarUrl' in h
}
function isGithubIssueHit(h: unknown): h is GithubIssueHit {
  return typeof h === 'object' && h !== null && 'number' in h && 'title' in h && 'state' in h
}

// S14.2-T6：判断是否为 download mode
function isDownloadMode(mode: string | undefined): mode is GithubDownloadResult['mode'] {
  return mode === 'download_repo_zip' || mode === 'download_release' || mode === 'download_file'
}

export function SearchResultsCard({ entry }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const setActivePanel = useAppStore((s) => s.setActivePanel)

  const handleLocalClick = (hit: LocalSearchHit) => {
    if (hit.panelId) {
      void setActivePanel(hit.panelId)
    }
  }

  const handleExternalClick = (url: string) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  // S14.2-T6：github kind + download mode → 渲染下载链接（不渲染 hits 列表）
  const isGithubDownload = entry.kind === 'github' && isDownloadMode(entry.mode) && entry.download

  return (
    <div className="search-results-card" data-kind={entry.kind}>
      <header
        className="search-results-header"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
      >
        <span className="search-results-kind">{KIND_LABELS[entry.kind]}</span>
        <span className="search-results-query">"{entry.query}"</span>
        <span className="search-results-count">{entry.hits.length} 条</span>
        {entry.tookMs != null && <span className="search-results-took">{entry.tookMs}ms</span>}
        <span className="search-results-toggle">{collapsed ? '▶' : '▼'}</span>
      </header>
      {!collapsed && (
        isGithubDownload ? (
          <GithubDownloadContent download={entry.download!} onExternalClick={handleExternalClick} />
        ) : (
          <ul className="search-results-list">
            {/* S14 修复：防御性 fallback，优先用 items 字段（spec L829 要求） */}
            {(entry.items ?? entry.hits).map((hit, idx) => (
              <SearchResultItem
                key={`${entry.id}-${idx}`}
                hit={hit}
                kind={entry.kind}
                onLocalClick={handleLocalClick}
                onExternalClick={handleExternalClick}
              />
            ))}
          </ul>
        )
      )}
    </div>
  )
}

// S14.2-T6：GitHub download mode 渲染组件
function GithubDownloadContent({ download, onExternalClick }: {
  download: GithubDownloadResult
  onExternalClick: (url: string) => void
}) {
  return (
    <div className="search-results-list" style={{ padding: '8px 12px' }}>
      <div
        className="search-result-item"
        onClick={() => onExternalClick(download.downloadUrl)}
        style={{ cursor: 'pointer' }}
      >
        <div className="search-result-title">
          下载：{download.fileName || download.mode}
        </div>
        <div className="search-result-meta">
          <span>（{download.size} bytes）</span>
          {download.owner && download.repo && (
            <span>{download.owner}/{download.repo}</span>
          )}
          {download.ref && <span>ref: {download.ref}</span>}
          {download.path && <span>path: {download.path}</span>}
        </div>
      </div>
    </div>
  )
}

interface SearchResultItemProps {
  hit: LocalSearchHit | WebSearchHit | AcademicPaper | GithubRepoHit | GithubCodeHit | GithubUserHit | GithubIssueHit | GithubDownloadResult
  kind: SearchSourceEntry['kind']
  onLocalClick: (hit: LocalSearchHit) => void
  onExternalClick: (url: string) => void
}

function SearchResultItem({ hit, kind, onLocalClick, onExternalClick }: SearchResultItemProps) {
  if (kind === 'local' && isLocalHit(hit)) {
    return (
      <li className="search-result-item" onClick={() => onLocalClick(hit)}>
        <div className="search-result-title">{hit.title}</div>
        <div className="search-result-snippet">{hit.snippet}</div>
        <div className="search-result-meta">
          <span>{hit.type}</span>
          {hit.panelId && <span>面板: {hit.panelId}</span>}
          <span>评分: {hit.score}</span>
        </div>
      </li>
    )
  }
  if (kind === 'web' && isWebHit(hit)) {
    return (
      <li className="search-result-item" onClick={() => onExternalClick(hit.url)}>
        <div className="search-result-title">{hit.title}</div>
        <div className="search-result-snippet">{hit.snippet}</div>
        <div className="search-result-meta">
          {hit.siteName && <span>{hit.siteName}</span>}
          <span>{hit.url}</span>
        </div>
      </li>
    )
  }
  if (kind === 'academic' && isAcademicHit(hit)) {
    return (
      <li className="search-result-item" onClick={() => hit.openAccessPdf?.url && onExternalClick(hit.openAccessPdf.url)}>
        <div className="search-result-title">{hit.title}</div>
        <div className="search-result-snippet">{hit.abstract.slice(0, 200)}</div>
        <div className="search-result-meta">
          <span>{hit.authors.join(', ')}</span>
          <span>{hit.year}</span>
          {hit.venue && <span>{hit.venue}</span>}
          <span>引用: {hit.citationCount}</span>
        </div>
      </li>
    )
  }
  // S14.2-T6：github kind 按 hit 类型分流渲染
  if (kind === 'github') {
    if (isGithubRepoHit(hit)) {
      return (
        <li className="search-result-item" onClick={() => onExternalClick(hit.htmlUrl)}>
          <div className="search-result-title">{hit.fullName}</div>
          <div className="search-result-snippet">{hit.description}</div>
          <div className="search-result-meta">
            <span>★ {hit.stargazersCount}</span>
            <span>🍴 {hit.forksCount}</span>
            {hit.language && <span>{hit.language}</span>}
          </div>
        </li>
      )
    }
    if (isGithubCodeHit(hit)) {
      return (
        <li className="search-result-item" onClick={() => onExternalClick(hit.htmlUrl)}>
          <div className="search-result-title">{hit.name}</div>
          <div className="search-result-snippet">{hit.path}</div>
          <div className="search-result-meta">
            <span>{hit.repo.fullName}</span>
            {hit.score != null && <span>评分: {hit.score}</span>}
          </div>
        </li>
      )
    }
    if (isGithubUserHit(hit)) {
      return (
        <li className="search-result-item" onClick={() => onExternalClick(hit.htmlUrl)}>
          <div className="search-result-title">{hit.login}</div>
          {hit.bio && <div className="search-result-snippet">{hit.bio}</div>}
          <div className="search-result-meta">
            <span>{hit.type}</span>
            {hit.publicRepos != null && <span>repos: {hit.publicRepos}</span>}
            {hit.followers != null && <span>followers: {hit.followers}</span>}
          </div>
        </li>
      )
    }
    if (isGithubIssueHit(hit)) {
      return (
        <li className="search-result-item" onClick={() => onExternalClick(hit.htmlUrl)}>
          <div className="search-result-title">#{hit.number} {hit.title}</div>
          <div className="search-result-meta">
            <span>{hit.state}</span>
            <span>{hit.repo.fullName}</span>
            <span>创建: {new Date(hit.createdAt).toLocaleDateString()}</span>
            <span>更新: {new Date(hit.updatedAt).toLocaleDateString()}</span>
          </div>
        </li>
      )
    }
  }
  return null
}
