import { describe, expect, it } from 'vitest'
import { acknowledgeSave, createSerialQueue, mergeDiskDelta, mergeDiskNotes } from './notePersistence'
import { demoNotes } from './fixtures'

describe('note persistence', () => {
  const base = { ...demoNotes[0], sourceRevision: 'disk-v1' }
  it('keeps edited and externally deleted drafts when disk state refreshes', () => {
    const draft = { ...base, body: 'local draft', isDirty: true }
    expect(mergeDiskNotes([draft], [{ ...base, body: 'external change', sourceRevision: 'disk-v2' }])[0]).toBe(draft)
    expect(mergeDiskNotes([draft], [])).toEqual([draft])
    expect(mergeDiskNotes([base], [])).toEqual([])
  })
  it('retains a hydrated body when the summary revision is unchanged', () => {
    const summary = { ...base, body: '', bodyLoaded: false }
    expect(mergeDiskNotes([base], [summary])[0]).toBe(base)
    expect(mergeDiskNotes([base], [{ ...summary, sourceRevision: 'changed' }])[0].bodyLoaded).toBe(false)
  })
  it('applies small deltas without replacing unrelated notes or discarding deleted drafts', () => {
    const unchanged = { ...demoNotes[1], sourceRevision: 'other' }
    const draft = { ...base, isDirty: true }
    const next = mergeDiskDelta([draft, unchanged], { notes: [], removedPaths: [base.path] })
    expect(next).toEqual([draft, unchanged])
    expect(next[1]).toBe(unchanged)
    expect(mergeDiskDelta([base, unchanged], { notes: [], removedPaths: [base.path] })).toEqual([unchanged])
  })
  it('preserves typing that happens while saving and advances its disk base', () => {
    const submitted = { ...base, isDirty: true }
    const later = { ...submitted, body: 'typed during IPC' }
    const saved = { ...base, sourceRevision: 'disk-v2' }
    expect(acknowledgeSave([later], submitted, saved)[0]).toMatchObject({ body: later.body, isDirty: true, sourceRevision: 'disk-v2' })
    expect(acknowledgeSave([submitted], submitted, saved)[0]).toMatchObject({ isDirty: false, sourceRevision: 'disk-v2' })
  })
  it('merges system date and completion changes while preserving text typed during a save', () => {
    const submitted = { ...base, due: '2030-01-01T09:00', status: 'in_progress', isDirty: true }
    const later = { ...submitted, body: 'typed during system sync' }
    const saved = { ...submitted, due: '2030-02-02T10:00', status: 'done', sourceRevision: 'system-v2' }
    expect(acknowledgeSave([later], submitted, saved)[0]).toMatchObject({ body: later.body, due: saved.due, status: 'done', sourceRevision: 'system-v2', isDirty: true })
    const editedDate = { ...later, due: '2030-03-03T11:00' }
    expect(acknowledgeSave([editedDate], submitted, saved)[0].due).toBe(editedDate.due)
    const rawDraft = { ...later, rawMarkdown: '---\ntitle: [unfinished' }
    expect(acknowledgeSave([rawDraft], submitted, saved)[0].sourceRevision).toBe('disk-v1')
  })
  it('retains edits and changes the path when an in-flight save moves the note', () => {
    const later = { ...base, title: 'New title', isDirty: true }
    expect(acknowledgeSave([later], base, { ...base, path: 'new/a.md', sourceRevision: 'moved' })[0]).toMatchObject({ title: later.title, path: 'new/a.md', isDirty: true })
  })
  it('serializes work and continues after a failed operation', async () => {
    const queue = createSerialQueue()
    const events: string[] = []
    let release!: () => void
    const first = queue(async () => { events.push('first'); await new Promise<void>((resolve) => { release = resolve }); throw new Error('failed') })
    const failure = first.catch(() => undefined)
    const second = queue(async () => { events.push('second'); return 42 })
    await Promise.resolve()
    expect(events).toEqual(['first'])
    release()
    await failure
    expect(await second).toBe(42)
    expect(events).toEqual(['first', 'second'])
  })
})
