import { describe, expect, it, vi } from 'vitest'
import { runAgentLoop } from './agentRunner'

const finalResponse = JSON.stringify({
  version: 1,
  message: '完成',
  operations: [{ type: 'suggest_only', markdown: '结果' }],
})

describe('runAgentLoop', () => {
  it('returns a direct final response with metrics', async () => {
    const callModel = vi.fn().mockResolvedValue(finalResponse)
    const result = await runAgentLoop({
      prompt: 'task',
      context: 'note',
      signal: new AbortController().signal,
      callModel,
      callTool: vi.fn(),
    })

    expect(result.result.operations).toEqual([{ type: 'suggest_only', markdown: '结果' }])
    expect(result.metrics).toMatchObject({ modelCalls: 1, toolCalls: 0, repairAttempts: 0 })
  })

  it('executes a bounded read-only tool request before producing operations', async () => {
    const callModel = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        version: 1,
        message: '查找资料',
        toolCalls: [{ id: 's1', name: 'search_notes', arguments: { query: 'agent' } }],
      }))
      .mockResolvedValueOnce(finalResponse)
    const callTool = vi.fn().mockResolvedValue({
      callId: 's1',
      name: 'search_notes',
      ok: true,
      content: '[{"path":"knowledge/agent.md"}]',
      references: [{ path: 'knowledge/agent.md', title: 'Agent', reason: 'search' }],
    })

    const result = await runAgentLoop({
      prompt: 'task',
      context: 'note',
      signal: new AbortController().signal,
      callModel,
      callTool,
    })

    expect(callTool).toHaveBeenCalledOnce()
    expect(callModel.mock.calls[1][0].context).toContain('knowledge/agent.md')
    expect(result.result.references).toEqual([{ path: 'knowledge/agent.md', title: 'Agent', reason: 'search' }])
    expect(result.metrics).toMatchObject({ modelCalls: 2, toolCalls: 1 })
  })

  it('repairs one malformed structured response', async () => {
    const callModel = vi.fn().mockResolvedValueOnce('not json').mockResolvedValueOnce(finalResponse)
    const result = await runAgentLoop({
      prompt: 'task',
      context: 'note',
      signal: new AbortController().signal,
      callModel,
      callTool: vi.fn(),
    })

    expect(callModel).toHaveBeenCalledTimes(2)
    expect(result.metrics.repairAttempts).toBe(1)
  })

  it('stops before a model call when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runAgentLoop({
      prompt: 'task',
      context: 'note',
      signal: controller.signal,
      callModel: vi.fn(),
      callTool: vi.fn(),
    })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
