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

  it('includes compact category hints without archive trash or tags', () => {
    const prompt = buildAgentPrompt({
      command: 'create related note',
      note,
      notes: [
        note,
        { ...note, path: 'projects/app.md', category: 'projects', tags: ['inote', 'ai'] },
        { ...note, path: 'archive/old.md', category: 'archive', tags: ['old'] },
        { ...note, path: 'trash/deleted.md', category: 'trash', tags: ['deleted'] },
        { ...note, path: '归档/旧笔记.md', category: '归档', tags: ['archived'] },
        { ...note, path: '回收站/删除.md', category: '回收站', tags: ['removed'] },
      ],
      action: 'create_related',
    })

    expect(prompt.context).toContain('Existing categories: knowledge, projects')
    expect(prompt.context).not.toContain('Existing categories: archive')
    expect(prompt.context).not.toContain('trash')
    expect(prompt.context).not.toContain('归档')
    expect(prompt.context).not.toContain('回收站')
    expect(prompt.context).not.toContain('Tags:')
    expect(prompt.context).not.toContain('Existing tags:')
    expect(prompt.context).not.toContain('inote')
    expect(prompt.prompt).toContain('Create a related note')
  })

  it('includes compact session summary when provided', () => {
    const request = buildAgentPrompt({
      command: 'Follow up',
      note,
      notes: [note],
      sessionSummary: 'Recent agent session for Example:\n- ready: Summarize -> Added summary',
    })

    expect(request.context).toContain('Recent agent session for Example')
    expect(request.context.indexOf('Recent agent session')).toBeLessThan(request.context.indexOf('Current note:'))
  })
})
