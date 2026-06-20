import { useMemo, useState } from 'react'
import type { AgentOperation } from './agentTypes'
import { FilePlus2, ListChecks, Plus, RefreshCw, Send, Sparkles, Tags, Wand2, X, Zap } from 'lucide-react'
import { executeLlmChat, executeLlmChatStream } from '../../shared/api'
import type { LlmProviderSettings, Note } from '../../shared/types'
import { buildAgentPrompt } from './agentPrompts'
import { parseAgentResult } from './agentParser'
import { hasCreateNoteWrite, hasCurrentNoteWrite } from './applyAgentOperations'
import type { AgentResult, QuickAgentAction } from './agentTypes'

interface NoteAgentProps {
  note: Note
  notes: Note[]
  settings: LlmProviderSettings
  onApplyCurrentNote: (result: AgentResult) => Promise<void>
  onCreateNote: (result: AgentResult) => Promise<void>
}

const quickActions: Array<{ action: QuickAgentAction, label: string, icon: typeof Sparkles, command: string }> = [
  { action: 'summarize', label: 'Summary', icon: Sparkles, command: 'Update the summary for the current note.' },
  { action: 'suggest_tags', label: 'Tags', icon: Tags, command: 'Suggest and apply concise tags for the current note.' },
  { action: 'clean_metadata', label: 'YAML', icon: Wand2, command: 'Clean the current note metadata.' },
  { action: 'extract_tasks', label: 'Tasks', icon: ListChecks, command: 'Extract action items and append them to the current note.' },
  { action: 'continue_writing', label: 'Continue', icon: RefreshCw, command: 'Continue writing the current note.' },
  { action: 'create_related', label: 'Related', icon: FilePlus2, command: 'Create a related note that links back to the current note.' },
]

export function NoteAgent({ note, notes, settings, onApplyCurrentNote, onCreateNote }: NoteAgentProps) {
  const [command, setCommand] = useState('Update tags and summary for this note.')
  const [activeAction, setActiveAction] = useState<QuickAgentAction | undefined>()
  const [agentProcess, setAgentProcess] = useState<{ prompt: string, context: string, rawResponse?: string } | null>(null)
  const [result, setResult] = useState<AgentResult | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'applying' | 'error'>('idle')
  const [isProcessLogOpen, setIsProcessLogOpen] = useState(false)
  const [error, setError] = useState('')

  const canApplyCurrent = useMemo(() => result ? hasCurrentNoteWrite(result.operations) : false, [result])
  const canCreate = useMemo(() => result ? hasCreateNoteWrite(result.operations) : false, [result])

  async function runAgent(nextAction = activeAction, nextCommand = command) {
    setError('')
    setResult(null)
    if (!settings.apiKey.trim()) {
      setStatus('error')
      setError('Add an LLM API key in Settings first.')
      return
    }

    try {
      setStatus('running')
      setIsProcessLogOpen(true)
      const request = buildAgentPrompt({ command: nextCommand, note, notes, action: nextAction, maxContextLength: settings.maxContextLength })
      setAgentProcess({ prompt: request.prompt, context: request.context, rawResponse: '' })
      
      let fullResponse = ''
      await executeLlmChatStream({
        settings,
        prompt: request.prompt,
        context: request.context,
      }, (chunk) => {
        fullResponse += chunk
        setAgentProcess(prev => prev ? { ...prev, rawResponse: fullResponse } : null)
      })

      setResult(parseAgentResult(fullResponse))
      setStatus('idle')
      setIsProcessLogOpen(false)
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function applyCurrent() {
    if (!result) return
    setStatus('applying')
    try {
      await onApplyCurrentNote(result)
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function createNote() {
    if (!result) return
    setStatus('applying')
    try {
      await onCreateNote(result)
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

        {result && (
          <>
            <p className="panel-title compact">Proposed Changes</p>
            <div className="agent-change-list card border border-base-300 bg-base-100 shadow-sm">
              <div className="card-body gap-3 p-3">
              <p className="text-sm text-base-content/70">{result.message || 'Review the proposed operations before applying.'}</p>
              {result.operations.map((operation, index) => (
                <div className="agent-change rounded-lg border border-base-300 bg-base-200/50 p-3" key={`${operation.type}-${index}`}>
                  <strong className="text-sm capitalize">{operation.type.replace(/_/g, ' ')}</strong>
                  {renderOperationDetails(operation)}
                </div>
              ))}
              </div>
            </div>
            <div className="agent-footer flex items-center gap-2">
              <button className="btn btn-primary btn-sm btn-square" type="button" onClick={applyCurrent} disabled={!canApplyCurrent || status === 'applying'} title="Apply to current note">
                <Plus size={15} />
              </button>
              <button className="btn btn-outline btn-sm btn-square" type="button" onClick={createNote} disabled={!canCreate || status === 'applying'} title="Create note">
                <FilePlus2 size={15} />
              </button>
              <div className="flex-1"></div>
              <button className="btn btn-ghost btn-sm btn-square" type="button" onClick={() => setResult(null)} disabled={status === 'applying'} title="Discard">
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
}

function renderOperationDetails(operation: AgentOperation) {
  switch (operation.type) {
    case 'update_current_note':
      return (
        <div className="operation-details">
          {Object.entries(operation.patch).map(([key, value]) => (
            <div key={key} className="detail-row">
              <span className="detail-key">{key}:</span>
              <span className="detail-value">{Array.isArray(value) ? value.join(', ') : String(value)}</span>
            </div>
          ))}
        </div>
      )
    case 'append_to_current_note':
    case 'replace_current_note_body':
    case 'suggest_only':
      return (
        <div className="operation-details">
          <pre>{operation.markdown}</pre>
        </div>
      )
    case 'create_note':
      return (
        <div className="operation-details">
          <div className="detail-row"><span className="detail-key">Title:</span> <span className="detail-value">{operation.note.title}</span></div>
          <div className="detail-row"><span className="detail-key">Category:</span> <span className="detail-value">{operation.note.category}</span></div>
          {operation.note.tags && operation.note.tags.length > 0 && (
            <div className="detail-row"><span className="detail-key">Tags:</span> <span className="detail-value">{operation.note.tags.join(', ')}</span></div>
          )}
          {operation.note.summary && (
            <div className="detail-row"><span className="detail-key">Summary:</span> <span className="detail-value">{operation.note.summary}</span></div>
          )}
          <div className="detail-row"><span className="detail-key">Body:</span></div>
          <pre>{operation.note.body}</pre>
        </div>
      )
    default:
      return <pre>{JSON.stringify(operation, null, 2)}</pre>
  }
}
