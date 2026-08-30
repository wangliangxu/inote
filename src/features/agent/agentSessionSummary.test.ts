import { describe, expect, it } from 'vitest'
import type { AgentSession } from '../../shared/types'
import { buildAgentSessionSummary } from './agentSessionSummary'

const session: AgentSession = {
  id: 'session-1',
  notePath: 'journal/example.md',
  noteTitle: 'Example',
  createdAt: '2026-06-20T10:00:00Z',
  updatedAt: '2026-06-20T10:05:00Z',
  turns: [
    {
      id: 'turn-1',
      sessionId: 'session-1',
      notePath: 'journal/example.md',
      command: 'Summarize this note',
      action: 'summarize',
      prompt: 'large prompt',
      contextSummary: 'Title: Example',
      rawResponse: 'x'.repeat(2000),
      parsedResultJson: '{"message":"Added summary","operations":[]}',
      status: 'ready',
      createdAt: '2026-06-20T10:01:00Z',
      completedAt: '2026-06-20T10:02:00Z',
    },
    {
      id: 'turn-2',
      sessionId: 'session-1',
      notePath: 'journal/example.md',
      command: 'Add tags',
      action: 'suggest_tags',
      prompt: 'large prompt',
      contextSummary: 'Title: Example',
      rawResponse: 'raw response should not appear',
      parsedResultJson: '{"message":"Added tags","operations":[]}',
      status: 'applied',
      createdAt: '2026-06-20T10:03:00Z',
      completedAt: '2026-06-20T10:04:00Z',
    },
  ],
  operationEvents: [
    {
      id: 'event-1',
      sessionId: 'session-1',
      turnId: 'turn-2',
      notePath: 'journal/example.md',
      operationTypes: ['update_current_note'],
      changedFields: ['tags'],
      appliedAt: '2026-06-20T10:05:00Z',
    },
  ],
  lastUndoSnapshot: null,
}

describe('buildAgentSessionSummary', () => {
  it('summarizes recent commands and applied changes without raw response bloat', () => {
    const summary = buildAgentSessionSummary(session)

    expect(summary).toContain('Recent agent session for Example')
    expect(summary).toContain('Summarize this note')
    expect(summary).toContain('Add tags')
    expect(summary).toContain('Applied update_current_note: tags')
    expect(summary).toContain('[Working memory]')
    expect(summary).toContain('[Execution memory: confirmed applies only]')
    expect(summary).not.toContain('raw response should not appear')
    expect(summary.length).toBeLessThan(900)
  })

  it('returns empty text for missing session', () => {
    expect(buildAgentSessionSummary(null)).toBe('')
  })
})
