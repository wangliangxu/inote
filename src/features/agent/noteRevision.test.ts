import { describe, expect, it } from 'vitest'
import type { Note } from '../../shared/types'
import { noteRevision } from './noteRevision'

const note: Note = {
  path: 'knowledge/example.md',
  title: 'Example',
  category: 'knowledge',
  tags: ['one'],
  createdAt: '2026-08-30',
  updatedAt: '2026-08-30',
  body: 'Body',
  wordCount: 1,
}

describe('noteRevision', () => {
  it('is stable for non-content UI fields', () => {
    expect(noteRevision(note)).toBe(noteRevision({ ...note, isDirty: true, wordCount: 999 }))
  })

  it('changes for body, metadata, or path edits', () => {
    expect(noteRevision({ ...note, body: 'Changed' })).not.toBe(noteRevision(note))
    expect(noteRevision({ ...note, tags: ['two'] })).not.toBe(noteRevision(note))
    expect(noteRevision({ ...note, path: 'knowledge/moved.md' })).not.toBe(noteRevision(note))
  })
})
