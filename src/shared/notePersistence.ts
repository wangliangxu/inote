import type { Note, VaultDelta } from './types'

/** Keep local drafts when a disk refresh arrives, including externally deleted notes. */
export function mergeDiskNotes(current: Note[], disk: Note[]): Note[] {
  const local = new Map(current.map((note) => [note.path, note]))
  const paths = new Set(disk.map((note) => note.path))
  return [
    ...disk.map((note) => {
      const draft = local.get(note.path)
      if (draft?.isDirty) return draft
      if (draft?.sourceRevision && draft.sourceRevision === note.sourceRevision && (draft.bodyLoaded !== false || note.bodyLoaded === false)) return draft
      return note
    }),
    ...current.filter((note) => note.isDirty && !paths.has(note.path)),
  ]
}

export function mergeDiskDelta(current: Note[], delta: VaultDelta): Note[] {
  const changed = new Map(delta.notes.map((note) => [note.path, note]))
  const removed = new Set(delta.removedPaths)
  const next: Note[] = []
  for (const note of current) {
    const update = changed.get(note.path)
    changed.delete(note.path)
    if (note.isDirty) next.push(note)
    else if (update) next.push(mergeDiskNotes([note], [update])[0])
    else if (!removed.has(note.path)) next.push(note)
  }
  next.push(...changed.values())
  return next
}

/** A save acknowledges only the version submitted, never edits made while awaiting IPC. */
export function acknowledgeSave(current: Note[], submitted: Note, saved: Note): Note[] {
  return current.map((note) => {
    if (note.path !== submitted.path) return note
    if (editableRevision(note) === editableRevision(submitted)) return { ...saved, isDirty: false }
    const taskChangedDuringSave = saved.due !== submitted.due || saved.status !== submitted.status
    return {
      ...note, path: saved.path,
      // Keep newer system values for fields the user did not edit while saving.
      due: note.due === submitted.due ? saved.due : note.due,
      status: note.status === submitted.status ? saved.status : note.status,
      sourceRevision: note.rawMarkdown !== undefined && taskChangedDuringSave ? note.sourceRevision : saved.sourceRevision,
      isDirty: true,
    }
  })
}

export function editableRevision(note: Note): string {
  const { isDirty: _dirty, sourceRevision: _source, sourceSize: _size, bodyLoaded: _loaded, excerpt: _excerpt, ...content } = note
  return JSON.stringify(content)
}

export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = tail.then(task, task)
    tail = next.catch(() => undefined)
    return next
  }
}
