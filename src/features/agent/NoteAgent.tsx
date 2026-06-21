import { useEffect, useMemo, useState } from 'react'
import { FilePlus2, ListChecks, Plus, RefreshCw, Send, Sparkles, Tags, Wand2, X, Zap } from 'lucide-react'
import { executeLlmChatStream, loadAgentSession, recordAgentTurn } from '../../shared/api'
import type { AgentSession, LlmProviderSettings, Note, ReviewPlan } from '../../shared/types'
import { buildAgentPrompt } from './agentPrompts'
import { parseAgentResult } from './agentParser'
import { hasCreateNoteWrite, hasCurrentNoteWrite } from './applyAgentOperations'
import type { AgentResult, QuickAgentAction } from './agentTypes'
import { buildReviewPlan, getSelectedOperations } from './agentReviewPlan'
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

const quickActions: Array<{ action: QuickAgentAction, label: string, icon: typeof Sparkles, command: string }> = [
  { action: 'summarize', label: 'Summary', icon: Sparkles, command: 'Update the summary for the current note.' },
  { action: 'suggest_tags', label: 'Tags', icon: Tags, command: 'Suggest and apply concise tags for the current note.' },
  { action: 'clean_metadata', label: 'YAML', icon: Wand2, command: 'Clean the current note metadata.' },
  { action: 'extract_tasks', label: 'Tasks', icon: ListChecks, command: 'Extract action items and append them to the current note.' },
  { action: 'continue_writing', label: 'Continue', icon: RefreshCw, command: 'Continue writing the current note.' },
  { action: 'create_related', label: 'Related', icon: FilePlus2, command: 'Create a related note that links back to the current note.' },
]

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export function NoteAgent({ note, notes, vaultRoot, settings, onApplyCurrentNote, onCreateNote, onUndoLastApply }: NoteAgentProps) {
  const [command, setCommand] = useState('Update tags and summary for this note.')
  const [activeAction, setActiveAction] = useState<QuickAgentAction | undefined>()
  const [agentProcess, setAgentProcess] = useState<{ prompt: string, context: string, rawResponse?: string } | null>(null)
  const [result, setResult] = useState<AgentResult | null>(null)
  const [session, setSession] = useState<AgentSession | null>(null)
  const [reviewPlan, setReviewPlan] = useState<ReviewPlan | null>(null)
  const [stage, setStage] = useState<'idle' | 'preparing' | 'requesting' | 'receiving' | 'parsing' | 'ready'>('idle')
  const [activeTurnSessionId, setActiveTurnSessionId] = useState('')
  const [status, setStatus] = useState<'idle' | 'running' | 'applying' | 'error'>('idle')
  const [isProcessLogOpen, setIsProcessLogOpen] = useState(false)
  const [error, setError] = useState('')

  const selectedOperationIndexes = useMemo(() => reviewPlan?.groups
    .filter((group) => group.selected)
    .flatMap((group) => group.operationIndexes) ?? [], [reviewPlan])
  const selectedOperations = useMemo(
    () => result && reviewPlan ? getSelectedOperations(result.operations, reviewPlan.groups) : [],
    [result, reviewPlan],
  )
  const selectedCurrentOperationIndexes = useMemo(() => selectedOperationIndexes.filter((index) => {
    const operation = result?.operations[index]
    return operation?.type === 'update_current_note' || operation?.type === 'append_to_current_note' || operation?.type === 'replace_current_note_body'
  }), [result, selectedOperationIndexes])
  const selectedCreateOperationIndexes = useMemo(() => selectedOperationIndexes.filter((index) => result?.operations[index]?.type === 'create_note'), [result, selectedOperationIndexes])
  const canApplyCurrent = useMemo(() => hasCurrentNoteWrite(selectedOperations), [selectedOperations])
  const canCreate = useMemo(() => hasCreateNoteWrite(selectedOperations), [selectedOperations])

  useEffect(() => {
    let cancelled = false
    setSession(null)
    setReviewPlan(null)
    setResult(null)
    setStage('idle')
    if (!vaultRoot.trim()) return
    loadAgentSession({ vaultRoot, notePath: note.path })
      .then((loaded) => {
        if (!cancelled) setSession(loaded)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [vaultRoot, note.path])

  async function runAgent(nextAction = activeAction, nextCommand = command) {
    setError('')
    setResult(null)
    setReviewPlan(null)
    if (!settings.apiKey.trim()) {
      setStatus('error')
      setStage('idle')
      setError('Add an LLM API key in Settings first.')
      return
    }

    try {
      setStatus('running')
      const turnId = makeId('turn')
      const sessionId = session?.id ?? makeId('session')
      setActiveTurnSessionId(sessionId)
      setStage('preparing')
      setIsProcessLogOpen(true)
      const request = buildAgentPrompt({
        command: nextCommand,
        note,
        notes,
        action: nextAction,
        maxContextLength: settings.maxContextLength,
        sessionSummary: buildAgentSessionSummary(session),
      })
      setAgentProcess({ prompt: request.prompt, context: request.context, rawResponse: '' })
      
      let fullResponse = ''
      setStage('requesting')
      await executeLlmChatStream({
        settings,
        prompt: request.prompt,
        context: request.context,
      }, (chunk) => {
        setStage('receiving')
        fullResponse += chunk
        setAgentProcess(prev => prev ? { ...prev, rawResponse: fullResponse } : null)
      })

      setStage('parsing')
      const parsed = parseAgentResult(fullResponse)
      const plan = buildReviewPlan(note, parsed, turnId)
      const completedAt = nowIso()
      setResult(parsed)
      setReviewPlan(plan)
      await recordAgentTurn({
        vaultRoot,
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
          createdAt: completedAt,
          completedAt,
        },
      })
      setSession(await loadAgentSession({ vaultRoot, notePath: note.path }))
      setStage('ready')
      setStatus('idle')
      setIsProcessLogOpen(false)
    } catch (err) {
      setStatus('error')
      setStage('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function applyCurrent() {
    if (!result || !reviewPlan) return
    setStatus('applying')
    try {
      await onApplyCurrentNote(result, selectedCurrentOperationIndexes, reviewPlan.turnId, activeTurnSessionId || session?.id || '')
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function createNote() {
    if (!result || !reviewPlan) return
    setStatus('applying')
    try {
      await onCreateNote(result, selectedCreateOperationIndexes, reviewPlan.turnId, activeTurnSessionId || session?.id || '')
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
        
        {agentProcess && (
          <details 
            className="agent-process-log collapse collapse-arrow border border-base-300 bg-base-100" 
            open={isProcessLogOpen}
            onToggle={(e) => setIsProcessLogOpen(e.currentTarget.open)}
          >
            <summary className="collapse-title min-h-0 px-3 py-2 text-sm font-semibold">Agent Process Log</summary>
            <div className="agent-process-content collapse-content px-0 pb-0">
              <div className="max-h-96 overflow-y-auto px-3 pb-3 pt-0 grid gap-2 text-xs">
                <details className="collapse collapse-arrow rounded-lg border border-base-300 bg-base-200/30">
                  <summary className="collapse-title min-h-0 px-3 py-2 text-xs font-semibold text-base-content/70">System Prompt</summary>
                  <div className="collapse-content px-3 pb-3">
                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-base-200 p-2">{agentProcess.prompt}</pre>
                  </div>
                </details>
                <details className="collapse collapse-arrow rounded-lg border border-base-300 bg-base-200/30">
                  <summary className="collapse-title min-h-0 px-3 py-2 text-xs font-semibold text-base-content/70">Context</summary>
                  <div className="collapse-content px-3 pb-3">
                    <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-base-200 p-2">{agentProcess.context}</pre>
                  </div>
                </details>
                <strong className="mt-1 px-1 text-base-content/60">Raw Response</strong>
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-base-200 p-2">{agentProcess.rawResponse || 'Waiting for response...'}</pre>
              </div>
            </div>
          </details>
        )}

        {renderSessionTimeline(session)}
        {stage !== 'idle' ? renderStage(stage) : null}
        {renderReviewPlan(reviewPlan, toggleReviewGroup)}

        {reviewPlan && (
          <>
            <div className="agent-footer flex items-center gap-2">
              <button className="btn btn-primary btn-sm btn-square" type="button" onClick={applyCurrent} disabled={!canApplyCurrent || status === 'applying'} title="Apply to current note">
                <Plus size={15} />
              </button>
              <button className="btn btn-outline btn-sm btn-square" type="button" onClick={createNote} disabled={!canCreate || status === 'applying'} title="Create note">
                <FilePlus2 size={15} />
              </button>
              <div className="flex-1"></div>
              <button className="btn btn-ghost btn-sm btn-square" type="button" onClick={onUndoLastApply} disabled={status === 'applying'} title="Undo last agent apply">
                <RefreshCw size={15} />
              </button>
              <button className="btn btn-ghost btn-sm btn-square" type="button" onClick={() => { setResult(null); setReviewPlan(null); setStage('idle') }} disabled={status === 'applying'} title="Discard">
                <X size={15} />
              </button>
            </div>
          </>
        )}
      </div>

      <div className="agent-input-wrapper border-t border-base-300 bg-base-100 p-3">
        <textarea
          className="agent-command textarea textarea-bordered min-h-24 w-full resize-none text-sm"
          aria-label="Note agent command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Ask the agent to update this note or create a new one."
        />
        <div className="agent-input-toolbar mt-2 flex items-center justify-between">
          <details className="agent-quick-action-dropdown dropdown dropdown-top" data-no-drag>
            <summary className="agent-quick-action-btn btn btn-ghost btn-sm btn-square" title="Quick Actions">
              <Zap size={16} />
            </summary>
            <div className="agent-quick-action-menu dropdown-content menu z-20 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
              {quickActions.map(({ action, label, icon: Icon, command: quickCommand }) => (
                <button
                  key={action}
                  className={activeAction === action ? 'active bg-primary/10 text-primary' : ''}
                  type="button"
                  onClick={(e) => {
                    setActiveAction(action)
                    setCommand(quickCommand)
                    const details = e.currentTarget.closest('details')
                    if (details) details.open = false
                  }}
                  title={label}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </details>
          <button className="agent-run-btn btn btn-primary btn-sm btn-square" title="Run agent" type="button" onClick={() => runAgent()} disabled={status === 'running' || status === 'applying'}>
            {status === 'running' ? <RefreshCw size={15} /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </div>
  )

  function toggleReviewGroup(groupId: string) {
    setReviewPlan((current) => current
      ? { ...current, groups: current.groups.map((group) => group.id === groupId ? { ...group, selected: !group.selected } : group) }
      : current)
  }
}

function renderStage(stage: string) {
  const stages = ['preparing', 'requesting', 'receiving', 'parsing', 'ready']
  return (
    <div className="agent-stage-list" aria-label="Agent progress">
      {stages.map((item) => (
        <span key={item} className={stage === item ? 'active' : ''}>{item}</span>
      ))}
    </div>
  )
}

function renderSessionTimeline(session: AgentSession | null) {
  if (!session || (session.turns.length === 0 && session.operationEvents.length === 0)) {
    return <p className="agent-empty text-sm text-base-content/60">No saved agent session for this note yet.</p>
  }
  return (
    <div className="agent-timeline">
      {session.turns.slice(-5).map((turn) => (
        <details key={turn.id} className="agent-timeline-item">
          <summary>{turn.command}</summary>
          <p>{turn.status}{turn.error ? `: ${turn.error}` : ''}</p>
        </details>
      ))}
      {session.operationEvents.slice(-3).map((event) => (
        <div key={event.id} className="agent-timeline-item applied">
          Applied {event.operationTypes.join(', ')}: {event.changedFields.join(', ') || 'note'}
        </div>
      ))}
    </div>
  )
}

function renderReviewPlan(plan: ReviewPlan | null, onToggleGroup: (id: string) => void) {
  if (!plan) return null
  return (
    <>
      <p className="panel-title compact">Review Plan</p>
      <div className="agent-review-plan">
        <p>{plan.message || 'Review the proposed changes before applying.'}</p>
        {plan.groups.map((group) => (
          <div key={group.id} className={`agent-review-group ${group.kind}`}>
            <label>
              <input
                type="checkbox"
                checked={group.selected}
                disabled={group.kind === 'risk' || group.kind === 'suggestion'}
                onChange={() => onToggleGroup(group.id)}
              />
              <strong>{group.title}</strong>
            </label>
            <small>{group.summary}</small>
            {group.items.map((item) => (
              <div className="agent-review-item" key={`${group.id}-${item.label}`}>
                <span>{item.label}</span>
                {item.before !== undefined || item.after !== undefined ? (
                  <code>{item.before ?? ''} -&gt; {item.after ?? ''}</code>
                ) : null}
                {item.previewMarkdown ? <pre>{item.previewMarkdown}</pre> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
