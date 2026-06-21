import { describe, expect, it } from 'vitest'
import type { Note } from '../../shared/types'
import { applyCurrentNoteOperations, filterOperationsByIndexes, getCreateNoteDraft } from './applyAgentOperations'

const baseNote: Note = {
  path: 'knowledge/old.md',
  title: 'Old',
  category: 'knowledge',
  tags: ['old'],
  createdAt: '2026-06-10',
  updatedAt: '2026-06-10',
  body: '# Old\n\nBody.',
  wordCount: 3,
}

describe('applyCurrentNoteOperations', () => {
  it('applies metadata patches without mutating the input note', () => {
    const result = applyCurrentNoteOperations(baseNote, [
      { type: 'update_current_note', patch: { title: 'New', tags: ['ai'], summary: 'Summary' } },
    ], '2026-06-15')

    expect(result.note).toMatchObject({
      title: 'New',
      tags: ['ai'],
      summary: 'Summary',
      updatedAt: '2026-06-15',
      isDirty: true,
    })
    expect(result.changedFields).toEqual(['title', 'tags', 'summary'])
    expect(baseNote.title).toBe('Old')
  })

  it('appends generated markdown to the current body', () => {
    const result = applyCurrentNoteOperations(baseNote, [
      { type: 'append_to_current_note', markdown: '## Follow-up\n\nNext.' },
    ], '2026-06-15')

    expect(result.note.body).toBe('# Old\n\nBody.\n\n## Follow-up\n\nNext.')
    expect(result.note.wordCount).toBe(6)
  })

  it('replaces the current body', () => {
    const result = applyCurrentNoteOperations(baseNote, [
      { type: 'replace_current_note_body', markdown: '# New\n\nReplacement body.' },
    ], '2026-06-15')

    expect(result.note.body).toBe('# New\n\nReplacement body.')
    expect(result.changedFields).toEqual(['body'])
  })

  it('rejects create-note and suggest-only operations for current-note apply', () => {
    expect(() => applyCurrentNoteOperations(baseNote, [
      { type: 'create_note', note: { title: 'New', category: 'knowledge', body: 'Body' } },
    ], '2026-06-15')).toThrow('Apply current note can only use current-note operations.')

    expect(() => applyCurrentNoteOperations(baseNote, [
      { type: 'suggest_only', markdown: '- keep' },
    ], '2026-06-15')).toThrow('Apply current note can only use current-note operations.')
  })
})

describe('getCreateNoteDraft', () => {
  it('returns a single create-note draft', () => {
    const draft = getCreateNoteDraft([
      { type: 'create_note', note: { title: 'Related', category: 'knowledge/ai', tags: ['ai'], body: '# Related' } },
    ])

    expect(draft).toEqual({ title: 'Related', category: 'knowledge/ai', tags: ['ai'], body: '# Related' })
  })

  it('rejects missing or mixed create-note operations', () => {
    expect(() => getCreateNoteDraft([])).toThrow('Agent result does not contain a note draft.')
    expect(() => getCreateNoteDraft([
      { type: 'create_note', note: { title: 'A', category: 'knowledge', body: 'A' } },
      { type: 'create_note', note: { title: 'B', category: 'knowledge', body: 'B' } },
    ])).toThrow('Only one note can be created at a time.')
  })
})

describe('filterOperationsByIndexes', () => {
  it('filters operations by selected indexes while preserving order', () => {
    const operations = [
      { type: 'update_current_note', patch: { summary: 'New' } },
      { type: 'suggest_only', markdown: 'Suggestion' },
      { type: 'append_to_current_note', markdown: 'Appendix' },
    ] as const

    expect(filterOperationsByIndexes([...operations], [2, 0])).toEqual([
      { type: 'update_current_note', patch: { summary: 'New' } },
      { type: 'append_to_current_note', markdown: 'Appendix' },
    ])
  })
})
