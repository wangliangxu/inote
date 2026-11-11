import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Editor as MarkdownEditor } from '../editor/Editor'
import { noteToMarkdown } from '../../shared/noteMarkdown'
import { getFilenameForTitle } from '../../shared/notePaths'
import { HighlightedText } from '../search/HighlightedText'
import {
  dropNode,
  exportFreeMind,
  exportOpml,
  flattenNodes,
  getNoteMindMap,
  insertNode,
  MINDMAP_KEY,
  MindMapError,
  mindMapMarkdown,
  moveNode,
  newNode,
  removeNode,
  reorderNode,
  safeNodeLink,
  updateNode,
  withMindMap,
  type MindMap,
} from './mindmap'
import { saveMindMapFile } from './mindmapFiles'
import { MindMapToolbar, type MindMapExportFormat } from './MindMapToolbar'
import { MindMapCanvas, type MindMapCanvasHandle } from './MindMapCanvas'
import './mindmap.css'

type Props = ComponentProps<typeof MarkdownEditor>
export function Editor(props: Props) {
  const { t } = useTranslation()
  const [source, setSource] = useState(false)
  const result = useMemo(() => {
    try {
      return { map: getNoteMindMap(props.note), error: null }
    } catch (error) {
      return { map: null, error }
    }
  }, [props.note.frontmatter])
  if (source)
    return (
      <div className="mindmap-source">
        <button className="btn btn-sm" onClick={() => setSource(false)}>
          {t('mindmap.back')}
        </button>
        <MarkdownEditor {...props} />
      </div>
    )
  if (result.error)
    return (
      <div className="empty" role="alert">
        <p>{t('mindmap.errors.invalid')}</p>
        <button className="btn" onClick={() => setSource(true)}>
          {t('mindmap.source')}
        </button>
      </div>
    )
  if (!result.map || props.note.rawMarkdown !== undefined)
    return <MarkdownEditor {...props} />
  return <MindMapWorkspace {...props} map={result.map} />
}

