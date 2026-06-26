import { useEffect, useState } from 'react'
import {
  executeLlmChatStream,
  loadAgentConversation,
  recordAgentMessages,
  recordAgentTurn,
  updateAgentMessage,
} from '../../shared/api'
import type { AgentConversation, AgentMessage, LlmProviderSettings, Note, ReviewPlan } from '../../shared/types'
import { AgentComposer } from './AgentComposer'
import { AgentConversationView } from './AgentConversationView'
import {
  buildAssistantResultMessage,
  buildErrorMessage,
  buildReviewPlanMessage,
  buildStatusMessage,
  buildUserCommandMessage,
  getRecentMeaningfulMessages,
} from './agentConversation'
import { decodeAssistantResultPayload, decodeReviewPlanPayload, encodeReviewPlanPayload } from './agentMessagePayloads'
import { buildAgentPrompt } from './agentPrompts'
import { parseAgentResult } from './agentParser'
import type { AgentResult, QuickAgentAction } from './agentTypes'
import { buildReviewPlan } from './agentReviewPlan'
import { buildAgentSessionSummary } from './agentSessionSummary'

interface NoteAgentProps {
  note: Note
  notes: Note[]
  vaultRoot: string
  settings: LlmProviderSettings
  onApplyCurrentNote: (result: AgentResult, selectedOperationIndexes: number[], turnId: string, sessionId: string) => Promise<void>
  onCreateNote: (result: AgentResult, selectedOperationIndexes: number[], turnId: string, sessionId: string) => Promise<void>
  onUndoLastApply: () => Promise<void>
}

type AgentStatus = 'idle' | 'running' | 'applying' | 'error'

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function collectResultsByTurn(messages: AgentMessage[]): Record<string, AgentResult> {
  return messages.reduce<Record<string, AgentResult>>((results, message) => {
    if (message.kind !== 'assistant_result' || !message.turnId) return results
    const details = decodeAssistantResultPayload(message.payloadJson)
    if (!details) return results
    try {
      results[message.turnId] = JSON.parse(details.parsedResultJson) as AgentResult
    } catch {
      return results
    }
    return results
  }, {})
}

function getSelectedIndexes(plan: ReviewPlan, kind: 'current' | 'create'): number[] {
  return plan.groups
    .filter((group) => group.selected)
    .filter((group) => (
      kind === 'create'
        ? group.kind === 'create_note'
        : group.kind !== 'create_note' && group.kind !== 'risk' && group.kind !== 'suggestion'
    ))
    .flatMap((group) => group.operationIndexes)
}

