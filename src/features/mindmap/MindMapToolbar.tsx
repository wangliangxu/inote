import { useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  Ellipsis,
  FoldHorizontal,
  FolderInput,
  ListPlus,
  ListTree,
  Maximize2,
  Network,
  PanelRight,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Share2,
  StickyNote,
  TextCursorInput,
  Trash2,
  Undo2,
  UnfoldHorizontal,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'
export type MindMapExportFormat = 'json' | 'mm' | 'opml' | 'md'
interface Props {
  view: 'map' | 'outline'
  zoom: number
  readOnly: boolean
  canUndo: boolean
  canRedo: boolean
  canFold: boolean
  collapsed: boolean
  inspectorOpen: boolean
  onView: (view: 'map' | 'outline') => void
  onUndo: () => void
  onRedo: () => void
  onAddChild: () => void
  onAddSibling: () => void
  onFold: () => void
  onNotes: () => void
  onInspector: () => void
  onFit: () => void
  onZoom: (zoom: number) => void
  onExport: (format: MindMapExportFormat) => void
  onSave?: () => void
  onRename?: () => void
  onMove?: () => void
  onCheckExternal?: () => void
  onDelete?: () => void
}
function Tool({
  label,
  icon: Icon,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  icon: LucideIcon
}) {
  return (
    <button
      type="button"
      className={`mindmap-tool ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
    </button>
  )
}
export function MindMapToolbar(props: Props) {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<'export' | 'more' | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const exportTrigger = useRef<HTMLButtonElement>(null)
  const moreTrigger = useRef<HTMLButtonElement>(null)
  function dismiss() {
    const trigger =
      menu === 'export' ? exportTrigger.current : moreTrigger.current
    setMenu(null)
    trigger?.focus()
  }
  useEffect(() => {
    if (!menu) return
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setMenu(null)
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismiss()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [menu])
  function menuKeys(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    )
    if (!items.length) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
            items.length
    items[next]?.focus()
  }
  const moreActions = [
    {
      label: t('editor.renameNote'),
      icon: TextCursorInput,
      action: props.onRename,
    },
    { label: t('editor.moveNote'), icon: FolderInput, action: props.onMove },
    {
      label: t('editor.checkFile'),
      icon: RefreshCw,
      action: props.onCheckExternal,
    },
    {
      label: t('editor.delete'),
      icon: Trash2,
      action: props.onDelete,
      danger: true,
    },
  ].filter((item) => !!item.action)
  const formats: {
    value: MindMapExportFormat
    label: string
    detail: string
  }[] = [
    { value: 'json', label: t('mindmap.backup'), detail: 'iNote JSON' },
    { value: 'mm', label: 'FreeMind', detail: '.mm' },
    { value: 'opml', label: 'OPML', detail: '.opml' },
    { value: 'md', label: 'Markdown', detail: '.md' },
  ]
  return (
    <div
      ref={root}
      className="mindmap-toolbar"
      role="toolbar"
      aria-label={t('mindmap.title')}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setMenu(null)
      }}
    >
      <div
        className="mindmap-toolgroup"
        role="group"
        aria-label={t('mindmap.viewTools')}
      >
        <Tool
          label={t('mindmap.map')}
          icon={Network}
          aria-pressed={props.view === 'map'}
          onClick={() => props.onView('map')}
        />
        <Tool
          label={t('mindmap.outline')}
          icon={ListTree}
          aria-pressed={props.view === 'outline'}
          onClick={() => props.onView('outline')}
        />
      </div>
      <div
        className="mindmap-toolgroup"
        role="group"
        aria-label={t('mindmap.historyTools')}
      >
        <Tool
          label={t('mindmap.undo')}
          icon={Undo2}
          disabled={props.readOnly || !props.canUndo}
          onClick={props.onUndo}
        />
        <Tool
          label={t('mindmap.redo')}
          icon={Redo2}
          disabled={props.readOnly || !props.canRedo}
          onClick={props.onRedo}
        />
      </div>
      <div
        className="mindmap-toolgroup"
        role="group"
        aria-label={t('mindmap.nodeTools')}
      >
        <Tool
          label={t('mindmap.addChild')}
          icon={Plus}
          className="mindmap-tool-primary"
          disabled={props.readOnly}
          onClick={props.onAddChild}
        />
        <Tool
          label={t('mindmap.addSibling')}
          icon={ListPlus}
          disabled={props.readOnly}
          onClick={props.onAddSibling}
        />
        <Tool
          label={t(
            props.collapsed ? 'mindmap.expandSelected' : 'mindmap.foldSelected',
          )}
          icon={props.collapsed ? UnfoldHorizontal : FoldHorizontal}
          disabled={props.readOnly || !props.canFold}
          onClick={props.onFold}
        />
      </div>
      <div
        className="mindmap-toolgroup mindmap-toolgroup-zoom"
        role="group"
        aria-label={t('mindmap.zoomTools')}
      >
        <Tool
          label={t('mindmap.zoomOut')}
          icon={ZoomOut}
          disabled={props.zoom <= 0.2}
          onClick={() => props.onZoom(Math.max(0.2, props.zoom - 0.1))}
        />
        <button
          className="mindmap-tool mindmap-zoom-value"
          type="button"
          title={t('mindmap.resetZoom')}
          onClick={() => props.onZoom(1)}
        >
          {Math.round(props.zoom * 100)}%
        </button>
        <Tool
          label={t('mindmap.zoomIn')}
          icon={ZoomIn}
          disabled={props.zoom >= 2}
          onClick={() => props.onZoom(Math.min(2, props.zoom + 0.1))}
        />
        <Tool label={t('mindmap.fit')} icon={Maximize2} onClick={props.onFit} />
      </div>
      <div
        className="mindmap-toolgroup mindmap-toolgroup-details"
        role="group"
        aria-label={t('mindmap.nodeDetails')}
      >
        <Tool
          label={t('mindmap.editNotes')}
          icon={StickyNote}
          onClick={props.onNotes}
        />
        <Tool
          label={t('mindmap.nodeDetails')}
          icon={PanelRight}
          aria-pressed={props.inspectorOpen}
          onClick={props.onInspector}
        />
      </div>
      <div
        className="mindmap-toolgroup mindmap-toolgroup-files"
        role="group"
        aria-label={t('mindmap.fileTools')}
      >
        {props.onSave && (
          <Tool label={t('editor.save')} icon={Save} onClick={props.onSave} />
        )}
        <div className="mindmap-tool-menu-anchor">
          <button
            ref={exportTrigger}
            className="mindmap-tool mindmap-tool-export"
            type="button"
            aria-label={t('mindmap.export')}
            title={t('mindmap.export')}
            aria-haspopup="menu"
            aria-expanded={menu === 'export'}
            onClick={() => setMenu(menu === 'export' ? null : 'export')}
          >
            <Share2 size={18} strokeWidth={1.7} aria-hidden="true" />
            <ChevronDown size={10} aria-hidden="true" />
          </button>
          {menu === 'export' && (
            <div
              className="mindmap-tool-menu mindmap-export-menu"
              role="menu"
              aria-label={t('mindmap.export')}
              onKeyDown={menuKeys}
            >
              {formats.map((format) => (
                <button
                  key={format.value}
                  type="button"
                  role="menuitem"
                  className="mindmap-export-item"
                  onClick={() => {
                    dismiss()
                    props.onExport(format.value)
                  }}
                >
                  <span className="mindmap-export-item-title">
                    {format.label}
                    <small>{format.detail}</small>
                  </span>
                  <span className="mindmap-export-item-description">
                    {t(`mindmap.exportHints.${format.value}`)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {moreActions.length > 0 && (
          <div className="mindmap-tool-menu-anchor">
            <button
              ref={moreTrigger}
              className="mindmap-tool"
              type="button"
              aria-label={t('mindmap.more')}
              title={t('mindmap.more')}
              aria-haspopup="menu"
              aria-expanded={menu === 'more'}
              onClick={() => setMenu(menu === 'more' ? null : 'more')}
            >
              <Ellipsis size={18} aria-hidden="true" />
            </button>
            {menu === 'more' && (
              <div
                className="mindmap-tool-menu"
                role="menu"
                aria-label={t('mindmap.more')}
                onKeyDown={menuKeys}
              >
                {moreActions.map(({ label, icon: Icon, action, danger }) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    className={danger ? 'mindmap-menu-danger' : ''}
                    onClick={() => {
                      dismiss()
                      action?.()
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
