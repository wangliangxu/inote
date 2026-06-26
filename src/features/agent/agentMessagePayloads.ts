import type { AgentOperationEvent, ReviewPlan } from '../../shared/types'

export interface AssistantResultMessagePayload {
  prompt: string
  context: string
  rawResponse: string
  parsedResultJson: string
}

export interface OperationEventMessagePayload {
  event: AgentOperationEvent
  action: 'applied' | 'created' | 'undone'
  canUndo: boolean
}

export function encodeReviewPlanPayload(reviewPlan: ReviewPlan): string {
  return JSON.stringify({ reviewPlan })
}

export function decodeReviewPlanPayload(payloadJson?: string | null): ReviewPlan | null {
  if (!payloadJson) return null
  try {
    const parsed = JSON.parse(payloadJson) as { reviewPlan?: ReviewPlan }
    return parsed.reviewPlan ?? null
  } catch {
    return null
  }
}

export function encodeAssistantResultPayload(payload: AssistantResultMessagePayload): string {
  return JSON.stringify(payload)
}

export function decodeAssistantResultPayload(payloadJson?: string | null): AssistantResultMessagePayload | null {
  if (!payloadJson) return null
  try {
    const parsed = JSON.parse(payloadJson) as AssistantResultMessagePayload
    if (typeof parsed.prompt !== 'string' || typeof parsed.context !== 'string') return null
    if (typeof parsed.rawResponse !== 'string' || typeof parsed.parsedResultJson !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function encodeOperationEventPayload(payload: OperationEventMessagePayload): string {
  return JSON.stringify(payload)
}

export function decodeOperationEventPayload(payloadJson?: string | null): OperationEventMessagePayload | null {
  if (!payloadJson) return null
  try {
    const parsed = JSON.parse(payloadJson) as OperationEventMessagePayload
    if (!parsed.event || !parsed.action) return null
    return parsed
  } catch {
    return null
  }
}