export function NoteAgent({ note, notes, vaultRoot, settings, onApplyCurrentNote, onCreateNote, onUndoLastApply }: NoteAgentProps) {
  const [command, setCommand] = useState('Update tags and summary for this note.')
  const [activeAction, setActiveAction] = useState<QuickAgentAction | undefined>()
  const [conversation, setConversation] = useState<AgentConversation | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [resultsByTurn, setResultsByTurn] = useState<Record<string, AgentResult>>({})
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setConversation(null)
    setMessages([])
    setResultsByTurn({})
    setError('')
    const vault = vaultRoot.trim()
    if (!vault) return
    loadAgentConversation({ vaultRoot: vault, notePath: note.path, messageLimit: 60 })
      .then((loaded) => {
        if (cancelled) return
        setConversation(loaded)
        setMessages(getRecentMeaningfulMessages(loaded.messages, 5))
        setResultsByTurn(collectResultsByTurn(loaded.messages))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [vaultRoot, note.path])

  function appendLocalMessages(nextMessages: AgentMessage[]) {
    setMessages((current) => [...current, ...nextMessages])
  }

  function upsertLocalMessage(nextMessage: AgentMessage) {
    setMessages((current) => {
      const index = current.findIndex((message) => message.id === nextMessage.id)
      if (index === -1) return [...current, nextMessage]
      return current.map((message) => message.id === nextMessage.id ? nextMessage : message)
    })
  }

  function getCurrentSessionId(): string {
    return conversation?.session?.id ?? makeId('session')
  }

  async function refreshConversation() {
    const vault = vaultRoot.trim()
    if (!vault) return
    const loaded = await loadAgentConversation({ vaultRoot: vault, notePath: note.path, messageLimit: 60 })
    setConversation(loaded)
    setMessages(getRecentMeaningfulMessages(loaded.messages, 5))
    setResultsByTurn(collectResultsByTurn(loaded.messages))
  }

  async function runAgent(nextAction = activeAction, nextCommand = command) {
    setError('')
    const vault = vaultRoot.trim()
    if (!vault) {
      setStatus('error')
      setError('Open a real vault before running the note agent.')
      return
    }
    if (!settings.apiKey.trim()) {
      setStatus('error')
      setError('Add an LLM API key in Settings first.')
      return
    }

    const turnId = makeId('turn')
    const sessionId = getCurrentSessionId()
    const createdAt = nowIso()
    const userMessage = buildUserCommandMessage({
      id: makeId('message'),
      sessionId,
      notePath: note.path,
      turnId,
      now: createdAt,
      command: nextCommand,
      action: nextAction ?? null,
    })
    let statusMessage = buildStatusMessage({
      id: makeId('message'),
      sessionId,
      notePath: note.path,
      turnId,
      now: createdAt,
      text: 'Reading current note context...',
      status: 'streaming',
    })

    try {
      setStatus('running')
      appendLocalMessages([userMessage, statusMessage])
      await recordAgentMessages({ vaultRoot: vault, messages: [userMessage, statusMessage] })

      const request = buildAgentPrompt({
        command: nextCommand,
        note,
        notes,
        action: nextAction,
        maxContextLength: settings.maxContextLength,
        sessionSummary: buildAgentSessionSummary(conversation?.session ?? null),
      })

      statusMessage = { ...statusMessage, text: 'Asking the model...', updatedAt: nowIso() }
      upsertLocalMessage(statusMessage)
      await updateAgentMessage({ vaultRoot: vault, message: statusMessage })

      let fullResponse = ''
      await executeLlmChatStream({ settings, prompt: request.prompt, context: request.context }, (chunk) => {
        fullResponse += chunk
        statusMessage = { ...statusMessage, text: 'Receiving response...', updatedAt: nowIso() }
        upsertLocalMessage(statusMessage)
      })

      statusMessage = { ...statusMessage, text: 'Parsing response...', updatedAt: nowIso() }
      upsertLocalMessage(statusMessage)
      await updateAgentMessage({ vaultRoot: vault, message: statusMessage })

      const parsed = parseAgentResult(fullResponse)
      const plan = buildReviewPlan(note, parsed, turnId)
      const completedAt = nowIso()
      await recordAgentTurn({
        vaultRoot: vault,
        noteTitle: note.title,
        turn: {
          id: turnId,
          sessionId,
          notePath: note.path,
          command: nextCommand,
          action: nextAction ?? null,
          prompt: request.prompt,
          contextSummary: request.context.slice(0, 1200),
          rawResponse: fullResponse,
          parsedResultJson: JSON.stringify(parsed),
          status: 'ready',
          error: null,
          createdAt,
          completedAt,
        },
      })

      const readyStatus = { ...statusMessage, text: 'Review plan ready.', status: 'ready' as const, updatedAt: completedAt }
      const resultMessage = buildAssistantResultMessage({
        id: makeId('message'),
        sessionId,
        notePath: note.path,
        turnId,
        now: completedAt,
        text: parsed.message || 'I prepared a review plan for this note.',
        details: {
          prompt: request.prompt,
          context: request.context,
          rawResponse: fullResponse,
          parsedResultJson: JSON.stringify(parsed),
        },
      })
      const reviewMessage = buildReviewPlanMessage({
        id: makeId('message'),
        sessionId,
        notePath: note.path,
        turnId,
        now: completedAt,
        text: plan.message || 'Review the proposed changes before applying.',
        reviewPlan: plan,
      })

      upsertLocalMessage(readyStatus)
      appendLocalMessages([resultMessage, reviewMessage])
      setResultsByTurn((current) => ({ ...current, [turnId]: parsed }))
      await recordAgentMessages({ vaultRoot: vault, messages: [readyStatus, resultMessage, reviewMessage] })
      await refreshConversation()
      setStatus('idle')
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      const message = buildErrorMessage({
        id: makeId('message'),
        sessionId,
        notePath: note.path,
        turnId,
        now: nowIso(),
        text,
      })
      appendLocalMessages([message])
      await recordAgentMessages({ vaultRoot: vault, messages: [message] }).catch(() => undefined)
      setStatus('error')
      setError(text)
    }
  }

  function toggleReviewGroup(messageId: string, groupId: string) {
    const vault = vaultRoot.trim()
    let nextMessage: AgentMessage | null = null
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId || message.kind !== 'review_plan') return message
      const plan = decodeReviewPlanPayload(message.payloadJson)
      if (!plan) return message
      const nextPlan = {
        ...plan,
        groups: plan.groups.map((group) => group.id === groupId ? { ...group, selected: !group.selected } : group),
      }
      nextMessage = { ...message, payloadJson: encodeReviewPlanPayload(nextPlan), updatedAt: nowIso() }
      return nextMessage
    }))
    if (vault && nextMessage) {
      updateAgentMessage({ vaultRoot: vault, message: nextMessage }).catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    }
  }

  async function markReviewMessage(message: AgentMessage, text: string) {
    const vault = vaultRoot.trim()
    const nextMessage = { ...message, text, status: 'applied' as const, updatedAt: nowIso() }
    upsertLocalMessage(nextMessage)
    if (vault) await updateAgentMessage({ vaultRoot: vault, message: nextMessage })
  }

  async function applyCurrent(message: AgentMessage, plan: ReviewPlan) {
    const result = resultsByTurn[plan.turnId]
    if (!result) {
      setStatus('error')
      setError('The parsed agent result for this review is no longer available.')
      return
    }
    setStatus('applying')
    try {
      await onApplyCurrentNote(result, getSelectedIndexes(plan, 'current'), plan.turnId, message.sessionId)
      await markReviewMessage(message, 'Review applied.')
      await refreshConversation()
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function createNote(message: AgentMessage, plan: ReviewPlan) {
    const result = resultsByTurn[plan.turnId]
    if (!result) {
      setStatus('error')
      setError('The parsed agent result for this review is no longer available.')
      return
    }
    setStatus('applying')
    try {
      await onCreateNote(result, getSelectedIndexes(plan, 'create'), plan.turnId, message.sessionId)
      await markReviewMessage(message, 'Review applied.')
      await refreshConversation()
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function discardReview(message: AgentMessage) {
    try {
      await markReviewMessage(message, 'Review discarded.')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function undoFromMessage() {
    setStatus('applying')
    try {
      await onUndoLastApply()
      await refreshConversation()
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="note-agent flex h-full flex-col bg-base-200/40 text-base-content">
      <div className="agent-scroll-area flex-1 space-y-3 overflow-y-auto p-3">
        {error ? <p className="agent-error alert alert-error py-2 text-sm">{error}</p> : null}
        <AgentConversationView
          messages={messages}
          disabled={status === 'running' || status === 'applying'}
          onToggleReviewGroup={toggleReviewGroup}
          onApplyReview={applyCurrent}
          onCreateReview={createNote}
          onDiscardReview={discardReview}
          onUndo={undoFromMessage}
        />
      </div>
      <AgentComposer
        command={command}
        activeAction={activeAction}
        disabled={status === 'running' || status === 'applying'}
        onCommandChange={setCommand}
        onActionSelect={(action, nextCommand) => {
          setActiveAction(action)
          setCommand(nextCommand)
        }}
        onSubmit={() => runAgent()}
      />
    </div>
  )
}
