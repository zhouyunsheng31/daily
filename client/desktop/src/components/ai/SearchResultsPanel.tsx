import { useAIStore } from '../../stores/useAIStore'
import { SearchResultsCard } from './SearchResultsCard'

export function SearchResultsPanel() {
  const searchResults = useAIStore((s) => s.searchResults)
  const clearSearchResults = useAIStore((s) => s.clearSearchResults)

  if (searchResults.length === 0) return null

  return (
    <div className="search-results-panel">
      <div className="search-results-panel-header">
        <span className="search-results-panel-title">搜索结果</span>
        <button className="search-results-clear-btn" onClick={clearSearchResults}>清空</button>
      </div>
      <div className="search-results-panel-list">
        {searchResults.map((entry) => (
          <SearchResultsCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}
