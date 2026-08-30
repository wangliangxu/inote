import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelLlmRequest,
  clearAgentPreference,
  executeLlmChatStream,
  loadAgentConversation,
  loadAgentPreference,
  recordAgentMessages,
  recordAgentTurn,
  saveAgentPreference,
  updateAgentMessage,
} from '../../shared/api'
import type { AgentConversation, AgentMessage, AgentPreference, LlmProviderSettings, Note, ReviewPlan } from '../../shared/types'
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
import type { AgentResult, QuickAgentAction } from './agentTypes'
import { buildReviewPlan } from './agentReviewPlan'
import { buildAgentSessionSummary } from './agentSessionSummary'
import { makeAgentId, nowIso } from './agentUtils'
import { runAgentLoop } from './agentRunner'
import { executeAgentTool } from './agentTools'
import { noteRevision } from './noteRevision'

const INITIAL_DISPLAY_LIMIT = 20
const LOAD_MORE_INCREMENT = 20
const MAX_LOAD_LIMIT = 200

export type AgentStatus = 'idle' | 'running' | 'applying' | 'error'

interface UseNoteAgentInput {
  note: Note
  notes: Note[]
  vaultRoot: string
  settings: LlmProviderSettings
  onApplyCurrentNote: (result: AgentResult, selectedOperationIndexes: number[], turnId: string, sessionId: string) => Promise<void>
  onCreateNote: (result: AgentResult, selectedOperationIndexes: number[], turnId: string, sessionId: string) => Promise<void>
  onUndoLastApply: () => Promise<void>
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

function formatCharCount(length: number): string {
  if (length < 1000) return `${length}`
  return `${(length / 1000).toFixed(1)}k`
}

export function useNoteAgent({
  note,
  notes,
  vaultRoot,
  settings,
  onApplyCurrentNote,
  onCreateNote,
  onUndoLastApply,
}: UseNoteAgentInput) {
  const [command, setCommand] = useState('')
  const [activeAction, setActiveAction] = useState<QuickAgentAction | undefined>()
  const [conversation, setConversation] = useState<AgentConversation | null>(null)
  const [preference, setPreference] = useState<AgentPreference | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT)
  const [resultsByTurn, setResultsByTurn] = useState<Record<string, AgentResult>>({})
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const allMeaningfulRef = useRef<AgentMessage[]>([])

