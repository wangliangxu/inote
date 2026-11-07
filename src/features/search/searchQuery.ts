import type { Note, SearchResult } from '../../shared/types'

/** Filter tokens the search box turns into removable chips. */
export const FILTER_TOKEN = /^(#[^\s#]+|tag:\S+|in:\S+|status:\S+)$/i

export interface ParsedSearchQuery {
  /** Free text plus tag tokens, understood by the index and the local matcher. */
  indexQuery: string
  folders: string[]
  statuses: string[]
}

const STATUS_ALIASES: Record<string, string> = {
  todo: 'todo', 待办: 'todo',
  doing: 'in_progress', in_progress: 'in_progress', inprogress: 'in_progress', 进行中: 'in_progress',
  done: 'done', 完成: 'done', 已完成: 'done',
  cancelled: 'cancelled', canceled: 'cancelled', 取消: 'cancelled', 已取消: 'cancelled',
}

export function normalizeStatus(value: string): string {
  const key = value.trim().toLowerCase()
  return STATUS_ALIASES[key] ?? key
}

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const folders: string[] = []
  const statuses: string[] = []
  const rest: string[] = []
  for (const part of query.trim().split(/\s+/)) {
    if (!part) continue
    const lower = part.toLowerCase()
    if (lower.startsWith('in:') && part.length > 3) folders.push(part.slice(3).replace(/^\/|\/$/g, ''))
    else if (lower.startsWith('status:') && part.length > 7) statuses.push(normalizeStatus(part.slice(7)))
    else rest.push(part)
  }
  return { indexQuery: rest.join(' '), folders, statuses }
}

export function matchesSearchFilters(note: Pick<Note, 'category' | 'status'>, parsed: ParsedSearchQuery): boolean {
  if (parsed.folders.length && !parsed.folders.some((folder) => note.category === folder || note.category.startsWith(`${folder}/`))) return false
  if (parsed.statuses.length && !parsed.statuses.includes(note.status ?? '')) return false
  return true
}

/** Rank local matches: title hits first, then tags, then category, then body; ties by recency. */
export function rankLocalResults<T extends Note | SearchResult>(notes: T[], text: string): T[] {
  const terms = text.toLowerCase().split(/\s+/).filter((term) => term && !term.startsWith('#') && !term.startsWith('tag:') && term !== 'or')
  if (!terms.length) return notes
  const score = (note: T) => {
    const title = note.title.toLowerCase()
    const tags = note.tags.join(' ').toLowerCase()
    let value = 0
    for (const term of terms) {
      if (title === term) value += 12
      else if (title.startsWith(term)) value += 8
      else if (title.includes(term)) value += 6
      if (tags.includes(term)) value += 3
      if (note.category.toLowerCase().includes(term)) value += 1
    }
    return value
  }
  return notes
    .map((note, index) => ({ note, index, score: score(note) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ note }) => note)
}

/** Split the query into chip tokens and the free text still being typed. */
export function splitSearchTokens(query: string): { tokens: string[]; text: string } {
  const parts = query.split(/\s+/)
  const tokens: string[] = []
  const text: string[] = []
  for (const part of parts) {
    if (!part) continue
    if (FILTER_TOKEN.test(part)) tokens.push(part)
    else text.push(part)
  }
  return { tokens, text: text.join(' ') }
}

export function joinSearchTokens(tokens: string[], text: string): string {
  return [...tokens, text].filter((part) => part.trim()).join(' ')
}

const RECENT_KEY = 'inote.recentSearches'
const RECENT_LIMIT = 8

export function readRecentSearches(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): string[] {
  try {
    const raw = storage?.getItem(RECENT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

export function rememberSearch(query: string, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): string[] {
  const value = query.trim()
  const current = readRecentSearches(storage)
  if (!value) return current
  const next = [value, ...current.filter((item) => item !== value)].slice(0, RECENT_LIMIT)
  try { storage?.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
  return next
}

export function clearRecentSearches(storage: Pick<Storage, 'removeItem'> | undefined = globalThis.localStorage): void {
  try { storage?.removeItem(RECENT_KEY) } catch { /* storage unavailable */ }
}
