import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeDiskNotes } from '../shared/notePersistence'
import { demoNotes } from '../shared/fixtures'

describe('note deletion controls', () => {


  it('does not do a full index rebuild after deleting a note', () => {
    const source = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const deleteHandler = source.match(/async function deleteNoteByPath[\s\S]*?\n  }/)?.[0] ?? ''

    expect(deleteHandler).toContain('await deleteNote(vaultRoot.trim(), path)')
    expect(deleteHandler).not.toContain('rebuildSearchIndex(vaultRoot.trim())')
  })

  it('accepts the deletion refresh while keeping unrelated local drafts', () => {
    const draft = { ...demoNotes[1], isDirty: true, body: 'unsaved' }
    const remaining = [demoNotes[0], draft].filter((note) => note.path !== demoNotes[0].path)
    const disk = [{ ...draft, isDirty: false, body: 'disk' }]
    const refreshed = mergeDiskNotes(remaining, disk)
    expect(refreshed).toEqual([draft])
    expect(refreshed.some((note) => note.path === demoNotes[0].path)).toBe(false)
  })
})
