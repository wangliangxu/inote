// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true, Channel: class {} }))
import { commitNote, deleteNote, refreshVaultPaths, undoAgentChange } from '../../shared/api'
import { getReminderConflicts, getReminderError, resolveReminderConflict, syncReminders } from './reminders'

beforeEach(() => { invoke.mockReset() })

describe('reminder sync after persistence', () => {
  it('retains a successful note save when authorization or system sync fails', async () => {
    const saved = { path: 'task.md', title: 'Task' }
    invoke.mockImplementation(async (command) => {
      if (command === 'commit_note') return saved
      throw 'Reminders access denied'
    })
    expect(await commitNote({ vaultRoot: '/saved', path: 'task.md', content: 'body' })).toBe(saved)
    expect(getReminderError('/saved')).toContain('access denied')
    expect(invoke).toHaveBeenNthCalledWith(2, 'sync_note_reminder', { vaultRoot: '/saved', oldPath: 'task.md', path: 'task.md' })
    invoke.mockResolvedValue({ updated: 1, errors: [] })
    await syncReminders('/saved')
    expect(getReminderError('/saved')).toBe('')
  })
  it('coalesces overlapping full-sync requests for the same vault', async () => {
    let finish!: (value: { updated: number; errors: string[] }) => void
    invoke.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const first = syncReminders('/coalesced')
    const second = syncReminders('/coalesced')
    expect(first).toBe(second)
    expect(invoke).toHaveBeenCalledTimes(1)
    finish({ updated: 0, errors: [] })
    await first
  })
  it('does not sync failed disk writes', async () => {
    invoke.mockRejectedValue('revision conflict')
    await expect(commitNote({ vaultRoot: '/failed', path: 'a.md', content: 'draft' })).rejects.toBe('revision conflict')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it('passes the previous and committed paths when a task is renamed', async () => {
    invoke.mockResolvedValueOnce({ path: 'new.md' }).mockResolvedValue({ updated: 1, errors: [] })
    await commitNote({ vaultRoot: '/rename', path: 'old.md', targetPath: 'new.md', content: 'saved' })
    expect(invoke).toHaveBeenLastCalledWith('sync_note_reminder', { vaultRoot: '/rename', oldPath: 'old.md', path: 'new.md' })
  })
  it('withdraws a deleted task even though it no longer appears in the note list', async () => {
    invoke.mockResolvedValueOnce(undefined).mockResolvedValue({ updated: 1, errors: [] })
    await deleteNote('/delete', 'a.md')
    expect(invoke).toHaveBeenLastCalledWith('sync_note_reminder', { vaultRoot: '/delete', oldPath: 'a.md', path: null })
  })
  it('reconciles external changes using committed paths and includes removed tasks', async () => {
    const delta = { notes: [{ path: 'a.md', bodyLoaded: false }], removedPaths: ['b.md'] }
    invoke.mockResolvedValueOnce(delta).mockResolvedValue({ updated: 1, errors: [] })
    expect(await refreshVaultPaths('/external', ['a.md', 'b.md'])).toBe(delta)
    expect(invoke).toHaveBeenNthCalledWith(2, 'sync_note_reminder', { vaultRoot: '/external', oldPath: 'a.md', path: 'a.md' })
    expect(invoke).toHaveBeenNthCalledWith(3, 'sync_note_reminder', { vaultRoot: '/external', oldPath: 'b.md', path: null })
  })
  it('synchronizes both parts of an Agent undo', async () => {
    invoke.mockResolvedValueOnce({ removedPath: 'created.md', restored: { path: 'before.md' }, activePath: 'before.md' }).mockResolvedValue({ updated: 1, errors: [] })
    await undoAgentChange('/undo', 'after.md')
    expect(invoke).toHaveBeenNthCalledWith(2, 'sync_note_reminder', { vaultRoot: '/undo', oldPath: 'created.md', path: null })
    expect(invoke).toHaveBeenNthCalledWith(3, 'sync_note_reminder', { vaultRoot: '/undo', oldPath: 'after.md', path: 'before.md' })
  })
  it('returns the latest system-merged note version to the save acknowledgement', async () => {
    const saved = { path: 'task.md', due: '2030-01-01', sourceRevision: 'before-pull' }
    const merged = { ...saved, due: '2030-02-02', status: 'done', sourceRevision: 'after-pull' }
    invoke.mockResolvedValueOnce(saved).mockResolvedValueOnce({ updated: 1, errors: [], notes: [merged] })
    expect(await commitNote({ vaultRoot: '/pull', path: 'task.md', content: 'body' })).toBe(merged)
  })
  it('keeps reported conflicts until resolved and uses the displayed versions as preconditions', async () => {
    const conflict = { path: 'task.md', fields: ['due'], localRevision: 'revision', local: { due: '2030-01-01', completed: false }, remote: { identifier: 'system', due: '2030-02-02', completed: false, modifiedAt: 1 } }
    invoke.mockResolvedValueOnce({ updated: 0, errors: [], conflicts: [conflict] })
    await syncReminders('/conflict')
    expect(getReminderConflicts('/conflict')).toEqual([conflict])
    invoke.mockResolvedValueOnce({ updated: 1, errors: [], conflicts: [] })
    await resolveReminderConflict('/conflict', conflict, 'remote')
    expect(invoke).toHaveBeenLastCalledWith('resolve_reminder_conflict', { vaultRoot: '/conflict', resolution: { conflict, choice: 'remote' } })
    expect(getReminderConflicts('/conflict')).toEqual([])
  })

})
