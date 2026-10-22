import { useCallback, useRef, useState } from 'react'
import type { Note } from '../shared/types'
import { mergeDiskNotes } from '../shared/notePersistence'

/** All updates, including IPC completions, share the same current draft collection. */
export function useNoteWorkspace(initialNotes: Note[], vaultRoot: string) {
  const [notes, updateNotes] = useState(initialNotes)
  const notesRef = useRef(notes)
  const vaultRef = useRef(vaultRoot)
  vaultRef.current = vaultRoot
  const setNotes: typeof updateNotes = useCallback((update) => {
    const next = typeof update === 'function' ? update(notesRef.current) : update
    notesRef.current = next
    updateNotes(next)
  }, [])
  return { notes, setNotes, notesRef, vaultRef, mergeDiskNotes }
}
