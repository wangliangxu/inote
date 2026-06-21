import type { AgentSession } from '../../shared/types'

export function buildAgentSessionSummary(session: AgentSession | null | undefined): string {
  if (!session) return ''

  const lines = [`Recent agent session for ${session.noteTitle}:`]
  for (const turn of session.turns.slice(-3)) {
    const resultMessage = extractMessage(turn.parsedResultJson)
    lines.push(`- ${turn.status}: ${turn.command}${resultMessage ? ` -> ${resultMessage}` : ''}`)
  }

  for (const event of session.operationEvents.slice(-3)) {
    lines.push(`- Applied ${event.operationTypes.join(', ')}: ${event.changedFields.join(', ') || 'note'}`)
  }

  return trimToLength(lines.join('\n'), 800)
}

function extractMessage(parsedResultJson?: string | null): string {
  if (!parsedResultJson) return ''
  try {
    const parsed = JSON.parse(parsedResultJson)
    return typeof parsed.message === 'string' ? parsed.message : ''
  } catch {
    return ''
  }
}

function trimToLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}
