import { describe, expect, it } from 'vitest'
import type { Note } from '../../shared/types'
import { buildReviewPlan, getSelectedOperations } from './agentReviewPlan'
import type { AgentResult } from './agentTypes'

const note: Note = {
  path: 'journal/example.md',
  title: 'Example',
  category: 'journal',
  tags: ['old'],
  createdAt: '2026-06-20',
  updatedAt: '2026-06-20',
  summary: 'Old summary',
  body: 'Original body',
  wordCount: 2,
}

describe('buildReviewPlan', () => {
  it('groups metadata changes with before and after values', () => {
    const result: AgentResult = {
      message: 'Updated metadata.',
      operations: [{ type: 'update_current_note', patch: { summary: 'New summary', tags: ['new', 'agent'] } }],
    }

    const plan = buildReviewPlan(note, result, 'turn-1')

    expect(plan.canApply).toBe(true)
    expect(plan.highRisk).toBe(false)
    expect(plan.groups).toEqual([
      {
        id: 'turn-1-metadata-0',
        operationIndexes: [0],
        kind: 'metadata',
        title: 'Metadata changes',
        summary: '2 fields will change.',
        selected: true,
        items: [
          { label: 'summary', before: 'Old summary', after: 'New summary' },
          { label: 'tags', before: 'old', after: 'new, agent' },
        ],
      },
    ])
  })

  it('marks title and category metadata changes with a path warning', () => {
    const result: AgentResult = {
      message: 'Move note.',
      operations: [{ type: 'update_current_note', patch: { title: 'Renamed', category: 'projects' } }],
    }

    const plan = buildReviewPlan(note, result, 'turn-2')

    expect(plan.highRisk).toBe(true)
    expect(plan.groups.map((group) => group.kind)).toEqual(['metadata', 'risk'])
    expect(plan.groups[1].summary).toContain('file path may change')
  })

  it('creates body append and body replace groups with replacement requiring confirmation', () => {
    const result: AgentResult = {
      message: 'Body edits.',
      operations: [
        { type: 'append_to_current_note', markdown: 'Appended text' },
        { type: 'replace_current_note_body', markdown: 'Replacement text' },
      ],
    }

    const plan = buildReviewPlan(note, result, 'turn-3')

    expect(plan.canApply).toBe(true)
    expect(plan.highRisk).toBe(true)
    expect(plan.groups[0]).toMatchObject({
      kind: 'body_append',
      selected: true,
      requiresConfirmation: false,
    })
    expect(plan.groups[1]).toMatchObject({
      kind: 'body_replace',
      selected: false,
      requiresConfirmation: true,
    })
    expect(plan.groups[0].items[0].diffLines?.some((line) => line.kind === 'add')).toBe(true)
    expect(plan.groups[1].items[0].diffLines?.some((line) => line.kind === 'remove')).toBe(true)
  })

  it('creates create-note and suggestion groups', () => {
    const result: AgentResult = {
      message: 'Drafts.',
      operations: [
        { type: 'create_note', note: { title: 'Related', category: 'journal', tags: ['agent'], body: 'Body' } },
        { type: 'suggest_only', markdown: '- Try a clearer title' },
      ],
    }

    const plan = buildReviewPlan(note, result, 'turn-4')

    expect(plan.groups.map((group) => group.kind)).toEqual(['create_note', 'suggestion'])
    expect(plan.groups[0].items).toContainEqual({ label: 'title', after: 'Related' })
    expect(plan.groups[1].selected).toBe(false)
  })

  it('returns operations for selected applyable groups only', () => {
    const result: AgentResult = {
      message: 'Mixed.',
      operations: [
        { type: 'update_current_note', patch: { summary: 'New' } },
        { type: 'suggest_only', markdown: 'Suggestion' },
      ],
    }
    const plan = buildReviewPlan(note, result, 'turn-5')

    expect(getSelectedOperations(result.operations, plan.groups)).toEqual([
      { type: 'update_current_note', patch: { summary: 'New' } },
    ])
  })
})
