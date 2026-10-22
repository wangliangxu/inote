import { describe, expect, it } from 'vitest'
import { buildAgentNoteCommit } from './agentNoteCommit'
import { demoNotes } from '../../shared/fixtures'
import { noteRevision } from './noteRevision'
import type { AgentResult } from './agentTypes'

describe('Agent review commit', () => {
  const before = { ...demoNotes[0], sourceRevision: 'disk' }
  const result: AgentResult = { message: 'Update', baseNoteRevision: noteRevision(before), operations: [
    { type: 'update_current_note', patch: { tags: ['new'] } },
    { type: 'append_to_current_note', markdown: 'Appendix' },
    { type: 'update_current_note', patch: { title: 'Unselected' } },
  ] }
  it('builds one commit and one complete undo snapshot for all selected operations', () => {
    const change = buildAgentNoteCommit(before, result, [0, 1], 'turn', 'session', '2026-10-22', false)
    expect(change.note.tags).toEqual(['new'])
    expect(change.note.title).toBe(before.title)
    expect(change.note.body).toContain('Appendix')
    expect(change.agent.event.operationTypes).toEqual(['update_current_note', 'append_to_current_note'])
    expect(change.agent.messages).toHaveLength(1)
    expect(change.agent.undoSnapshot.noteBeforeMarkdown).not.toContain('Appendix')
    expect(change.agent.undoSnapshot.noteBeforeMarkdown).toContain(before.body)
  })
  it('does not turn an empty selection into applying every operation', () => {
    expect(() => buildAgentNoteCommit(before, result, [], 't', 's', 'date', false)).toThrow('选择')
  })
  it('rejects reviews after metadata, dates or custom fields change', () => {
    for (const patch of [{ body: 'changed' }, { createdAt: '2025-01-01' }, { frontmatter: { custom: true } }]) {
      expect(() => buildAgentNoteCommit({ ...before, ...patch }, result, [0], 't', 's', 'date', false)).toThrow('changed after')
    }
  })
})
