import { useMemo, useState, useEffect, useRef, memo, useCallback } from 'react'
import type { Note, SaveState, NoteLinks } from '../../shared/types'
import { noteToMarkdown, parseMarkdownWithFrontmatter } from '../../shared/api'
import { convertFileSrc } from '@tauri-apps/api/core'
import { toMarkdownImagePreviewSrc } from '../../shared/markdownImages'
import { Eye, TextCursorInput, RefreshCw, Save, Trash2, MoveRight, Info, PanelRight, Archive, Sparkles, Link2 } from 'lucide-react'
import {
  MDXEditor,
  type MDXEditorMethods,
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
  InsertCodeBlock,
  viewMode$,
  realmPlugin
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
  onRename?: () => void
  onMove?: () => void
  onDelete?: () => void
  saveState?: SaveState
  noteLinks?: NoteLinks
  onUpdateTitle?: (title: string) => void
  onUpdateCreatedAt?: (date: string) => void
  onUpdateUpdatedAt?: (date: string) => void
  onUpdateDue?: (date: string) => void
  onUpdateStatus?: (status: string) => void
  onUpdateProject?: (project: string) => void
  onUpdateTags?: (tags: string) => void
  onArchiveInboxNote?: () => void
  onNavigateLink?: (path: string) => void
}

