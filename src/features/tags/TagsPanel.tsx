import type { Note } from '../../shared/types'
import { filterNotesByTag, groupByTag } from '../../shared/vault'

interface TagsPanelProps {
  notes: Note[]
  activeTag: string
  onSelectTag: (tag: string) => void
  onSelectNote: (path: string) => void
}

export function TagsPanel({ notes, activeTag, onSelectTag, onSelectNote }: TagsPanelProps) {
  const tags = groupByTag(notes)
  const taggedNotes = activeTag ? filterNotesByTag(notes, activeTag) : []

  return (
    <section className="tags-panel">
      <aside className="tag-browser">
        <header className="panel-heading">
          <h2>Tags</h2>
          <span>{tags.length} tags</span>
        </header>
        <div className="tag-list">
          {tags.map((tag) => (
            <button key={tag.name} className={activeTag === tag.name ? 'active' : ''} onClick={() => onSelectTag(tag.name)}>
              <span>#{tag.name}</span>
              <small>{tag.count}</small>
            </button>
          ))}
        </div>
      </aside>

      <div className="tag-results">
        <header className="panel-heading">
          <h2>{activeTag ? `#${activeTag}` : 'Select a tag'}</h2>
          <span>{taggedNotes.length} notes</span>
        </header>
        <div className="result-list">
          {taggedNotes.map((note) => (
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
      </div>
    </section>
  )
}
