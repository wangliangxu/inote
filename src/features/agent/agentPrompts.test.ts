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

  it('includes note tags in context', () => {
    const taggedNote = { ...note, tags: ['ai', 'machine-learning', 'llm'] }
    const prompt = buildAgentPrompt({
      command: 'test',
      note: taggedNote,
      notes: [taggedNote],
    })

    expect(prompt.context).toContain('Tags: ai, machine-learning, llm')
  })

  it('includes note status, priority, and project in context', () => {
    const detailedNote = {
      ...note,
      status: 'in_progress',
      priority: 'high',
      project: 'iNote',
      due: '2026-07-01',
    }
    const prompt = buildAgentPrompt({
      command: 'test',
      note: detailedNote,
      notes: [detailedNote],
    })

    expect(prompt.context).toContain('Status: in_progress')
    expect(prompt.context).toContain('Priority: high')
    expect(prompt.context).toContain('Project: iNote')
    expect(prompt.context).toContain('Due: 2026-07-01')
  })

  it('does not include priority "none" or empty fields in context', () => {
    const minimalNote = { ...note, priority: 'none', status: undefined, project: undefined }
    const prompt = buildAgentPrompt({
      command: 'test',
      note: minimalNote,
      notes: [minimalNote],
    })

    expect(prompt.context).not.toContain('Priority:')
    expect(prompt.context).not.toContain('Status:')
    expect(prompt.context).not.toContain('Project:')
  })

  it('includes existing tags from vault notes', () => {
    const prompt = buildAgentPrompt({
      command: 'test',
      note,
      notes: [
        note,
        { ...note, path: 'projects/app.md', category: 'projects', tags: ['dev', 'react'] },
      ],
    })

    expect(prompt.context).toContain('Existing tags:')
    expect(prompt.context).toContain('ai')
    expect(prompt.context).toContain('dev')
    expect(prompt.context).toContain('react')
  })

  it('excludes tags from archive/trash notes in existing tags', () => {
    const prompt = buildAgentPrompt({
      command: 'test',
      note,
      notes: [
        note,
        { ...note, path: 'archive/old.md', category: 'archive', tags: ['archived-tag'] },
      ],
    })

    expect(prompt.context).not.toContain('archived-tag')
  })

  it('includes Chinese response instruction in prompt', () => {
    const prompt = buildAgentPrompt({
      command: 'test',
      note,
      notes: [note],
    })

    expect(prompt.prompt).toContain('请用中文回复')
  })
})
