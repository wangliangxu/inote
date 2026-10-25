import type { Note, SearchResult } from '../../shared/types'
import { useTranslation } from 'react-i18next'
import { HighlightedText, SearchMatchMetadata } from './HighlightedText'
import { excerptAroundMatch } from './searchHighlight'

interface SearchPanelProps {
  query: string
  notes: Array<Note | SearchResult>
  onQueryChange: (query: string) => void
  onSelectNote: (path: string) => void
  backendEnabled?: boolean
}

export function SearchPanel({ query, notes, onQueryChange, onSelectNote, backendEnabled = false }: SearchPanelProps) {
  const { t } = useTranslation()
  return (
    <section className="search-panel">
      <header className="panel-heading">
        <h2>{t('search.title')}</h2>
        <span>{t('search.matches', { count: notes.length, type: backendEnabled ? 'SQLite FTS' : 'memory' })}</span>
      </header>
      <input
        className="search-input"
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <div className="result-list">
        {notes.map((note) => (
          <button className="result-item" key={note.path} onClick={() => onSelectNote(note.path)}>
            <span className="note-row-top">
              <strong><HighlightedText text={note.title} query={query} /></strong>
              <time>{note.updatedAt}</time>
            </span>
            <p><HighlightedText text={excerptAroundMatch(note.excerpt ?? note.summary ?? ('body' in note ? note.body : ''), query) ?? note.excerpt ?? note.summary ?? ('body' in note ? note.body.slice(0, 140) : '')} query={query} /></p>
            <span><HighlightedText text={note.category} query={query} /></span>
            <SearchMatchMetadata note={note} query={query} />
          </button>
        ))}
      </div>
    </section>
  )
}
