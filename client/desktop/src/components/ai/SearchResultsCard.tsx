import { useState } from 'react'
import type {
  SearchSourceEntry,
  LocalSearchHit,
  WebSearchHit,
  AcademicPaper,
  GithubRepoHit,
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
function isGithubHit(h: unknown): h is GithubRepoHit {
  // 加 'stargazersCount' in h 加强判别（GithubRepoHit 必有此字段）
  return typeof h === 'object' && h !== null && 'fullName' in h && 'htmlUrl' in h && 'stargazersCount' in h
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
        <ul className="search-results-list">
          {entry.hits.map((hit, idx) => (
            <SearchResultItem
              key={`${entry.id}-${idx}`}
              hit={hit}
              kind={entry.kind}
              onLocalClick={handleLocalClick}
              onExternalClick={handleExternalClick}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface SearchResultItemProps {
  hit: LocalSearchHit | WebSearchHit | AcademicPaper | GithubRepoHit
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
  if (kind === 'github' && isGithubHit(hit)) {
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
  return null
}
