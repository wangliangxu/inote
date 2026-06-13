import { useMemo, useState, useEffect } from 'react'
import type { Note, SaveState } from '../../shared/types'
import { noteToMarkdown } from '../../shared/api'
import { convertFileSrc } from '@tauri-apps/api/core'
import { toMarkdownImagePreviewSrc } from '../../shared/markdownImages'
import { Eye, Pencil, RefreshCw, Save, Trash2 } from 'lucide-react'
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  frontmatterPlugin,
  tablePlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertTable,
  ListsToggle,
  InsertThematicBreak,
  diffSourcePlugin,
  DiffSourceToggleWrapper,
  InsertImage,
  codeBlockPlugin,
  codeMirrorPlugin,
  InsertCodeBlock
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'

interface EditorProps {
  vaultRoot?: string
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
  vaultRoot = '',
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

  // Detect current theme from HTML dataset to pass to MDXEditor
  const [isDark, setIsDark] = useState(() => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark')

  useEffect(() => {
    if (typeof document === 'undefined') return
    
    const syncBodyClass = (dark: boolean) => {
      document.body.classList.toggle('dark-theme', dark)
      document.body.classList.toggle('dark-editor', dark)
    }

    const observer = new MutationObserver(() => {
      const dark = document.documentElement.dataset.theme === 'dark'
      setIsDark(dark)
      syncBodyClass(dark)
    })
    
    // Initial sync
    const initialDark = document.documentElement.dataset.theme === 'dark'
    syncBodyClass(initialDark)

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const plugins = useMemo(() => [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    markdownShortcutPlugin(),
    frontmatterPlugin(),
    tablePlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    imagePlugin({
      imageUploadHandler: async (image: File) => {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(image)
        })
      },
      imagePreviewHandler: async (src: string) => {
        return toMarkdownImagePreviewSrc(vaultRoot, note.path, src, convertFileSrc)
      }
    }),
    codeBlockPlugin({ defaultCodeBlockLanguage: 'txt' }),
    codeMirrorPlugin({ 
      codeBlockLanguages: { js: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript (React)', css: 'CSS', txt: 'Text', markdown: 'Markdown', json: 'JSON', html: 'HTML', python: 'Python', bash: 'Bash' } 
    }),
    diffSourcePlugin({ viewMode: 'rich-text', diffMarkdown: note.body }),
    toolbarPlugin({
      toolbarContents: () => (
        <DiffSourceToggleWrapper>
          <UndoRedo />
          <BoldItalicUnderlineToggles />
          <BlockTypeSelect />
          <ListsToggle />
          <CreateLink />
          <InsertImage />
          <InsertTable />
          <InsertThematicBreak />
          <InsertCodeBlock />
        </DiffSourceToggleWrapper>
      )
    })
  ], [note.path, vaultRoot, isDark])

  return (
    <article className="editor">
      <header className="editor-header">
        <div className="editor-title-row">
          <div>
            <h2>{note.title}</h2>
          </div>
          <div className="editor-actions">

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
      <div className={`mdx-editor-wrapper ${isDark ? 'dark-theme dark-editor' : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <MDXEditor
          key={note.path} // Force re-mount on note change so internal state resets
          className={`mdx-editor-main ${isDark ? 'dark-theme dark-editor' : ''}`}
          markdown={noteToMarkdown(note)}
          onChange={onChange}
          readOnly={previewMode}
          contentEditableClassName="prose"
          plugins={plugins}
        />
      </div>
    </article>
  )
}
