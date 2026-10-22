// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNoteAgent } from './useNoteAgent'
import { demoNotes } from '../../shared/fixtures'
import * as api from '../../shared/api'

vi.mock('../../shared/api', () => ({
  cancelLlmRequest: vi.fn(), clearAgentPreference: vi.fn(), executeLlmChatStream: vi.fn(),
  loadAgentConversation: vi.fn(), loadAgentPreference: vi.fn(), recordAgentMessages: vi.fn(),
  recordAgentTurn: vi.fn(), saveAgentPreference: vi.fn(), updateAgentMessage: vi.fn(),
}))

describe('Agent request lifetime', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.loadAgentConversation).mockResolvedValue({ session: null, messages: [] })
    vi.mocked(api.loadAgentPreference).mockResolvedValue(null)
    vi.mocked(api.recordAgentMessages).mockResolvedValue()
    vi.mocked(api.recordAgentTurn).mockResolvedValue()
    vi.mocked(api.updateAgentMessage).mockResolvedValue()
    vi.mocked(api.cancelLlmRequest).mockResolvedValue(true)
  })
  afterEach(cleanup)
  const callbacks = { onApplyCurrentNote: vi.fn(), onCreateNote: vi.fn(), onUndoLastApply: vi.fn() }
  const settings = { apiKey: 'test', model: 'test', providerName: 'test', apiBaseUrl: 'https://example.com' }
  it('cancels on note switch and ignores the previous response', async () => {
    let finish!: () => void
    vi.mocked(api.executeLlmChatStream).mockImplementation((_input, chunk) => new Promise((resolve) => {
      finish = () => { chunk('{"version":1,"message":"old result","operations":[]}'); resolve({ structuredOutputMode: 'prompt' }) }
    }))
    const hook = renderHook(({ note }) => useNoteAgent({ note, notes: demoNotes, vaultRoot: '/vault', settings, ...callbacks }), { initialProps: { note: demoNotes[0] } })
    let running!: Promise<void>
    act(() => { running = hook.result.current.runAgent(undefined, 'Summarize') })
    await waitFor(() => expect(api.executeLlmChatStream).toHaveBeenCalledOnce())
    hook.rerender({ note: demoNotes[1] })
    expect(api.cancelLlmRequest).toHaveBeenCalledOnce()
    await act(async () => { finish(); await running })
    expect(hook.result.current.messages.some((message) => message.text.includes('old result'))).toBe(false)
    expect(hook.result.current.status).toBe('idle')
    expect(api.recordAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ turn: expect.objectContaining({ notePath: demoNotes[0].path, status: 'cancelled' }) }))
  })
  it('cancels the backend request on unmount', async () => {
    vi.mocked(api.executeLlmChatStream).mockImplementation(() => new Promise(() => undefined))
    const hook = renderHook(() => useNoteAgent({ note: demoNotes[0], notes: demoNotes, vaultRoot: '/vault', settings, ...callbacks }))
    act(() => { void hook.result.current.runAgent(undefined, 'Summarize') })
    await waitFor(() => expect(api.executeLlmChatStream).toHaveBeenCalledOnce())
    hook.unmount()
    expect(api.cancelLlmRequest).toHaveBeenCalledOnce()
  })
})
