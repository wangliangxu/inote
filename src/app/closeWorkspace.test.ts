import { describe, expect, it, vi } from 'vitest'
import { prepareWorkspaceClose } from './closeWorkspace'
import { demoNotes } from '../shared/fixtures'

describe('closing the workspace', () => {
  it('saves every dirty note, including notes outside the active editor', async () => {
    let notes = demoNotes.map((note) => ({ ...note, isDirty: true }))
    const save = vi.fn(async (note) => { notes = notes.map((item) => item.path === note.path ? { ...item, isDirty: false } : item) })
    const persistDrafts = vi.fn(async () => undefined)
    expect(await prepareWorkspaceClose({ autoSave: true, getNotes: () => notes, save, persistDrafts, confirmClose: vi.fn() })).toBe(true)
    expect(save).toHaveBeenCalledTimes(3)
    expect(persistDrafts).toHaveBeenLastCalledWith([])
  })
  it('keeps the window open if a save fails or new edits arrive while closing', async () => {
    const notes = [{ ...demoNotes[0], isDirty: true }]
    const input = { autoSave: true, getNotes: () => notes, persistDrafts: vi.fn(async () => undefined), confirmClose: vi.fn() }
    await expect(prepareWorkspaceClose({ ...input, save: vi.fn(async () => { throw new Error('conflict') }) })).rejects.toThrow('conflict')
    await expect(prepareWorkspaceClose({ ...input, save: vi.fn(async () => undefined) })).rejects.toThrow('仍有未保存')
  })
  it('persists drafts before asking to close when autosave is disabled', async () => {
    const sequence: string[] = []
    expect(await prepareWorkspaceClose({ autoSave: false, getNotes: () => [{ ...demoNotes[0], isDirty: true }], save: vi.fn(), persistDrafts: async () => { sequence.push('persist') }, confirmClose: async () => { sequence.push('confirm'); return false } })).toBe(false)
    expect(sequence).toEqual(['persist', 'confirm'])
  })
})
