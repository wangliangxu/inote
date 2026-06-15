import { useMemo, useState } from 'react'
import { FilePlus2, ListChecks, Plus, RefreshCw, Send, Sparkles, Tags, Wand2, X } from 'lucide-react'
import { executeLlmChat } from '../../shared/api'
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
      const response = await executeLlmChat({
        settings,
        prompt: request.prompt,
        context: request.context,
      })
      setResult(parseAgentResult(response.content))
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
      <div className="scope-pill">Note Agent</div>
      <textarea
        className="agent-command"
        aria-label="Note agent command"
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        placeholder="Ask the agent to update this note or create a new one."
      />
      <div className="agent-quick-actions" aria-label="Quick agent actions">
        {quickActions.map(({ action, label, icon: Icon, command: quickCommand }) => (
          <button
            key={action}
            className={activeAction === action ? 'active' : ''}
            type="button"
            onClick={() => {
              setActiveAction(action)
              setCommand(quickCommand)
            }}
            title={label}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <button className="llm-action" type="button" onClick={() => runAgent()} disabled={status === 'running' || status === 'applying'}>
        <Send size={14} />
        {status === 'running' ? 'Running...' : 'Run agent'}
      </button>
      <p className="panel-title compact">Proposed Changes</p>
      {error ? <p className="agent-error">{error}</p> : null}
      {result ? (
        <div className="agent-change-list">
          <p>{result.message || 'Review the proposed operations before applying.'}</p>
          {result.operations.map((operation, index) => (
            <div className="agent-change" key={`${operation.type}-${index}`}>
              <strong>{operation.type.replace(/_/g, ' ')}</strong>
              <pre>{JSON.stringify(operation, null, 2)}</pre>
            </div>
          ))}
        </div>
      ) : !error ? (
        <p className="agent-empty">Run the agent to preview changes here.</p>
      ) : null}
      <div className="agent-footer">
        <button type="button" onClick={() => setResult(null)} disabled={!result || status === 'applying'} title="Discard">
          <X size={15} />
        </button>
        <button type="button" onClick={applyCurrent} disabled={!canApplyCurrent || status === 'applying'} title="Apply to current note">
          <Plus size={15} />
          <span>Apply</span>
        </button>
        <button type="button" onClick={createNote} disabled={!canCreate || status === 'applying'} title="Create note">
          <FilePlus2 size={15} />
          <span>Create</span>
        </button>
      </div>
    </div>
  )
}
