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
      <h2>Search</h2>
      <input
        className="search-input"
        placeholder="Search title, body, tags, category, or summary"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <div className="result-list">
        {notes.map((note) => (
          <button className="result-item" key={note.path} onClick={() => onSelectNote(note.path)}>
            <strong>{note.title}</strong>
            <p>{note.summary ?? note.body.slice(0, 140)}</p>
            <span>{note.category}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
