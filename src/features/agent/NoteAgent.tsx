import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import type { LlmProviderSettings, Note } from '../../shared/types'
import { AgentComposer, quickActions } from './AgentComposer'
import { AgentConversationView } from './AgentConversationView'
import type { AgentResult } from './agentTypes'
import { useNoteAgent } from './useNoteAgent'

interface NoteAgentProps {
  note: Note
  notes: Note[]
  vaultRoot: string
  settings: LlmProviderSettings
  onApplyCurrentNote: (result: AgentResult, selectedOperationIndexes: number[], turnId: string, sessionId: string) => Promise<void>
  onCreateNote: (result: AgentResult, selectedOperationIndexes: number[], turnId: string, sessionId: string) => Promise<void>
  onUndoLastApply: () => Promise<void>
}

export function NoteAgent({ note, notes, vaultRoot, settings, onApplyCurrentNote, onCreateNote, onUndoLastApply }: NoteAgentProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const {
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
  } = useNoteAgent({
    note,
    notes,
    vaultRoot,
    settings,
    onApplyCurrentNote,
    onCreateNote,
    onUndoLastApply,
  })

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const container = scrollRef.current
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  const isRunningOrApplying = status === 'running' || status === 'applying'

  return (
    <div className="note-agent flex h-full flex-col bg-base-200/40 text-base-content">
      <div ref={scrollRef} className="agent-scroll-area flex-1 space-y-3 overflow-y-auto p-3">
        {error ? <p className="agent-error alert alert-error py-2 text-sm">{error}</p> : null}
        {messages.length === 0 && !error && status !== 'running' ? (
          <div className="agent-starter">
            <div className="agent-starter-icon" aria-hidden="true"><Bot size={22} /></div>
            <p className="agent-starter-title">{t('agent.starterTitle')}</p>
            <p className="agent-starter-hint">{settings.apiKey || settings.apiBaseUrl.includes('localhost') || settings.apiBaseUrl.includes('127.0.0.1') ? t('agent.starterHint') : t('agent.starterNoKey')}</p>
            <div className="agent-starter-actions">
              {quickActions.map(({ action, icon: Icon }) => (
                <button
                  key={action}
                  type="button"
                  className="agent-starter-action"
                  disabled={isRunningOrApplying}
                  onClick={() => {
                    const nextCommand = t(`agent.commands.${action}`)
                    setActiveAction(action)
                    setCommand(nextCommand)
                    void runAgent(action, nextCommand)
                  }}
                >
                  <Icon size={14} />
                  <span>{t(`agent.actions.${action}`)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <AgentConversationView
          messages={messages}
          disabled={isRunningOrApplying}
          hasMoreMessages={hasMoreMessages}
          onLoadMore={loadMoreMessages}
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
        disabled={isRunningOrApplying}
        isRunning={status === 'running'}
        onCommandChange={setCommand}
        onActionSelect={(action, nextCommand) => {
          setActiveAction(action)
          setCommand(nextCommand)
          void runAgent(action, nextCommand)
        }}
        onSubmit={() => runAgent()}
        onCancel={cancelAgent}
      />
    </div>
  )
}
