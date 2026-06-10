import type { Note } from '../../shared/types'

interface EditorProps {
  note: Note
  onChange: (body: string) => void
  onSave?: () => void
}

export function Editor({ note, onChange, onSave }: EditorProps) {
  return (
    <article className="editor">
      <header className="editor-header">
        <div className="editor-title-row">
          <h2>{note.title}</h2>
          {onSave ? (
            <button className="secondary-action" type="button" onClick={onSave}>
              Save
            </button>
          ) : null}
        </div>
        <div className="metadata">
          <span>{note.category}</span>
          <span>{note.createdAt}</span>
          <span>{note.wordCount} words</span>
          {note.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      </header>
      <textarea
        className="markdown-input"
        aria-label="Markdown editor"
        value={note.body}
        onChange={(event) => onChange(event.target.value)}
      />
    </article>
  )
}
