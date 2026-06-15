import { describe, expect, it } from 'vitest'
import type { Note } from '../../shared/types'
import { buildAgentPrompt } from './agentPrompts'

const note: Note = {
  path: 'knowledge/ai.md',
  title: 'AI Notes',
  category: 'knowledge',
  tags: ['ai'],
  createdAt: '2026-06-10',
  updatedAt: '2026-06-12',
  body: '# AI Notes\n\nLocal-first notes.',
  wordCount: 4,
}

describe('buildAgentPrompt', () => {
  it('requires JSON-only operation output', () => {
    const prompt = buildAgentPrompt({
      command: 'suggest tags',
      note,
      notes: [note],
      action: 'suggest_tags',
    })

    expect(prompt.prompt).toContain('Return only valid JSON')
    expect(prompt.prompt).toContain('"operations"')
    expect(prompt.context).toContain('Current note:')
    expect(prompt.context).toContain('AI Notes')
  })

  it('includes compact category and tag hints', () => {
    const prompt = buildAgentPrompt({
      command: 'create related note',
      note,
      notes: [
        note,
        { ...note, path: 'projects/app.md', category: 'projects', tags: ['inote', 'ai'] },
      ],
      action: 'create_related',
    })

    expect(prompt.context).toContain('Existing categories: knowledge, projects')
    expect(prompt.context).toContain('Existing tags: ai, inote')
    expect(prompt.prompt).toContain('Create a related note')
  })
})