  // Load conversation on mount or when note changes
  useEffect(() => {
    let cancelled = false
    setConversation(null)
    setPreference(null)
    setMessages([])
    setResultsByTurn({})
    setError('')
    setCommand('')
    setActiveAction(undefined)
    const vault = vaultRoot.trim()
    if (!vault) return
    setDisplayLimit(INITIAL_DISPLAY_LIMIT)
    loadAgentConversation({ vaultRoot: vault, notePath: note.path, messageLimit: MAX_LOAD_LIMIT })
      .then((loaded) => {
        if (cancelled) return
        setConversation(loaded)
        const meaningful = getRecentMeaningfulMessages(loaded.messages, MAX_LOAD_LIMIT)
        allMeaningfulRef.current = meaningful
        setMessages(meaningful.slice(Math.max(0, meaningful.length - INITIAL_DISPLAY_LIMIT)))
        setResultsByTurn(collectResultsByTurn(loaded.messages))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    loadAgentPreference({ vaultRoot: vault, notePath: note.path })
      .then((loaded) => { if (!cancelled) setPreference(loaded) })
      .catch(() => undefined)
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
    return conversation?.session?.id ?? makeAgentId('session')
  }

  async function refreshConversation() {
    const vault = vaultRoot.trim()
    if (!vault) return
    const loaded = await loadAgentConversation({ vaultRoot: vault, notePath: note.path, messageLimit: MAX_LOAD_LIMIT })
    setConversation(loaded)
    const meaningful = getRecentMeaningfulMessages(loaded.messages, MAX_LOAD_LIMIT)
    allMeaningfulRef.current = meaningful
    // Show at least the current displayLimit or all if fewer
    setMessages(meaningful.slice(Math.max(0, meaningful.length - Math.max(displayLimit, INITIAL_DISPLAY_LIMIT))))
    setResultsByTurn(collectResultsByTurn(loaded.messages))
  }

  const hasMoreMessages = useMemo(() => {
    return allMeaningfulRef.current.length > messages.length
  }, [messages])

  const loadMoreMessages = useCallback(() => {
    const all = allMeaningfulRef.current
    if (all.length <= messages.length) return
    const nextLimit = Math.min(messages.length + LOAD_MORE_INCREMENT, all.length)
    setDisplayLimit(nextLimit)
    setMessages(all.slice(Math.max(0, all.length - nextLimit)))
  }, [messages])

  const cancelAgent = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    if (requestIdRef.current) {
      void cancelLlmRequest(requestIdRef.current).catch(() => undefined)
      requestIdRef.current = null
    }
  }, [])

  async function runAgent(nextAction = activeAction, nextCommand = command) {
    setError('')
    const vault = vaultRoot.trim()
    if (!vault) {
      setStatus('error')
      setError('请先打开一个笔记库再运行 Agent。')
      return
    }
    const preferenceCommand = parsePreferenceCommand(nextCommand)
    if (preferenceCommand) {
      const now = nowIso()
      if (preferenceCommand.action === 'clear') {
        await clearAgentPreference({ vaultRoot: vault, notePath: note.path })
        setPreference(null)
      } else {
        await saveAgentPreference({ vaultRoot: vault, notePath: note.path, content: preferenceCommand.content, updatedAt: now })
        setPreference({ notePath: note.path, content: preferenceCommand.content, updatedAt: now })
      }
      setCommand('')
      const sessionId = getCurrentSessionId()
      appendLocalMessages([buildStatusMessage({
        id: makeAgentId('message'), sessionId, notePath: note.path, turnId: null, now,
        text: preferenceCommand.action === 'clear' ? '已清除此笔记的 Agent 偏好。' : '已记住此笔记的明确偏好。', status: 'ready',
      })])
      return
    }
    if (!settings.apiKey.trim()) {
      setStatus('error')
      setError('请先在设置中添加 LLM API Key。')
      return
    }

    setCommand('')
    setActiveAction(undefined)

    // Cancel any previous in-flight request
    cancelAgent()
    const abortController = new AbortController()
    abortRef.current = abortController

    const turnId = makeAgentId('turn')
    requestIdRef.current = turnId
    const sessionId = getCurrentSessionId()
    const createdAt = nowIso()
    const userMessage = buildUserCommandMessage({
      id: makeAgentId('message'),
      sessionId,
      notePath: note.path,
      turnId,
      now: createdAt,
      command: nextCommand,
      action: nextAction ?? null,
    })
    let statusMessage = buildStatusMessage({
      id: makeAgentId('message'),
      sessionId,
      notePath: note.path,
      turnId,
      now: createdAt,
      text: '正在读取笔记上下文...',
      status: 'streaming',
    })
    let requestPrompt = ''
    let requestContext = ''
    let lastRawResponse = ''

    try {
      setStatus('running')
      const request = buildAgentPrompt({
        command: nextCommand,
        note,
        notes,
        action: nextAction,
        maxContextLength: settings.maxContextLength,
        sessionSummary: buildAgentSessionSummary(conversation?.session ?? null),
        preference: preference?.content,
      })
      requestPrompt = request.prompt
      requestContext = request.context

      // agent_messages.session_id references agent_sessions.id. Persist the
      // running turn first so a newly generated session ID exists before its
      // initial transcript messages are inserted.
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
          rawResponse: '',
          parsedResultJson: null,
          status: 'running',
          error: null,
          createdAt,
          completedAt: null,
        },
      })

