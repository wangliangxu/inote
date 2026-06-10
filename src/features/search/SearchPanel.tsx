import type { Note } from '../../shared/types'

interface SearchPanelProps {
  query: string
  notes: Note[]
  onQueryChange: (query: string) => void
  onSelectNote: (path: string) => void
}

export function SearchPanel({ query, notes, onQueryChange, onSelectNote }: SearchPanelProps) {
  return (
    <section className="search-panel">
      <header className="panel-heading">
        <h2>Search</h2>
        <span>{notes.length} matches</span>
      </header>
      <input
        className="search-input"
        placeholder="Search title, body, tags, category, or summary"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <div className="result-list">
        {notes.map((note) => (
          <button className="result-item" key={note.path} onClick={() => onSelectNote(note.path)}>
            <span className="note-row-top">
              <strong>{note.title}</strong>
              <time>{note.updatedAt}</time>
            </span>
            <p>{note.summary ?? note.body.slice(0, 140)}</p>
            <span>{note.category}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
