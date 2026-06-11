import { describe, expect, it } from 'vitest'
import { demoNotes } from '../shared/fixtures'
import { createInitialWorkspaceState } from './startup'

function storageWith(entries: Array<[string, string]>): Storage {
  const storage = new Map(entries)
  return {
    getItem: (key: string) => storage.get(key) ?? null,
  } as Storage
}

describe('app startup state', () => {
  it('does not render demo notes before persisted settings resolve', () => {
    const startup = createInitialWorkspaceState(storageWith([]))

    expect(startup.notes).toEqual([])
    expect(startup.activePath).toBe('')
    expect(startup.status).toBe('Loading workspace settings...')
    expect(startup.saveState).toBe('loading')
  })

  it('keeps the remembered vault path without showing demo notes first', () => {
    const startup = createInitialWorkspaceState(
      storageWith([
        ['inote.lastVaultRoot', '/Users/me/Notes'],
        ['inote.activePath', 'journal/today.md'],
      ]),
    )

    expect(startup.vaultRoot).toBe('/Users/me/Notes')
    expect(startup.activePath).toBe('journal/today.md')
    expect(startup.notes).not.toEqual(demoNotes)
    expect(startup.saveState).toBe('loading')
  })
})
