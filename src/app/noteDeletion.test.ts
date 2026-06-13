import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('note deletion controls', () => {
  it('uses real delete buttons instead of nested role buttons', () => {
    const source = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(source).not.toContain('role="button"')
    expect(source.match(/<button[\s\S]*?className="note-delete-action"/g)).toHaveLength(2)
  })

  it('does not do a full index rebuild after deleting a note', () => {
    const source = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const deleteHandler = source.match(/async function deleteNoteByPath[\s\S]*?\n  }/)?.[0] ?? ''

    expect(deleteHandler).toContain('await deleteNote(vaultRoot.trim(), path)')
    expect(deleteHandler).not.toContain('rebuildSearchIndex(vaultRoot.trim())')
  })

  it('suppresses the watcher refresh caused by an app-initiated delete', () => {
    const source = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const deleteHandler = source.match(/async function deleteNoteByPath[\s\S]*?\n  }/)?.[0] ?? ''

    expect(source).toContain('skipNextVaultChangeUntilRef')
    expect(deleteHandler.indexOf('skipNextVaultChangeUntilRef.current = Date.now() + 1500')).toBeLessThan(
      deleteHandler.indexOf('await deleteNote(vaultRoot.trim(), path)'),
    )
  })
})
