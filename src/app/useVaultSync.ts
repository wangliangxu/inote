import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { listen } from '@tauri-apps/api/event'
import { allowVaultAssets, migrateNoteImages, readNote, refreshVaultPaths, saveNoteDrafts, startVaultWatcher, stopVaultWatcher } from '../shared/api'
import { createSerialQueue, mergeDiskDelta } from '../shared/notePersistence'
import type { Note } from '../shared/types'

interface VaultSyncInput {
  vaultRoot: string
  notes: Note[]
  notesRef: MutableRefObject<Note[]>
  activeNote?: Note
  settingsLoaded: boolean
  loadedRoot: MutableRefObject<string>
  vaultRef: MutableRefObject<string>
  queue: MutableRefObject<ReturnType<typeof createSerialQueue>>
  setNotes: Dispatch<SetStateAction<Note[]>>
  setLinkVersion: Dispatch<SetStateAction<number>>
  setStatus: Dispatch<SetStateAction<string>>
  setActivePath?: Dispatch<SetStateAction<string>>
}

export function useVaultSync({ vaultRoot, notes, notesRef, activeNote, settingsLoaded, loadedRoot, vaultRef, queue, setNotes, setLinkVersion, setStatus, setActivePath }: VaultSyncInput) {
  useEffect(() => {
    const root = vaultRoot.trim()
    if (!root) return
    let disposed = false
    const subscription = listen<{ paths: string[] }>('vault://changed', ({ payload }) => {
      if (disposed) return
      queue.current(async () => {
        if (disposed) return
        const changed = await refreshVaultPaths(root, payload.paths)
        if (disposed || vaultRef.current.trim() !== root) return
        const next = mergeDiskDelta(notesRef.current, changed)
        setNotes(next)
        setActivePath?.((path) => next.some((note) => note.path === path) ? path : next[0]?.path ?? '')
        setLinkVersion((version) => version + 1)
      }).catch((error) => { if (!disposed) setStatus(String(error)) })
    })
    subscription.then(() => { if (!disposed) return allowVaultAssets(root).then(() => { if (!disposed) return startVaultWatcher(root) }) }).catch((error) => { if (!disposed) setStatus(String(error)) })
    return () => {
      disposed = true
      subscription.then((unsubscribe) => unsubscribe()).catch(() => undefined)
      void stopVaultWatcher().catch(() => undefined)
    }
  }, [vaultRoot, queue, setNotes, setLinkVersion, setStatus, setActivePath, notesRef, vaultRef])

  useEffect(() => {
    const root = loadedRoot.current
    if (!root || !settingsLoaded || root !== vaultRoot.trim()) return
    const timeout = window.setTimeout(() => {
      queue.current(() => vaultRef.current.trim() === root ? saveNoteDrafts(root, notesRef.current.filter((note) => note.isDirty)) : Promise.resolve()).catch((error) => setStatus(`Draft recovery save failed: ${String(error)}`))
    }, 200)
    return () => window.clearTimeout(timeout)
  }, [notes, vaultRoot, settingsLoaded, queue, loadedRoot, notesRef, vaultRef, setStatus])

  useEffect(() => {
    if (!activeNote || activeNote.bodyLoaded !== false || !vaultRoot.trim()) return
    const root = vaultRoot.trim()
    const path = activeNote.path
    let cancelled = false
    readNote(root, path).then(async (loaded) => {
      if (cancelled) return
      if (loaded.body.includes('data:image/')) loaded = await migrateNoteImages({ vaultRoot: root, notePath: path }) ?? loaded
      if (cancelled || vaultRef.current.trim() !== root) return
      setNotes((current) => current.map((note) => note.path === path && !note.isDirty ? loaded : note))
    }).catch((error) => { if (!cancelled) setStatus(String(error)) })
    return () => { cancelled = true }
  }, [activeNote?.path, activeNote?.sourceRevision, activeNote?.bodyLoaded, vaultRoot, setNotes, setStatus, vaultRef])
}