export function MindMapWorkspace({
  note,
  map,
  onChange,
  onSave,
  onRename,
  onMove,
  onDelete,
  onCheckExternal,
  onUpdateTitle,
  onUpdateTags,
  saveState = 'demo',
  searchQuery = '',
  previewMode = false,
}: Props & { map: MindMap }) {
  const { t } = useTranslation()
  const [view, setView] = useState<'map' | 'outline'>('map')
  const [selectedId, setSelectedId] = useState(map.roots[0].id)
  const [zoom, setZoom] = useState(1)
  const [inspectorOpen, setInspectorOpen] = useState(() => {
    try {
      return window.localStorage.getItem('inote-mindmap-inspector-open') === 'true'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem('inote-mindmap-inspector-open', String(inspectorOpen))
    } catch {
      // Keep the panel usable even when browser storage is unavailable.
    }
  }, [inspectorOpen])
  const canvasRef = useRef<MindMapCanvasHandle>(null)
  const [past, setPast] = useState<MindMap[]>([])
  const [future, setFuture] = useState<MindMap[]>([])
  const [error, setError] = useState('')
  const noteInputRef = useRef<HTMLTextAreaElement>(null)
  const [focusNotes, setFocusNotes] = useState(false)
  useEffect(() => {
    if (focusNotes && inspectorOpen) {
      noteInputRef.current?.focus()
      setFocusNotes(false)
    }
  }, [focusNotes, inspectorOpen])
  const [tagText, setTagText] = useState(note.tags.join(', '))
  useEffect(() => {
    const normalized = tagText
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean)
      .filter((tag, index, all) => all.indexOf(tag) === index)
      .join(',')
    if (normalized !== note.tags.join(',')) setTagText(note.tags.join(', '))
  }, [note.tags, tagText])
  const lastEmitted = useRef(JSON.stringify(map))
  const editGroup = useRef('')
  const inlineHistory = useRef<{
    map: MindMap
    past: MindMap[]
    future: MindMap[]
  } | null>(null)
  const entries = useMemo(() => flattenNodes(map), [map])
  const selected =
    entries.find((item) => item.node.id === selectedId) ?? entries[0]
  const descendants = new Set(
    flattenNodes({ version: 1, roots: [selected.node] }).map(
      (item) => item.node.id,
    ),
  )
  useEffect(() => {
    if (JSON.stringify(map) !== lastEmitted.current) {
      setPast([])
      setFuture([])
      editGroup.current = ''
      inlineHistory.current = null
      lastEmitted.current = JSON.stringify(map)
    }
  }, [map])
  function emit(next: MindMap) {
    lastEmitted.current = JSON.stringify(next)
    onChange(noteToMarkdown(withMindMap(note, next)))
  }
  function change(next: MindMap, group = '') {
    if (previewMode || JSON.stringify(next) === JSON.stringify(map)) return
    if (!group || editGroup.current !== group)
      setPast((current) => [...current.slice(-99), map])
    editGroup.current = group
    setFuture([])
    setError('')
    emit(next)
  }
  function attempt(action: () => void) {
    try {
      action()
    } catch (error) {
      setError(
        t(
          `mindmap.errors.${error instanceof MindMapError ? error.code : 'invalid'}`,
        ),
      )
    }
  }
  function undo() {
    const previous = past[past.length - 1]
    if (!previous || previewMode) return
    setPast(past.slice(0, -1))
    setFuture([map, ...future])
    editGroup.current = ''
    emit(previous)
  }
  function redo() {
    if (!future.length || previewMode) return
    setPast([...past, map])
    setFuture(future.slice(1))
    editGroup.current = ''
    emit(future[0])
  }
  function add(sibling: boolean, edit = false) {
    attempt(() => {
      const child = newNode(t('mindmap.newNode'))
      const next = insertNode(map, selected.node.id, child, sibling)
      change(next)
      setSelectedId(child.id)
      if (edit) canvasRef.current?.editNode(child.id)
    })
  }
  function remove() {
    attempt(() => {
      change(removeNode(map, selected.node.id))
      setSelectedId(
        selected.parent?.id ??
          map.roots.find((n) => n.id !== selected.node.id)?.id ??
          '',
      )
      canvasRef.current?.focus()
    })
  }
  function keyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'z' &&
      !target.closest('input,textarea,select,[contenteditable="true"]')
    ) {
      event.preventDefault()
      event.shiftKey ? redo() : undo()
      return
    }
    if (target.closest('input,textarea,select,[contenteditable="true"]')) return
    if (!target.closest('.mindmap-canvas') || target.closest('.mindmap-fold'))
      return
    if (previewMode) return
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      add(false, true)
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      add(true)
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      remove()
    }
  }
  async function exportMap(exportFormat: MindMapExportFormat) {
    const formats: Record<string, [string, string]> = {
      json: ['inote-mindmap', JSON.stringify(map, null, 2)],
      mm: ['mm', exportFreeMind(map)],
      opml: ['opml', exportOpml(map, note.title)],
      md: ['md', mindMapMarkdown(map)],
    }
    const [extension, content] = formats[exportFormat]
    try {
      await saveMindMapFile(
        `${getFilenameForTitle(Array.from(note.title.split(/\r?\n/)[0]).slice(0, 60).join(''))}.${extension}`,
        content,
      )
      setError('')
    } catch {
      setError(t('mindmap.errors.export'))
    }
  }
  return (
    <article className="editor mindmap-editor" onKeyDown={keyDown}>
      <header className="editor-header">
        <div className="editor-title-row">
          <h2>
            <HighlightedText text={note.title} query={searchQuery} />
          </h2>
        </div>
        <div className="metadata">
          <span className={`save-state ${saveState}`}>
            {t(`mindmap.state.${saveState}`)}
          </span>
          <span>{note.category}</span>
          <span>
            {entries.length} {t('mindmap.nodes')}
          </span>
          {note.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      </header>
      <div className="mindmap-content">
        <MindMapToolbar
          view={view}
          zoom={zoom}
          readOnly={previewMode}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
          canFold={selected.node.children.length > 0}
          collapsed={!!selected.node.collapsed}
          inspectorOpen={inspectorOpen}
          onView={setView}
          onUndo={undo}
          onRedo={redo}
          onAddChild={() => add(false)}
          onAddSibling={() => add(true)}
          onFold={() =>
            change(
              updateNode(map, selected.node.id, {
                collapsed: !selected.node.collapsed,
              }),
            )
          }
          onNotes={() => {
            setInspectorOpen(true)
            setFocusNotes(true)
          }}
          onInspector={() => setInspectorOpen((open) => !open)}
          onFit={() => canvasRef.current?.fit()}
          onZoom={setZoom}
          onExport={(format) => void exportMap(format)}
          onSave={onSave}
          onRename={onRename}
          onMove={onMove}
          onCheckExternal={onCheckExternal}
          onDelete={onDelete}
        />
        {error && (
          <p className="mindmap-error" role="alert">
            {error}
          </p>
        )}
        <div className="mindmap-workspace">
          <MindMapCanvas
            ref={canvasRef}
            map={map}
            view={view}
            zoom={zoom}
            selectedId={selected.node.id}
            searchQuery={searchQuery}
            readOnly={previewMode}
            onZoomChange={setZoom}
            onSelect={(id) => {
              setSelectedId(id)
              editGroup.current = ''
            }}
            onDropNode={(id, targetId, position) => attempt(() => {
              change(dropNode(map, id, targetId, position))
              setSelectedId(id)
            })}
            onAddChild={() => add(false, true)}
            onTextEditStart={() => {
              inlineHistory.current = { map, past, future }
              editGroup.current = ''
            }}
            onTextChange={(id, text) =>
              change(updateNode(map, id, { text }), `${id}:inline-text`)
            }
            onTextEditEnd={(cancel) => {
              const history = inlineHistory.current
              inlineHistory.current = null
              editGroup.current = ''
              if (history && (cancel || JSON.stringify(history.map) === JSON.stringify(map))) {
                setPast(history.past)
                setFuture(history.future)
                if (cancel && JSON.stringify(history.map) !== JSON.stringify(map))
                  emit(history.map)
              }
            }}
            onToggle={(node) => {
              change(updateNode(map, node.id, { collapsed: !node.collapsed }))
              setSelectedId(node.id)
            }}
          />
          {inspectorOpen && (
            <aside
              className="mindmap-inspector"
              aria-label={t('mindmap.nodeDetails')}
            >
              <label>
                {t('mindmap.noteTitle')}
                <input
                  className="input input-sm"
                  value={note.title}
                  disabled={previewMode || !onUpdateTitle}
                  onChange={(e) => onUpdateTitle?.(e.target.value)}
                />
              </label>
              <label>
                {t('mindmap.tags')}
                <input
                  className="input input-sm"
                  value={tagText}
                  disabled={previewMode || !onUpdateTags}
                  onChange={(e) => {
                    setTagText(e.target.value)
                    onUpdateTags?.(e.target.value)
                  }}
                />
              </label>
              <hr />
              <label>
                {t('mindmap.nodeNote')}
                <textarea
                  ref={noteInputRef}
                  className="textarea"
                  value={selected.node.note ?? ''}
                  disabled={previewMode}
                  onBlur={() => {
                    editGroup.current = ''
                  }}
                  onChange={(e) =>
                    change(
                      updateNode(map, selected.node.id, {
                        note: e.target.value,
                      }),
                      `${selected.node.id}:note`,
                    )
                  }
                />
              </label>
              <label>
                {t('mindmap.nodeLink')}
                <input
                  className="input input-sm"
                  value={selected.node.link ?? ''}
                  disabled={previewMode}
                  onChange={(e) =>
                    change(
                      updateNode(map, selected.node.id, {
                        link: e.target.value,
                      }),
                      `${selected.node.id}:link`,
                    )
                  }
                />
              </label>
              {selected.node.link && safeNodeLink(selected.node.link) && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    void openUrl(selected.node.link!).catch(() =>
                      setError(t('mindmap.errors.link')),
                    )
                  }}
                >
                  {t('mindmap.openLink')}
                </button>
              )}
              <label>
                {t('mindmap.parent')}
                <select
                  className="select select-sm"
                  value={selected.parent?.id ?? ''}
                  disabled={previewMode}
                  onChange={(e) =>
                    attempt(() =>
                      change(
                        moveNode(map, selected.node.id, e.target.value || null),
                      ),
                    )
                  }
                >
                  <option value="">{t('mindmap.root')}</option>
                  {entries
                    .filter((item) => !descendants.has(item.node.id))
                    .map((item) => (
                      <option value={item.node.id} key={item.node.id}>
                        {'· '.repeat(item.depth)}
                        {item.node.text.slice(0, 50)}
                      </option>
                    ))}
                </select>
              </label>
              <div className="mindmap-node-actions">
                <button
                  className="btn btn-sm"
                  disabled={previewMode}
                  onClick={() => change(reorderNode(map, selected.node.id, -1))}
                >
                  {t('mindmap.up')}
                </button>
                <button
                  className="btn btn-sm"
                  disabled={previewMode}
                  onClick={() => change(reorderNode(map, selected.node.id, 1))}
                >
                  {t('mindmap.down')}
                </button>
                <button
                  className="btn btn-sm btn-ghost text-error"
                  disabled={
                    previewMode || (map.roots.length === 1 && !selected.parent)
                  }
                  onClick={remove}
                >
                  {t('mindmap.remove')}
                </button>
              </div>
              <p className="mindmap-hint">{t('mindmap.shortcuts')}</p>
            </aside>
          )}
        </div>
      </div>
    </article>
  )
}
// Used by callers that need to distinguish a mind map without parsing its body.
export const isMindMapNote = (note: Props['note']) =>
  note.frontmatter?.[MINDMAP_KEY] !== undefined
