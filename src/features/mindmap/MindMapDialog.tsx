import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isTauri } from '@tauri-apps/api/core'
import {
  createMindMap,
  flattenNodes,
  importMindMap,
  importNativeMindNode,
  MindMapError,
  type ImportedMap,
  type MindMap,
} from './mindmap'
import {
  pickMindMapFiles,
  readBrowserMapFile,
  type MapFile,
} from './mindmapFiles'
import './mindmap.css'
export interface MapCreation {
  title: string
  map: MindMap
}
interface Props {
  onClose: () => void
  onCreate: (item: MapCreation) => Promise<void>
  canCreate: boolean
}
interface ImportItem {
  name: string
  imported?: ImportedMap
  error?: string
  done?: boolean
}
export function MindMapDialog({ onClose, onCreate, canCreate }: Props) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState('')
  useEffect(() => {
    dialogRef.current?.querySelector('input')?.focus()
  }, [])
  const [items, setItems] = useState<ImportItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const working = useRef(false)
  const message = (code: string) =>
    t(
      `mindmap.errors.${['invalid', 'limit', 'version', 'mindnode', 'format', 'xml', 'read', 'batch', 'mindnodeVersion', 'mindnodeSchema', 'mindnodeDesktop'].includes(code) ? code : 'read'}`,
    )
  async function load(files: MapFile[]) {
    const next = files.map((file) => {
      if (file.error) return { name: file.name, error: message(file.error) }
      try {
        return {
          name: file.name,
          imported: file.mindnode
            ? importNativeMindNode(file.name, file.mindnode)
            : importMindMap(file.name, file.content ?? ''),
        }
      } catch (error) {
        return {
          name: file.name,
          error: message(
            error instanceof MindMapError ? error.code : 'invalid',
          ),
        }
      }
    })
    setItems(next)
  }
  async function pick(packages = false) {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    try {
      const files = await pickMindMapFiles(packages)
      if (files.length) await load(files)
    } catch (error) {
      setError(message(typeof error === 'string' ? error : 'read'))
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  async function create() {
    if (working.current || !title.trim()) return
    working.current = true
    setBusy(true)
    setError('')
    try {
      await onCreate({ title: title.trim(), map: createMindMap(title.trim()) })
      onClose()
    } catch (error) {
      setError(String(error))
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  async function importAll() {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    const next = [...items]
    for (let index = 0; index < next.length; index++) {
      const item = next[index]
      if (!item.imported || item.done) continue
      try {
        await onCreate(item.imported)
        next[index] = { ...item, done: true, error: undefined }
      } catch (error) {
        next[index] = { ...item, error: String(error) }
        break
      }
      setItems([...next])
    }
    setItems(next)
    working.current = false
    setBusy(false)
    // Keep results visible so partial success and skipped files are reviewable.
  }
  return (
    <dialog
      ref={(node) => {
        dialogRef.current = node
        if (node && !node.open) node.showModal()
      }}
      className="modal mindmap-dialog"
      aria-labelledby="mindmap-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!working.current) onClose()
      }}
    >
      <div className="modal-box">
        <div className="editor-title-row">
          <h2 id="mindmap-dialog-title" className="text-lg font-bold">
            {t('mindmap.title')}
          </h2>
          <button
            className="btn btn-sm btn-circle btn-ghost"
            aria-label={t('mindmap.close')}
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {!canCreate && (
          <p role="alert" className="mindmap-error">
            {t('mindmap.openVault')}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
          className="mindmap-create-form"
        >
          <label>
            {t('mindmap.noteTitle')}
            <input
              autoFocus
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !canCreate || !title.trim()}
          >
            {t('mindmap.create')}
          </button>
        </form>
        <hr />
        <h3 className="font-semibold">{t('mindmap.import')}</h3>
        <p className="mindmap-hint">{t('mindmap.importHint')}</p>
        <p className="mindmap-hint">{t('mindmap.mindnodeHint')}</p>
        {isTauri() ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={busy} onClick={() => void pick()}>
              {t('mindmap.chooseFiles')}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => void pick(true)}
            >
              {t('mindmap.choosePackage')}
            </button>
          </div>
        ) : (
          <label className="mindmap-file-picker">
            {t('mindmap.chooseFiles')}
            <input
              type="file"
              accept=".mm,.opml,.inote-mindmap,.json,.mindnode"
              multiple
              disabled={busy}
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                if (!files.length || working.current) return
                if (files.length > 100) {
                  setError(t('mindmap.errors.batch'))
                  return
                }
                working.current = true
                setBusy(true)
                setError('')
                try {
                  const read: MapFile[] = []
                  for (const file of files) {
                    try {
                      read.push(await readBrowserMapFile(file))
                    } catch {
                      read.push({ name: file.name, error: 'read' })
                    }
                  }
                  await load(read)
                } finally {
                  working.current = false
                  setBusy(false)
                }
              }}
            />
          </label>
        )}
        <ul className="mindmap-import-list">
          {items.map((item, index) => (
            <li key={index}>
              <strong>{item.name}</strong>
              {item.done ? (
                <span className="text-success"> · {t('mindmap.imported')}</span>
              ) : item.imported ? (
                <span>
                  {' '}
                  · {flattenNodes(item.imported.map).length}{' '}
                  {t('mindmap.nodes')}
                </span>
              ) : null}
              {item.imported?.warnings.map((warning) => (
                <p className="mindmap-hint" key={warning}>
                  {t(`mindmap.warnings.${warning}`)}
                </p>
              ))}
              {item.error && (
                <p className="mindmap-error" role="alert">
                  {item.error}
                </p>
              )}
            </li>
          ))}
        </ul>
        {error && (
          <p className="mindmap-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-action">
          <button className="btn" disabled={busy} onClick={onClose}>
            {t('mindmap.close')}
          </button>
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              !canCreate ||
              !items.some((item) => item.imported && !item.done)
            }
            onClick={() => void importAll()}
          >
            {busy ? t('mindmap.working') : t('mindmap.importAll')}
          </button>
        </div>
      </div>
    </dialog>
  )
}
