import type { Note, SaveState } from '../../shared/types'
import { renderMarkdownPreview } from '../../shared/markdownPreview'
import { Eye, Pencil, RefreshCw, Save, Trash2 } from 'lucide-react'

interface EditorProps {
  note: Note
  onChange: (body: string) => void
  onSave?: () => void
  onCheckExternal?: () => void
  previewMode?: boolean
  onTogglePreview?: () => void
  onDelete?: () => void
  saveState?: SaveState
}

export function Editor({
  note,
  onChange,
  onSave,
  onCheckExternal,
  previewMode = false,
  onTogglePreview,
  onDelete,
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
            <h2>{note.title}</h2>
          </div>
          <div className="editor-actions">
            {onTogglePreview ? (
              <button className="secondary-action icon-action" type="button" onClick={onTogglePreview} title={previewMode ? 'Edit' : 'Preview'}>
                {previewMode ? <Pencil size={16} /> : <Eye size={16} />}
              </button>
            ) : null}
            {onCheckExternal ? (
              <button className="secondary-action icon-action" type="button" onClick={onCheckExternal} title="Check file">
                <RefreshCw size={16} />
              </button>
            ) : null}
            {onSave ? (
              <button className="secondary-action icon-action" type="button" onClick={onSave} title="Save">
                <Save size={16} />
              </button>
            ) : null}
            {onDelete ? (
              <button className="secondary-action delete-action icon-action" type="button" onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDelete()
              }} title="Delete">
                <Trash2 size={16} />
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
