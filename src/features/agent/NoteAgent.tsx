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
      const request = buildAgentPrompt({ command: nextCommand, note, notes, action: nextAction })
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
    <div className="note-agent">
      <div className="agent-scroll-area">
        {error ? <p className="agent-error">{error}</p> : null}
        
        {result && (
          <>
            <p className="panel-title compact">Proposed Changes</p>
            <div className="agent-change-list">
              <p>{result.message || 'Review the proposed operations before applying.'}</p>
              {result.operations.map((operation, index) => (
                <div className="agent-change" key={`${operation.type}-${index}`}>
                  <strong>{operation.type.replace(/_/g, ' ')}</strong>
                  {renderOperationDetails(operation)}
                </div>
              ))}
            </div>
            <div className="agent-footer">
              <button type="button" onClick={applyCurrent} disabled={!canApplyCurrent || status === 'applying'} title="Apply to current note">
                <Plus size={15} />
              </button>
              <button type="button" onClick={createNote} disabled={!canCreate || status === 'applying'} title="Create note">
                <FilePlus2 size={15} />
              </button>
              <div style={{ flex: 1 }}></div>
              <button type="button" onClick={() => setResult(null)} disabled={status === 'applying'} title="Discard">
                <X size={15} />
              </button>
            </div>
          </>
        )}

        {agentProcess && (
          <details className="agent-process-log" open={status === 'running'}>
            <summary>Agent Process Log</summary>
            <div className="agent-process-content">
              <strong>System Prompt</strong>
              <pre>{agentProcess.prompt}</pre>
              <strong>Context</strong>
              <pre>{agentProcess.context}</pre>
              <strong>Raw Response</strong>
              <pre>{agentProcess.rawResponse || 'Waiting for response...'}</pre>
            </div>
          </details>
        )}
      </div>

      <div className="agent-input-wrapper">
        <textarea
          className="agent-command"
          aria-label="Note agent command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Ask the agent to update this note or create a new one."
        />
        <div className="agent-input-toolbar">
          <details className="agent-quick-action-dropdown" data-no-drag>
            <summary className="agent-quick-action-btn" title="Quick Actions">
              <Zap size={16} />
            </summary>
            <div className="agent-quick-action-menu">
              {quickActions.map(({ action, label, icon: Icon, command: quickCommand }) => (
                <button
                  key={action}
                  className={activeAction === action ? 'active' : ''}
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
          <button className="agent-run-btn" title="Run agent" type="button" onClick={() => runAgent()} disabled={status === 'running' || status === 'applying'}>
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
