export interface SearchMatch {
  start: number
  end: number
}

export function searchTerms(query: string): string[] {
  return [...new Set(query.trim().split(/\s+/)
    .filter(term => term && !/^or$/i.test(term))
    .map(term => term.startsWith('#') && term.length > 1
      ? term.slice(1)
      : /^tag:/i.test(term) && term.length > 4 ? term.slice(4) : term))]
}

export function findSearchMatches(text: string, query: string): SearchMatch[] {
  const terms = searchTerms(query).sort((a, b) => b.length - a.length)
  if (!text || !terms.length) return []
  const pattern = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return Array.from(text.matchAll(new RegExp(pattern, 'giu')), match => ({
    start: match.index!, end: match.index! + match[0].length,
  }))
}

export function excerptAroundMatch(text: string, query: string, length = 140): string | null {
  const match = findSearchMatches(text, query)[0]
  if (!match) return null
  const start = Math.max(0, match.start - 24)
  const end = Math.min(text.length, Math.max(start + length, match.end))
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}
