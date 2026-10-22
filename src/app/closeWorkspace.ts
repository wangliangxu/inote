import type { Note } from '../shared/types'

interface CloseWorkspaceInput {
  autoSave: boolean
  getNotes: () => Note[]
  save: (note: Note) => Promise<unknown>
  persistDrafts: (notes: Note[]) => Promise<void>
  confirmClose: () => Promise<boolean>
}

export async function prepareWorkspaceClose({ autoSave, getNotes, save, persistDrafts, confirmClose }: CloseWorkspaceInput): Promise<boolean> {
  await persistDrafts(getNotes().filter((note) => note.isDirty))
  if (autoSave) {
    for (const note of getNotes().filter((note) => note.isDirty)) await save(note)
  } else if (getNotes().some((note) => note.isDirty) && !await confirmClose()) return false
  const remaining = getNotes().filter((note) => note.isDirty)
  await persistDrafts(remaining)
  if (autoSave && remaining.length) throw new Error('仍有未保存的编辑，请保存后再退出。')
  return true
}