const TagsInput = memo(function TagsInput({ tags, onChange }: { tags: string[], onChange: (value: string) => void }) {
  const [value, setValue] = useState(tags.join(', '))

  useEffect(() => {
    const currentTags = value
      .split(',')
      .map(t => t.trim().replace(/^#/, ''))
      .filter(Boolean)
      .filter((tag, index, all) => all.indexOf(tag) === index)
      .join(',')
    
    const newTags = tags.join(',')
    
    if (currentTags !== newTags) {
      setValue(tags.join(', '))
    }
  }, [tags, value])

  return (
    <input 
      value={value} 
      onChange={(e) => {
        setValue(e.target.value)
        onChange(e.target.value)
      }} 
    />
  )
})

export function Editor({
  vaultRoot = '',
  note,
  onChange,
  onSave,
  onCheckExternal,
  previewMode = false,
  onTogglePreview,
  onRename,
  onMove,
  onDelete,
  saveState = 'demo',
  noteLinks,
  onUpdateTitle,
  onUpdateCreatedAt,
  onUpdateUpdatedAt,
  onUpdateDue,
  onUpdateStatus,
  onUpdateProject,
  onUpdateTags,
  onArchiveInboxNote,
  onNavigateLink,
}: EditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const [diffBaseline, setDiffBaseline] = useState(() => noteToMarkdown(note))
  const [metadataPanelOpen, setMetadataPanelOpen] = useState(false)
  const [metadataWidth, setMetadataWidth] = useState(300)
  const isDraggingRef = useRef(false)
  const realmRef = useRef<any>(null)
  const previousModeRef = useRef<string>('rich-text')

  const realmTrackerPlugin = useMemo(() => realmPlugin({
    init: (realm) => {
      realmRef.current = realm
    }
  }), [])

  useEffect(() => {
    if (metadataPanelOpen) {
      if (realmRef.current) {
        const currentMode = realmRef.current.getValue(viewMode$)
        if (currentMode !== 'source') {
          previousModeRef.current = currentMode
          realmRef.current.pub(viewMode$, 'source')
        }
      }
    } else {
      if (realmRef.current) {
        const currentMode = realmRef.current.getValue(viewMode$)
        if (currentMode === 'source') {
          realmRef.current.pub(viewMode$, previousModeRef.current)
        }
      }
    }
  }, [metadataPanelOpen])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      const editorContainer = document.querySelector('.editor') as HTMLElement
      if (editorContainer) {
        const bounds = editorContainer.getBoundingClientRect()
        const newWidth = bounds.right - e.clientX
        setMetadataWidth(Math.max(200, Math.min(newWidth, bounds.width - 200)))
      }
    }
    
    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        document.body.style.cursor = ''
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true
    document.body.style.cursor = 'col-resize'
    e.preventDefault()
  }, [])

  useEffect(() => {
    if (saveState === 'saved' || saveState === 'demo') {
      setDiffBaseline(noteToMarkdown(note))
    }
  }, [saveState, note])

  useEffect(() => {
    if (editorRef.current) {
      const currentMd = editorRef.current.getMarkdown()
      const { metadata: currentMeta } = parseMarkdownWithFrontmatter(currentMd)
      const newMd = noteToMarkdown(note)
      const { metadata: newMeta } = parseMarkdownWithFrontmatter(newMd)
      
      const changed = 
        currentMeta.title !== newMeta.title ||
        currentMeta.category !== newMeta.category ||
        (currentMeta.tags || []).join(',') !== (newMeta.tags || []).join(',') ||
        currentMeta.summary !== newMeta.summary

      if (changed) {
        editorRef.current.setMarkdown(newMd)
      }
    }
  }, [note.title, note.category, note.tags, note.summary])

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
    diffSourcePlugin({ viewMode: 'rich-text', diffMarkdown: diffBaseline }),
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
    }),
    realmTrackerPlugin()
  ], [note.path, vaultRoot, isDark, diffBaseline, realmTrackerPlugin])

  return (
    <article className="editor">
      <header className="editor-header">
        <div className="editor-title-row">
          <div>
            <h2>{note.title}</h2>
          </div>
          <div className="editor-actions">
            {onRename ? (
              <button className="secondary-action icon-action" type="button" onClick={onRename} title="Rename note">
                <TextCursorInput size={16} />
              </button>
            ) : null}
            {onMove ? (
              <button className="secondary-action icon-action" type="button" onClick={onMove} title="Move note">
                <MoveRight size={16} />
              </button>
            ) : null}

            <button className={`secondary-action icon-action ${metadataPanelOpen ? 'active' : ''}`} type="button" onClick={() => setMetadataPanelOpen(!metadataPanelOpen)} title="Metadata">
              <Info size={16} />
            </button>
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
        <div className={`mdx-editor-wrapper ${isDark ? 'dark-theme dark-editor' : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <MDXEditor
            ref={editorRef}
            key={note.path} // Force re-mount on note change so internal state resets
            className={`mdx-editor-main ${isDark ? 'dark-theme dark-editor' : ''}`}
            markdown={noteToMarkdown(note)}
            onChange={onChange}
            readOnly={previewMode}
            contentEditableClassName="prose"
            plugins={plugins}
          />
        </div>
        {metadataPanelOpen && (
          <>
            <div
              className="metadata-resizer"
              onMouseDown={handleMouseDown}
              style={{
                width: '5px',
                cursor: 'col-resize',
                backgroundColor: 'transparent',
                zIndex: 10,
                marginLeft: '-2px',
                marginRight: '-3px'
              }}
              onMouseEnter={(e) => {
                if (!isDraggingRef.current) e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.1)'
              }}
              onMouseLeave={(e) => {
                if (!isDraggingRef.current) e.currentTarget.style.backgroundColor = 'transparent'
              }}
            />
            <aside className="context-panel" style={{ width: `${metadataWidth}px`, borderLeft: '1px solid var(--border)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <section className="context-section">
              <label className="metadata-editor">
                <span>Title</span>
                <input value={note.title} onChange={(event) => onUpdateTitle?.(event.target.value)} />
              </label>
              <label className="metadata-editor">
                <span>Created</span>
                <input type="date" value={note.createdAt.slice(0, 10)} onChange={(event) => onUpdateCreatedAt?.(event.target.value)} />
              </label>
              <label className="metadata-editor">
                <span>Updated</span>
                <input type="date" value={note.updatedAt.slice(0, 10)} onChange={(event) => onUpdateUpdatedAt?.(event.target.value)} />
              </label>
              <label className="metadata-editor">
                <span>Due</span>
                <input type="date" value={note.due?.slice(0, 10) || ''} onChange={(event) => onUpdateDue?.(event.target.value)} />
              </label>
              <label className="metadata-editor">
                <span>Status</span>
                <select value={note.status || 'open'} onChange={(event) => onUpdateStatus?.(event.target.value)}>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="canceled">Canceled</option>
                </select>
              </label>
              <label className="metadata-editor">
                <span>Project</span>
                <input type="text" value={note.project || ''} onChange={(event) => onUpdateProject?.(event.target.value)} placeholder="Project name" />
              </label>
              <label className="metadata-editor">
                <span>Tags</span>
                <TagsInput tags={note.tags} onChange={onUpdateTags!} />
              </label>
              <div className="context-actions">
                {note.path.startsWith('00-inbox/') && onArchiveInboxNote ? (
                  <button type="button" onClick={onArchiveInboxNote} title="Archive inbox note">
                    <Archive size={15} />
                  </button>
                ) : null}
              </div>
            </section>
            <section className="context-section">
              <p className="panel-title">
                <Sparkles size={14} /> Summary
              </p>
              <p className="summary-text">{note.summary ?? note.body.replace(/^# .*\n?/, '').trim().slice(0, 180)}</p>
            </section>
            <section className="context-section">
              <p className="panel-title">
                <Link2 size={14} /> Links
              </p>
              <div className="link-group">
                <h4>Backlinks</h4>
                {noteLinks?.backlinks.length ? (
                  noteLinks.backlinks.map((link) => (
                    <button key={`${link.sourcePath}-${link.label}`} type="button" onClick={() => onNavigateLink?.(link.sourcePath)}>
                      <strong>{link.sourceTitle}</strong>
                      <span>{link.sourcePath}</span>
                    </button>
                  ))
                ) : (
                  <p>No backlinks.</p>
                )}
              </div>
              <div className="link-group">
                <h4>Outgoing</h4>
                {noteLinks?.outgoing.length ? (
                  noteLinks.outgoing.map((link) => (
                    <button key={`${link.targetPath}-${link.label}`} type="button" onClick={() => onNavigateLink?.(link.targetPath)}>
                      <strong>{link.targetTitle}</strong>
                      <span>{link.targetPath}</span>
                    </button>
                  ))
                ) : (
                  <p>No outgoing links.</p>
                )}
              </div>
            </section>
          </aside>
          </>
        )}
      </div>
    </article>
  )
}
