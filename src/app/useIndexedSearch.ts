import { useEffect, useState } from 'react'
import { searchIndex } from '../shared/api'
import type { SearchResult } from '../shared/types'

export function useIndexedSearch(vaultRoot: string, query: string, version: number, onError: (message: string) => void) {
  const [results, setResults] = useState<SearchResult[]>([])
  useEffect(() => {
    setResults([])
    if (!vaultRoot.trim() || !query.trim()) return
    let cancelled = false
    const timeout = window.setTimeout(() => {
      searchIndex({ vaultRoot: vaultRoot.trim(), query })
        .then((next) => { if (!cancelled) setResults(next) })
        .catch((error) => { if (!cancelled) onError(String(error)) })
    }, 200)
    return () => { cancelled = true; window.clearTimeout(timeout) }
  }, [vaultRoot, query, version, onError])
  return [results, setResults] as const
}
