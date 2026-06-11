import type { Note, SaveState } from '../../shared/types'
import { renderMarkdownPreview } from '../../shared/markdownPreview'

interface EditorProps {
  note: Note
  onChange: (body: string) => void
  onSave?: () => void
  onCheckExternal?: () => void
  previewMode?: boolean
  onTogglePreview?: () => void
  saveState?: SaveState
}

export function Editor({
  note,
  onChange,
  onSave,
  onCheckExternal,
  previewMode = false,
  onTogglePreview,
  saveState = 'demo',
}: EditorProps) {
  const saveLabel = {
    loading: 'Loading',
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
          <div className="editor-actions">
            {onTogglePreview ? (
              <button className="secondary-action" type="button" onClick={onTogglePreview}>
                {previewMode ? 'Edit' : 'Preview'}
              </button>
            ) : null}
            {onCheckExternal ? (
              <button className="secondary-action" type="button" onClick={onCheckExternal}>
                Check file
              </button>
            ) : null}
            {onSave ? (
              <button className="secondary-action" type="button" onClick={onSave}>
                Save
              </button>
            ) : null}
          </div>
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
      {previewMode ? (
        <section
          className="markdown-preview"
          aria-label="Markdown preview"
          dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(note.body) }}
        />
      ) : (
        <textarea
          className="markdown-input"
          aria-label="Markdown editor"
          value={note.body}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </article>
  )
}
