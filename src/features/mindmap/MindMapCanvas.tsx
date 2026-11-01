import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { HighlightedText } from '../search/HighlightedText'
import { flattenNodes, type MindMap, type MindNode } from './mindmap'
import {
  branchCurves,
  centerMapTopics,
  fitMapZoom,
  unscaledRect,
  visibleMapTopics,
  type BranchCurve,
} from './mindmapLayout'
export interface MindMapCanvasHandle {
  fit: () => void
}
interface Props {
  map: MindMap
  view: 'map' | 'outline'
  zoom: number
  selectedId: string
  searchQuery: string
  readOnly: boolean
  onZoomChange: (zoom: number) => void
  onSelect: (id: string) => void
  onTextChange: (id: string, text: string) => void
  onTextEditStart: () => void
  onTextEditEnd: (cancel: boolean) => void
  onToggle: (node: MindNode) => void
}
export const MindMapCanvas = forwardRef<MindMapCanvasHandle, Props>(
  function MindMapCanvas(
    {
      map,
      view,
      zoom,
      selectedId,
      searchQuery,
      readOnly,
      onZoomChange,
      onSelect,
      onTextChange,
      onTextEditStart,
      onTextEditEnd,
      onToggle,
    },
    ref,
  ) {
    const { t } = useTranslation()
    const canvasRef = useRef<HTMLDivElement>(null)
    const forestRef = useRef<HTMLDivElement>(null)
    const treesRef = useRef<HTMLDivElement>(null)
    const buttons = useRef(new Map<string, HTMLElement>())
    const rows = useRef(new Map<string, HTMLDivElement>())
    const inputRef = useRef<HTMLTextAreaElement>(null)
    type TextEdit = { id: string; text: string }
    const [editing, setEditing] = useState<TextEdit | null>(null)
    const editRef = useRef<TextEdit | null>(null)
    const initialFit = useRef(false)
    const centerRoot = useRef(false)
    const [curves, setCurves] = useState<BranchCurve[]>([])
    const topics = useMemo(() => visibleMapTopics(map), [map])
    const colors = useMemo(
      () => new Map(topics.map((topic) => [topic.id, topic.color])),
      [topics],
    )
    const nodes = useMemo(
      () => new Map(flattenNodes(map).map(({ node }) => [node.id, node])),
      [map],
    )
    const activeEdit =
      !readOnly &&
      editing?.id === selectedId &&
      nodes.get(editing.id)?.text === editing.text
        ? editing
        : null
    function startEditing(node: MindNode) {
      onSelect(node.id)
      if (readOnly) return
      onTextEditStart()
      editRef.current = { id: node.id, text: node.text }
      setEditing(editRef.current)
    }
    function finishEditing(cancel = false, restoreFocus = false) {
      const edit = editRef.current
      editRef.current = null
      setEditing(null)
      if (activeEdit && edit) onTextEditEnd(cancel)
      if (restoreFocus) canvasRef.current?.focus({ preventScroll: true })
    }
    useEffect(() => {
      if (editing && !activeEdit) {
        editRef.current = null
        setEditing(null)
      }
    }, [editing, activeEdit])
    useLayoutEffect(() => {
      if (activeEdit) {
        inputRef.current?.focus({ preventScroll: true })
        inputRef.current?.select()
      }
    }, [activeEdit?.id])
    function fit(minimum = 0.2) {
      const canvas = canvasRef.current,
        trees = treesRef.current
      if (!canvas || !trees || !canvas.clientWidth || !canvas.clientHeight)
        return
      onZoomChange(
        Math.max(
          minimum,
          fitMapZoom(
            { width: trees.offsetWidth, height: trees.offsetHeight },
            { width: canvas.clientWidth, height: canvas.clientHeight },
          ),
        ),
      )
      canvas.scrollTo?.({ top: 0, left: 0 })
    }
    useImperativeHandle(ref, () => ({ fit: () => fit() }))
    useLayoutEffect(() => {
      const canvas = canvasRef.current,
        forest = forestRef.current,
        trees = treesRef.current
      for (const row of rows.current.values()) row.style.transform = ''
      if (!canvas || !forest || !trees || view !== 'map') {
        setCurves([])
        return
      }
      function measure() {
        if (!forest || !canvas) return
        // Measure without the previous correction so repeated measurements cannot drift.
        for (const row of rows.current.values()) row.style.transform = ''
        const origin = forest.getBoundingClientRect()
        const scale =
          forest.offsetWidth > 0 ? origin.width / forest.offsetWidth : zoom
        if (!scale) return
        const rectangles = new Map(
          Array.from(buttons.current, ([id, button]) => [
            id,
            unscaledRect(button.getBoundingClientRect(), origin, scale),
          ]),
        )
        const centered = centerMapTopics(topics, rectangles)
        for (const [id, rect] of centered) {
          const row = rows.current.get(id)
          const original = rectangles.get(id)
          if (row && original)
            row.style.transform = `translateY(${rect.top - original.top}px)`
        }
        const next = branchCurves(topics, centered)
        setCurves((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        )
        if (
          !initialFit.current &&
          canvas.clientWidth > 0 &&
          canvas.clientHeight > 0
        ) {
          initialFit.current = true
          centerRoot.current = true
          // Keep the first view readable; the Fit button still provides a full overview.
          fit(0.75)
        } else if (centerRoot.current) {
          centerRoot.current = false
          const root = buttons.current
            .get(map.roots[0].id)
            ?.getBoundingClientRect()
          if (root)
            canvas.scrollTo?.({
              top: Math.max(
                0,
                canvas.scrollTop +
                  root.top -
                  canvas.getBoundingClientRect().top +
                  root.height / 2 -
                  canvas.clientHeight / 2,
              ),
              left: 0,
            })
        }
      }
      measure()
      const observer =
        typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver(measure)
          : null
      observer?.observe(canvas)
      observer?.observe(forest)
      // Late font loading may change a short label without changing the forest bounds.
      let active = true
      document.fonts?.ready.then(() => {
        if (active) measure()
      })
      window.addEventListener('resize', measure)
      return () => {
        active = false
        observer?.disconnect()
        window.removeEventListener('resize', measure)
      }
    }, [topics, view, zoom, activeEdit?.id, activeEdit?.text])
    function renderNode(node: MindNode, depth: number) {
      return (
        <div
          key={node.id}
          className={`mindmap-branch ${depth === 0 ? 'root-branch' : ''}`}
          style={{ '--branch-color': colors.get(node.id) } as CSSProperties}
        >
          <div
            className="mindmap-topic-row"
            ref={(element) => {
              if (element) rows.current.set(node.id, element)
              else rows.current.delete(node.id)
            }}
          >
            {activeEdit?.id === node.id ? (
              <div
                ref={(element) => {
                  if (element) buttons.current.set(node.id, element)
                  else buttons.current.delete(node.id)
                }}
                className={`mindmap-topic selected editing ${depth === 0 ? 'root-topic' : ''}`}
                data-mindmap-node={node.id}
              >
                <span className="mindmap-inline-mirror" aria-hidden="true">
                  {activeEdit.text + '\u00a0'}
                </span>
                <textarea
                  ref={inputRef}
                  className="mindmap-inline-input"
                  aria-label={t('mindmap.nodeText')}
                  title={t('mindmap.editHint')}
                  rows={1}
                  value={activeEdit.text}
                  onChange={(event) => {
                    const next = { ...activeEdit, text: event.target.value }
                    editRef.current = next
                    setEditing(next)
                    onTextChange(node.id, next.text)
                  }}
                  onBlur={() => finishEditing()}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229)
                      return
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      finishEditing(true, true)
                    } else if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      event.stopPropagation()
                      finishEditing(false, true)
                    }
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                ref={(element) => {
                  if (element) buttons.current.set(node.id, element)
                  else buttons.current.delete(node.id)
                }}
                className={`mindmap-topic ${node.id === selectedId ? 'selected' : ''} ${depth === 0 ? 'root-topic' : ''}`}
                data-mindmap-node={node.id}
                aria-pressed={node.id === selectedId}
                aria-label={!node.text ? t('mindmap.emptyNode') : undefined}
                title={t('mindmap.editHint')}
                onClick={() => startEditing(node)}
                onKeyDown={(event) => {
                  if (event.key === 'F2') {
                    event.preventDefault()
                    startEditing(node)
                  }
                }}
              >
                <HighlightedText
                  text={node.text || '\u00a0'}
                  query={searchQuery}
                />
                {node.note && (
                  <span className="mindmap-note-mark" title={node.note}>
                    ⋯
                  </span>
                )}
              </button>
            )}
            {node.children.length > 0 && (
              <button
                type="button"
                className={`mindmap-fold ${node.collapsed ? 'is-collapsed' : ''}`}
                disabled={readOnly}
                aria-label={t(
                  node.collapsed ? 'mindmap.expand' : 'mindmap.collapse',
                )}
                onClick={() => onToggle(node)}
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
    return (
      <div
        ref={canvasRef}
        className="mindmap-canvas"
        tabIndex={0}
        aria-label={t('mindmap.canvas')}
      >
        <div
          ref={forestRef}
          className={`mindmap-forest ${view}`}
          style={{ zoom }}
        >
          {view === 'map' && (
            <svg
              className="mindmap-curves"
              aria-hidden="true"
              focusable="false"
            >
              {curves.map((curve) => (
                <path
                  key={curve.id}
                  data-branch-target={curve.id}
                  d={curve.d}
                  stroke={curve.color}
                  strokeWidth={curve.width}
                  fill="none"
                  strokeLinecap="round"
                />
              ))}
            </svg>
          )}
          <div ref={treesRef} className="mindmap-trees">
            {map.roots.map((root) => renderNode(root, 0))}
          </div>
        </div>
      </div>
    )
  },
)
