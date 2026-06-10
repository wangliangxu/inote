import type { Note } from '../../shared/types'

interface EditorProps {
  note: Note
  onChange: (body: string) => void
  onSave?: () => void
  saveState?: 'demo' | 'dirty' | 'saving' | 'saved' | 'error'
}

export function Editor({ note, onChange, onSave, saveState = 'demo' }: EditorProps) {
  const saveLabel = {
    demo: 'Demo only',
    dirty: 'Unsaved',
    saving: 'Saving',
    saved: 'Saved',
    error: 'Save failed',
  }[saveState]

  return (
    <article className="editor">
      <header className="editor-header">
        <div className="editor-title-row">
          <div>
            <span className="eyebrow">{note.category}</span>
            <h2>{note.title}</h2>
          </div>
          {onSave ? (
            <button className="secondary-action" type="button" onClick={onSave}>
              Save
            </button>
          ) : null}
        </div>
        <div className="metadata">
          <span className={`save-state ${saveState}`}>{saveLabel}</span>
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