      appendLocalMessages([userMessage, statusMessage])
      await recordAgentMessages({ vaultRoot: vault, messages: [userMessage, statusMessage] })

      if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError')

      let currentResponseLength = 0
      let inputTokens = 0
      let outputTokens = 0
      let finishReason: string | undefined
      let structuredOutputMode: 'json_schema' | 'json_object' | 'prompt' | undefined
      const loop = await runAgentLoop({
        prompt: request.prompt,
        context: request.context,
        signal: abortController.signal,
        callModel: async ({ prompt, context, onChunk }) => {
          let response = ''
          currentResponseLength = 0
          const streamSummary = await executeLlmChatStream({ settings, prompt, context, requestId: turnId, structuredOutput: true }, (chunk) => {
            if (abortController.signal.aborted) return
            response += chunk
            currentResponseLength += chunk.length
            onChunk?.(chunk)
          })
          inputTokens += streamSummary.inputTokens ?? 0
          outputTokens += streamSummary.outputTokens ?? 0
          finishReason = streamSummary.finishReason ?? finishReason
          structuredOutputMode = streamSummary.structuredOutputMode
          if (streamSummary.finishReason === 'length') {
            throw new Error('模型因输出长度限制提前停止。请缩小任务范围或提高模型输出上限后重试。')
          }
          lastRawResponse = response
          return response
        },
        callTool: (call) => executeAgentTool({ call, vaultRoot: vault, notes }),
        onStatus: (text) => {
          statusMessage = { ...statusMessage, text, updatedAt: nowIso() }
          upsertLocalMessage(statusMessage)
        },
        onChunk: () => {
          const charInfo = formatCharCount(currentResponseLength)
          statusMessage = { ...statusMessage, text: `正在接收响应... ${charInfo} 字符`, updatedAt: nowIso() }
          upsertLocalMessage(statusMessage)
        },
      })

      statusMessage = { ...statusMessage, text: '正在构建审阅计划...', updatedAt: nowIso() }
      upsertLocalMessage(statusMessage)
      await updateAgentMessage({ vaultRoot: vault, message: statusMessage })

      const parsed = {
        ...loop.result,
        baseNoteRevision: noteRevision(note),
        metrics: {
          ...loop.metrics,
          inputTokens: inputTokens || undefined,
          outputTokens: outputTokens || undefined,
          finishReason,
          structuredOutputMode,
        },
      }
      const fullResponse = loop.rawResponse
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

      const readyStatus = { ...statusMessage, text: '审阅计划已就绪。', status: 'ready' as const, updatedAt: completedAt }
      const resultMessage = buildAssistantResultMessage({
        id: makeAgentId('message'),
        sessionId,
        notePath: note.path,
        turnId,
        now: completedAt,
        text: parsed.message || '已为此笔记准备了审阅计划。',
        details: {
          prompt: request.prompt,
          context: request.context,
          rawResponse: fullResponse,
          parsedResultJson: JSON.stringify(parsed),
        },
      })
      const reviewMessage = buildReviewPlanMessage({
        id: makeAgentId('message'),
        sessionId,
        notePath: note.path,
        turnId,
        now: completedAt,
        text: plan.message || '请在应用前审阅以下修改建议。',
        reviewPlan: plan,
      })

