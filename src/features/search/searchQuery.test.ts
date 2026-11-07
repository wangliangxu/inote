import { describe, expect, it } from 'vitest'
import { demoNotes } from '../../shared/fixtures'
import {
  joinSearchTokens,
  matchesSearchFilters,
  normalizeStatus,
  parseSearchQuery,
  rankLocalResults,
  readRecentSearches,
  rememberSearch,
  splitSearchTokens,
} from './searchQuery'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
}

describe('search query syntax', () => {
  it('separates folder and status filters from text and tag terms', () => {
    expect(parseSearchQuery('tauri #desktop in:knowledge/ status:doing')).toEqual({
      indexQuery: 'tauri #desktop',
      folders: ['knowledge'],
      statuses: ['in_progress'],
    })
  })

  it('accepts Chinese status aliases', () => {
    expect(normalizeStatus('已完成')).toBe('done')
    expect(normalizeStatus('待办')).toBe('todo')
  })

  it('matches folders including subfolders and statuses', () => {
    const parsed = parseSearchQuery('in:knowledge status:todo')
    expect(matchesSearchFilters({ category: 'knowledge/tauri', status: 'todo' }, parsed)).toBe(true)
    expect(matchesSearchFilters({ category: 'knowledgebase', status: 'todo' }, parsed)).toBe(false)
    expect(matchesSearchFilters({ category: 'knowledge', status: 'done' }, parsed)).toBe(false)
  })

  it('splits filter chips from free text and joins them back', () => {
    const split = splitSearchTokens('#work plan in:journal status:todo week')
    expect(split).toEqual({ tokens: ['#work', 'in:journal', 'status:todo'], text: 'plan week' })
    expect(joinSearchTokens(split.tokens, split.text)).toBe('#work in:journal status:todo plan week')
  })

  it('ranks title matches ahead of body-only matches', () => {
    const [first, second] = demoNotes
    const bodyOnly = { ...first, title: 'Unrelated', body: 'mentions tauri here' }
    const titleMatch = { ...second, title: 'Tauri guide' }
    expect(rankLocalResults([bodyOnly, titleMatch], 'tauri').map((note) => note.title)).toEqual(['Tauri guide', 'Unrelated'])
  })

  it('keeps the most recent unique searches', () => {
    const storage = memoryStorage()
    rememberSearch('alpha', storage)
    rememberSearch('beta', storage)
    rememberSearch('alpha', storage)
    expect(readRecentSearches(storage)).toEqual(['alpha', 'beta'])
  })
})
