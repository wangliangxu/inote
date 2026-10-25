import { Fragment } from 'react'
import type { Note, SearchResult } from '../../shared/types'
import { findSearchMatches } from './searchHighlight'

export function HighlightedText({ text, query }: { text: string, query: string }) {
  const matches = findSearchMatches(text, query)
  let offset = 0
  return <>{matches.map(match => {
    const before = text.slice(offset, match.start)
    offset = match.end
    return <Fragment key={match.start}>{before}<mark className="search-match">{text.slice(match.start, match.end)}</mark></Fragment>
  })}{text.slice(offset)}</>
}

export function SearchMatchMetadata({ note, query }: { note: Note | SearchResult, query: string }) {
  if (!query.trim()) return null
  const fields = [note.category, ...note.tags.map(tag => `#${tag}`)]
    .filter(text => findSearchMatches(text, query).length > 0)
  if (!fields.length) return null
  return <div className="search-match-metadata">{fields.map(text => (
    <span key={text}><HighlightedText text={text} query={query} /></span>
  ))}</div>
}
