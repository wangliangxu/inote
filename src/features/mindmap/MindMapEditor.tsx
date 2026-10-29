import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Editor as MarkdownEditor } from '../editor/Editor'
import { noteToMarkdown } from '../../shared/noteMarkdown'
import { getFilenameForTitle } from '../../shared/notePaths'
import { HighlightedText } from '../search/HighlightedText'
import {
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
  type MindNode,
} from './mindmap'
import { saveMindMapFile } from './mindmapFiles'
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
  const [past, setPast] = useState<MindMap[]>([])
  const [future, setFuture] = useState<MindMap[]>([])
  const [error, setError] = useState('')
  const [exportFormat, setExportFormat] = useState('json')
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
  function add(sibling: boolean) {
    attempt(() => {
      const child = newNode(t('mindmap.newNode'))
      const next = insertNode(map, selected.node.id, child, sibling)
      change(next)
      setSelectedId(child.id)
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
    })
  }
  function keyDown(event: KeyboardEvent) {
    if (!(event.target as HTMLElement).closest('.mindmap-canvas')) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      event.shiftKey ? redo() : undo()
      return
    }
    if (previewMode) return
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      add(false)
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
  function renderNode(node: MindNode, depth: number) {
    const selectedNode = node.id === selected.node.id
    return (
      <div
        className={`mindmap-branch ${view === 'outline' ? 'outline-branch' : ''}`}
        key={node.id}
      >
        <div className="mindmap-topic-row">
          <button
            type="button"
            className={`mindmap-topic ${selectedNode ? 'selected' : ''} ${depth === 0 ? 'root-topic' : ''}`}
            style={
              node.color && /^#[0-9a-f]{6}$/i.test(node.color)
                ? { borderColor: node.color }
                : undefined
            }
            aria-pressed={selectedNode}
            onClick={() => {
              setSelectedId(node.id)
              editGroup.current = ''
            }}
          >
            <HighlightedText
              text={node.text || t('mindmap.newNode')}
              query={searchQuery}
            />
            {node.note ? (
              <span className="mindmap-note-mark" title={node.note}>
                ⋯
              </span>
            ) : null}
          </button>
          {node.children.length > 0 && (
            <button
              type="button"
              className="mindmap-fold"
              disabled={previewMode}
              aria-label={t(
                node.collapsed ? 'mindmap.expand' : 'mindmap.collapse',
              )}
              onClick={() => {
                change(updateNode(map, node.id, { collapsed: !node.collapsed }))
                setSelectedId(node.id)
              }}
            >
              {node.collapsed ? `+${node.children.length}` : '−'}
            </button>
          )}
        </div>
        {!node.collapsed && node.children.length > 0 && (
          <div className="mindmap-children">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }
  async function exportMap() {
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
          <div className="editor-actions">
            {onCheckExternal && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={onCheckExternal}
              >
                {t('editor.checkFile')}
              </button>
            )}
            {onRename && (
              <button className="btn btn-sm btn-ghost" onClick={onRename}>
                {t('editor.renameNote')}
              </button>
            )}
            {onMove && (
              <button className="btn btn-sm btn-ghost" onClick={onMove}>
                {t('editor.moveNote')}
              </button>
            )}
            {onSave && (
              <button className="btn btn-sm btn-primary" onClick={onSave}>
                {t('editor.save')}
              </button>
            )}
            {onDelete && (
              <button className="btn btn-sm btn-ghost" onClick={onDelete}>
                {t('editor.delete')}
              </button>
            )}
          </div>
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
        <div
          className="mindmap-toolbar"
          role="toolbar"
          aria-label={t('mindmap.title')}
        >
          <div className="join">
            <button
              className={`btn btn-sm join-item ${view === 'map' ? 'btn-active' : ''}`}
              aria-pressed={view === 'map'}
              onClick={() => setView('map')}
            >
              {t('mindmap.map')}
            </button>
            <button
              className={`btn btn-sm join-item ${view === 'outline' ? 'btn-active' : ''}`}
              aria-pressed={view === 'outline'}
              onClick={() => setView('outline')}
            >
              {t('mindmap.outline')}
            </button>
          </div>
          <button
            className="btn btn-sm btn-ghost"
            disabled={previewMode || !past.length}
            onClick={undo}
          >
            {t('mindmap.undo')}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            disabled={previewMode || !future.length}
            onClick={redo}
          >
            {t('mindmap.redo')}
          </button>
          <div className="mindmap-zoom">
            <button
              className="btn btn-sm btn-ghost"
              aria-label={t('mindmap.zoomOut')}
              onClick={() => setZoom(Math.max(0.4, zoom - 0.1))}
            >
              −
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button
              className="btn btn-sm btn-ghost"
              aria-label={t('mindmap.zoomIn')}
              onClick={() => setZoom(Math.min(2, zoom + 0.1))}
            >
              +
            </button>
          </div>
          <select
            className="select select-sm"
            aria-label={t('mindmap.exportFormat')}
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value)}
          >
            <option value="json">iNote JSON</option>
            <option value="mm">FreeMind</option>
            <option value="opml">OPML</option>
            <option value="md">Markdown</option>
          </select>
          <button className="btn btn-sm" onClick={() => void exportMap()}>
            {t('mindmap.export')}
          </button>
        </div>
        <p className="mindmap-hint">
          {t(`mindmap.exportHints.${exportFormat}`)}
        </p>
        {error && (
          <p className="mindmap-error" role="alert">
            {error}
          </p>
        )}
        <div className="mindmap-workspace">
          <div
            className="mindmap-canvas"
            tabIndex={0}
            aria-label={t('mindmap.canvas')}
          >
            <div className={`mindmap-forest ${view}`} style={{ zoom }}>
              {map.roots.map((node) => renderNode(node, 0))}
            </div>
          </div>
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
              {t('mindmap.nodeText')}
              <textarea
                className="textarea"
                value={selected.node.text}
                disabled={previewMode}
                onBlur={() => {
                  editGroup.current = ''
                }}
                onChange={(e) =>
                  change(
                    updateNode(map, selected.node.id, { text: e.target.value }),
                    `${selected.node.id}:text`,
                  )
                }
              />
            </label>
            <label>
              {t('mindmap.nodeNote')}
              <textarea
                className="textarea"
                value={selected.node.note ?? ''}
                disabled={previewMode}
                onBlur={() => {
                  editGroup.current = ''
                }}
                onChange={(e) =>
                  change(
                    updateNode(map, selected.node.id, { note: e.target.value }),
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
                    updateNode(map, selected.node.id, { link: e.target.value }),
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
                onClick={() => add(false)}
              >
                {t('mindmap.addChild')}
              </button>
              <button
                className="btn btn-sm"
                disabled={previewMode}
                onClick={() => add(true)}
              >
                {t('mindmap.addSibling')}
              </button>
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
        </div>
      </div>
    </article>
  )
}
// Used by callers that need to distinguish a mind map without parsing its body.
export const isMindMapNote = (note: Props['note']) =>
  note.frontmatter?.[MINDMAP_KEY] !== undefined
