import { describe, expect, it } from 'vitest'
import type { AgentOperationEvent, ReviewPlan } from '../../shared/types'
import {
  decodeAssistantResultPayload,
  decodeOperationEventPayload,
  decodeReviewPlanPayload,
  encodeAssistantResultPayload,
  encodeOperationEventPayload,
  encodeReviewPlanPayload,
} from './agentMessagePayloads'

const reviewPlan: ReviewPlan = {
  id: 'review-1',
  turnId: 'turn-1',
  message: 'Review changes',
  canApply: true,
  highRisk: false,
  groups: [
    {
      id: 'group-1',
      operationIndexes: [0],
      kind: 'metadata',
      title: 'Metadata',
      summary: 'Update summary',
      items: [{ label: 'summary', before: 'old', after: 'new' }],
      selected: true,
    },
  ],
}

const operationEvent: AgentOperationEvent = {
  id: 'event-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  notePath: 'journal/example.md',
  operationTypes: ['update_current_note'],
  changedFields: ['summary'],
  createdNotePath: null,
  appliedAt: '2026-06-26T12:00:00Z',
}

describe('agent message payloads', () => {
  it('round trips review plan payloads', () => {
    const encoded = encodeReviewPlanPayload(reviewPlan)

    expect(decodeReviewPlanPayload(encoded)).toEqual(reviewPlan)
  })

  it('round trips assistant result details', () => {
    const encoded = encodeAssistantResultPayload({
      prompt: 'System prompt',
      context: 'Context',
      rawResponse: '{"message":"ok"}',
      parsedResultJson: '{"message":"ok","operations":[]}',
    })

    expect(decodeAssistantResultPayload(encoded)).toMatchObject({
      prompt: 'System prompt',
      rawResponse: '{"message":"ok"}',
    })
  })

  it('round trips operation event payloads', () => {
    const encoded = encodeOperationEventPayload({
      event: operationEvent,
      action: 'applied',
      canUndo: true,
    })

    expect(decodeOperationEventPayload(encoded)).toEqual({
      event: operationEvent,
      action: 'applied',
      canUndo: true,
    })
  })

  it('returns null for malformed payloads', () => {
    expect(decodeReviewPlanPayload('{')).toBeNull()
    expect(decodeAssistantResultPayload('{"prompt":1}')).toBeNull()
    expect(decodeOperationEventPayload('')).toBeNull()
  })
})
