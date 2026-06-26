import { describe, expect, it } from 'vitest'
import type { AgentMessage, AgentOperationEvent, ReviewPlan } from '../../shared/types'
import {
  buildAssistantResultMessage,
  buildErrorMessage,
  buildOperationEventMessage,
  buildReviewPlanMessage,
  buildStatusMessage,
  buildUserCommandMessage,
  getRecentMeaningfulMessages,
  sortConversationMessages,
} from './agentConversation'
import { decodeOperationEventPayload, decodeReviewPlanPayload } from './agentMessagePayloads'

const base = {
  sessionId: 'session-1',
  notePath: 'journal/example.md',
  turnId: 'turn-1',
  now: '2026-06-26T12:00:00Z',
}

const reviewPlan: ReviewPlan = {
  id: 'review-1',
  turnId: 'turn-1',
  message: 'Review changes',
  canApply: true,
  highRisk: false,
  groups: [],
}

const event: AgentOperationEvent = {
  id: 'event-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  notePath: 'journal/example.md',
  operationTypes: ['update_current_note'],
  changedFields: ['summary'],
  createdNotePath: null,
  appliedAt: '2026-06-26T12:00:00Z',
}

describe('agentConversation helpers', () => {
  it('builds typed conversation messages', () => {
    expect(buildUserCommandMessage({ ...base, id: 'm1', command: 'Summarize', action: 'summarize' })).toMatchObject({
      role: 'user',
      kind: 'user_command',
      status: 'ready',
    })
    expect(buildStatusMessage({ ...base, id: 'm2', text: 'Reading...', status: 'streaming' })).toMatchObject({
      kind: 'assistant_status',
      status: 'streaming',
    })
    expect(buildAssistantResultMessage({
      ...base,
      id: 'm3',
      text: 'Ready',
      details: { prompt: 'Prompt', context: 'Context', rawResponse: '{}', parsedResultJson: '{}' },
    })).toMatchObject({ kind: 'assistant_result' })
    const reviewMessage = buildReviewPlanMessage({ ...base, id: 'm4', text: 'Review', reviewPlan })
    expect(decodeReviewPlanPayload(reviewMessage.payloadJson)).toEqual(reviewPlan)
    expect(buildErrorMessage({ ...base, id: 'm5', text: 'No API key' })).toMatchObject({
      kind: 'error',
      status: 'failed',
    })
  })

  it('builds operation event messages', () => {
    const message = buildOperationEventMessage({
      ...base,
      id: 'm6',
      event,
      action: 'applied',
      canUndo: true,
    })

    expect(message).toMatchObject({ kind: 'operation_event', status: 'applied' })
    expect(decodeOperationEventPayload(message.payloadJson)).toEqual({ event, action: 'applied', canUndo: true })
  })

  it('sorts and slices recent meaningful messages', () => {
    const messages: AgentMessage[] = [
      buildStatusMessage({ ...base, id: 'm3', now: '2026-06-26T12:00:03Z', text: 'Third' }),
      buildUserCommandMessage({ ...base, id: 'm1', now: '2026-06-26T12:00:01Z', command: 'First' }),
      buildStatusMessage({ ...base, id: 'm2', now: '2026-06-26T12:00:02Z', text: 'Second' }),
      buildAssistantResultMessage({
        ...base,
        id: 'm4',
        now: '2026-06-26T12:00:04Z',
        text: 'Fourth',
        details: { prompt: '', context: '', rawResponse: '', parsedResultJson: '' },
      }),
    ]

    expect(sortConversationMessages(messages).map((message) => message.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(getRecentMeaningfulMessages(messages, 2).map((message) => message.id)).toEqual(['m3', 'm4'])
  })
})
