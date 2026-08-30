import { describe, expect, it } from 'vitest'
import { parseAgentResult, parseAgentStep } from './agentParser'

describe('parseAgentResult', () => {
  it('parses version 1 read-only tool requests', () => {
    expect(parseAgentStep(JSON.stringify({
      version: 1,
      message: '需要查找相关笔记',
      toolCalls: [{ id: 'search-1', name: 'search_notes', arguments: { query: 'local first', limit: 3 } }],
    }))).toEqual({
      version: 1,
      message: '需要查找相关笔记',
      toolCalls: [{ id: 'search-1', name: 'search_notes', arguments: { query: 'local first', limit: 3 } }],
    })
  })

  it('rejects unknown tools and mixed tool/final responses', () => {
    expect(() => parseAgentStep(JSON.stringify({
      version: 1,
      toolCalls: [{ id: 'x', name: 'delete_note', arguments: { path: 'x.md' } }],
    }))).toThrow('Unsupported agent tool')
    expect(() => parseAgentStep(JSON.stringify({
      version: 1,
      toolCalls: [{ id: 'x', name: 'read_note', arguments: { path: 'x.md' } }],
      operations: [],
    }))).toThrow('cannot contain toolCalls and operations together')
  })

  it('parses valid current-note metadata updates', () => {
    const result = parseAgentResult(JSON.stringify({
      message: 'I will update the metadata.',
      operations: [
        {
          type: 'update_current_note',
          patch: {
            title: 'Research Log',
            tags: ['#ai', ' research ', 'ai'],
            summary: 'A compact research summary.',
            status: 'in_progress',
            priority: 'high',
          },
        },
      ],
    }))

    expect(result.message).toBe('I will update the metadata.')
    expect(result.operations).toEqual([
      {
        type: 'update_current_note',
        patch: {
          title: 'Research Log',
          tags: ['ai', 'research'],
          summary: 'A compact research summary.',
          status: 'in_progress',
          priority: 'high',
        },
      },
    ])
  })

  it('parses JSON inside a fenced code block', () => {
    const result = parseAgentResult('```json\n{"message":"ok","operations":[{"type":"suggest_only","markdown":"- tag: ai"}]}\n```')

    expect(result.operations).toEqual([{ type: 'suggest_only', markdown: '- tag: ai' }])
  })

  it('rejects malformed JSON', () => {
    expect(() => parseAgentResult('not json')).toThrow('Agent response was not valid JSON.')
  })

  it('rejects unsupported operation types', () => {
    expect(() => parseAgentResult(JSON.stringify({
      message: 'bad',
      operations: [{ type: 'delete_note', path: 'x.md' }],
    }))).toThrow('Unsupported agent operation: delete_note.')
  })

  it('rejects unsupported patch fields', () => {
    expect(() => parseAgentResult(JSON.stringify({
      message: 'bad',
      operations: [{ type: 'update_current_note', patch: { custom: 'x' } }],
    }))).toThrow('Unsupported note patch field: custom.')
  })

  it('rejects invalid status and priority values', () => {
    expect(() => parseAgentResult(JSON.stringify({
      message: 'bad',
      operations: [{ type: 'update_current_note', patch: { status: 'blocked' } }],
    }))).toThrow('Invalid status: blocked.')

    expect(() => parseAgentResult(JSON.stringify({
      message: 'bad',
      operations: [{ type: 'update_current_note', patch: { priority: 'urgent' } }],
    }))).toThrow('Invalid priority: urgent.')
  })

  it('rejects empty created note titles and categories', () => {
    expect(() => parseAgentResult(JSON.stringify({
      message: 'bad',
      operations: [{ type: 'create_note', note: { title: '', category: 'knowledge', body: 'Body' } }],
    }))).toThrow('New note title is required.')

    expect(() => parseAgentResult(JSON.stringify({
      message: 'bad',
      operations: [{ type: 'create_note', note: { title: 'New', category: ' ', body: 'Body' } }],
    }))).toThrow('New note category is required.')
  })

  it('enforces operation and generated content quotas', () => {
    expect(() => parseAgentResult(JSON.stringify({
      message: 'too many',
      operations: Array.from({ length: 13 }, () => ({ type: 'suggest_only', markdown: 'x' })),
    }))).toThrow('12-operation limit')

    expect(() => parseAgentResult(JSON.stringify({
      message: 'too long',
      operations: [{ type: 'append_to_current_note', markdown: 'x'.repeat(50001) }],
    }))).toThrow('50000-character limit')
  })

  it('accepts null optional fields emitted by strict structured output', () => {
    const result = parseAgentResult(JSON.stringify({
      version: 1,
      message: 'strict',
      toolCalls: null,
      operations: [{
        type: 'update_current_note',
        patch: { title: null, category: null, tags: ['agent'], summary: null, due: null, status: null, priority: null, project: null },
      }],
    }))
    expect(result.operations).toEqual([{ type: 'update_current_note', patch: { tags: ['agent'] } }])
  })
})
