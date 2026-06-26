import type { AgentMessage, AgentOperationEvent, ReviewPlan } from '../../shared/types'
import type { QuickAgentAction } from './agentTypes'
import {
  encodeAssistantResultPayload,
  encodeOperationEventPayload,
  encodeReviewPlanPayload,
  type AssistantResultMessagePayload,
} from './agentMessagePayloads'

export interface MessageBaseInput {
  id: string
  sessionId: string
  notePath: string
  turnId?: string | null
  now: string
}

export function sortConversationMessages(messages: AgentMessage[]): AgentMessage[] {
  return [...messages].sort((first, second) => {
    const byCreatedAt = first.createdAt.localeCompare(second.createdAt)
    if (byCreatedAt !== 0) return byCreatedAt
    return first.id.localeCompare(second.id)
  })
}

export function getRecentMeaningfulMessages(messages: AgentMessage[], limit: number): AgentMessage[] {
  const meaningful = sortConversationMessages(messages).filter((message) => (
    message.kind !== 'assistant_status' || message.status === 'streaming' || message.text.trim().length > 0
  ))
  return meaningful.slice(Math.max(0, meaningful.length - limit))
}

export function buildUserCommandMessage(input: MessageBaseInput & {
  command: string
  action?: QuickAgentAction | null
}): AgentMessage {
  return {
    id: input.id,
    sessionId: input.sessionId,
    notePath: input.notePath,
    turnId: input.turnId ?? null,
    role: 'user',
    kind: 'user_command',
    text: input.command,
    payloadJson: input.action ? JSON.stringify({ action: input.action }) : null,
    status: 'ready',
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function buildStatusMessage(input: MessageBaseInput & {
  text: string
  status?: 'pending' | 'streaming' | 'ready' | 'failed'
}): AgentMessage {
  return {
    id: input.id,
    sessionId: input.sessionId,
    notePath: input.notePath,
    turnId: input.turnId ?? null,
    role: 'assistant',
    kind: 'assistant_status',
    text: input.text,
    payloadJson: null,
    status: input.status ?? 'ready',
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function buildAssistantResultMessage(input: MessageBaseInput & {
  text: string
  details: AssistantResultMessagePayload
}): AgentMessage {
  return {
    id: input.id,
    sessionId: input.sessionId,
    notePath: input.notePath,
    turnId: input.turnId ?? null,
    role: 'assistant',
    kind: 'assistant_result',
    text: input.text,
    payloadJson: encodeAssistantResultPayload(input.details),
    status: 'ready',
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function buildReviewPlanMessage(input: MessageBaseInput & {
  text: string
  reviewPlan: ReviewPlan
}): AgentMessage {
  return {
    id: input.id,
    sessionId: input.sessionId,
    notePath: input.notePath,
    turnId: input.turnId ?? null,
    role: 'assistant',
    kind: 'review_plan',
    text: input.text,
    payloadJson: encodeReviewPlanPayload(input.reviewPlan),
    status: 'ready',
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function buildOperationEventMessage(input: MessageBaseInput & {
  event: AgentOperationEvent
  action: 'applied' | 'created' | 'undone'
  canUndo: boolean
}): AgentMessage {
  const label = input.action === 'created'
    ? `Created ${input.event.createdNotePath ?? 'note'}.`
    : input.action === 'undone'
      ? `Undid the last agent apply for ${input.event.notePath}.`
      : `Applied ${input.event.operationTypes.join(', ')}.`
  return {
    id: input.id,
    sessionId: input.sessionId,
    notePath: input.notePath,
    turnId: input.turnId ?? null,
    role: 'assistant',
    kind: 'operation_event',
    text: label,
    payloadJson: encodeOperationEventPayload({ event: input.event, action: input.action, canUndo: input.canUndo }),
    status: 'applied',
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function buildErrorMessage(input: MessageBaseInput & { text: string }): AgentMessage {
  return {
    id: input.id,
    sessionId: input.sessionId,
    notePath: input.notePath,
    turnId: input.turnId ?? null,
    role: 'assistant',
    kind: 'error',
    text: input.text,
    payloadJson: null,
    status: 'failed',
    createdAt: input.now,
    updatedAt: input.now,
  }
}