      upsertLocalMessage(readyStatus)
      appendLocalMessages([resultMessage, reviewMessage])
      setResultsByTurn((current) => ({ ...current, [turnId]: parsed }))
      await recordAgentMessages({ vaultRoot: vault, messages: [readyStatus, resultMessage, reviewMessage] })
      await refreshConversation()
      setStatus('idle')
    } catch (err) {
      if (abortController.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        statusMessage = { ...statusMessage, text: '请求已取消。', status: 'ready' as const, updatedAt: nowIso() }
        upsertLocalMessage(statusMessage)
        await updateAgentMessage({ vaultRoot: vault, message: statusMessage }).catch(() => undefined)
        await recordAgentTurn({
          vaultRoot: vault,
          noteTitle: note.title,
          turn: {
            id: turnId,
            sessionId,
            notePath: note.path,
            command: nextCommand,
            action: nextAction ?? null,
            prompt: requestPrompt,
            contextSummary: requestContext.slice(0, 1200),
            rawResponse: lastRawResponse,
            parsedResultJson: null,
            status: 'cancelled',
            error: null,
            createdAt,
            completedAt: nowIso(),
          },
        }).catch(() => undefined)
        setStatus('idle')
        return
      }
      const text = err instanceof Error ? err.message : String(err)
      const message = buildErrorMessage({
        id: makeAgentId('message'),
        sessionId,
        notePath: note.path,
        turnId,
        now: nowIso(),
        text,
      })
      appendLocalMessages([message])
      await recordAgentMessages({ vaultRoot: vault, messages: [message] }).catch(() => undefined)
      await recordAgentTurn({
        vaultRoot: vault,
        noteTitle: note.title,
        turn: {
          id: turnId,
          sessionId,
          notePath: note.path,
          command: nextCommand,
          action: nextAction ?? null,
          prompt: requestPrompt,
          contextSummary: requestContext.slice(0, 1200),
          rawResponse: lastRawResponse,
          parsedResultJson: null,
          status: 'failed',
          error: text,
          createdAt,
          completedAt: nowIso(),
        },
      }).catch(() => undefined)
      setStatus('error')
      setError(text)
    } finally {
      if (abortRef.current === abortController) {
        abortRef.current = null
      }
      if (requestIdRef.current === turnId) requestIdRef.current = null
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

  async function markReviewMessage(message: AgentMessage, status: 'applied' | 'discarded', text: string) {
    const vault = vaultRoot.trim()
    const nextMessage = { ...message, text, status, updatedAt: nowIso() }
    upsertLocalMessage(nextMessage)
    if (vault) await updateAgentMessage({ vaultRoot: vault, message: nextMessage })
  }

  async function applyCurrent(message: AgentMessage, plan: ReviewPlan) {
    const result = resultsByTurn[plan.turnId]
    if (!result) {
      setStatus('error')
      setError('此审阅对应的 Agent 结果已不可用。')
      return
    }
    setStatus('applying')
    try {
      await onApplyCurrentNote(result, getSelectedIndexes(plan, 'current'), plan.turnId, message.sessionId)
      await markReviewMessage(message, 'applied', '审阅已应用。')
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
      setError('此审阅对应的 Agent 结果已不可用。')
      return
    }
    setStatus('applying')
    try {
      await onCreateNote(result, getSelectedIndexes(plan, 'create'), plan.turnId, message.sessionId)
      await markReviewMessage(message, 'applied', '审阅已应用。')
      await refreshConversation()
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function discardReview(message: AgentMessage) {
    try {
      await markReviewMessage(message, 'discarded', '审阅已丢弃。')
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

  return {
    command,
    setCommand,
    activeAction,
    setActiveAction,
    messages,
    hasMoreMessages,
    loadMoreMessages,
    status,
    error,
    runAgent,
    cancelAgent,
    toggleReviewGroup,
    applyCurrent,
    createNote,
    discardReview,
    undoFromMessage,
  }
}

export function parsePreferenceCommand(command: string): { action: 'save', content: string } | { action: 'clear' } | null {
  const trimmed = command.trim()
  if (/^(忘记|清除)(?:此笔记的)?\s*(?:agent\s*)?偏好[。.!]?$/i.test(trimmed)) return { action: 'clear' }
  const match = trimmed.match(/^(?:记住|remember)\s*[:：]\s*(.+)$/i)
  if (!match?.[1]?.trim()) return null
  return { action: 'save', content: match[1].trim().slice(0, 2000) }
}
