import { describe, expect, it } from 'vitest'
import { parseAgentResult } from './agentParser'

describe('parseAgentResult', () => {
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
})
