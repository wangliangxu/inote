import { FilePlus2, ListChecks, RefreshCw, Send, Sparkles, Tags, Wand2, Zap } from 'lucide-react'
import type { QuickAgentAction } from './agentTypes'

interface AgentComposerProps {
  command: string
  activeAction?: QuickAgentAction
  disabled: boolean
  onCommandChange: (value: string) => void
  onActionSelect: (action: QuickAgentAction, command: string) => void
  onSubmit: () => void
}

const quickActions: Array<{ action: QuickAgentAction, label: string, icon: typeof Sparkles, command: string }> = [
  { action: 'summarize', label: 'Summary', icon: Sparkles, command: 'Update the summary for the current note.' },
  { action: 'suggest_tags', label: 'Tags', icon: Tags, command: 'Suggest and apply concise tags for the current note.' },
  { action: 'clean_metadata', label: 'YAML', icon: Wand2, command: 'Clean the current note metadata.' },
  { action: 'extract_tasks', label: 'Tasks', icon: ListChecks, command: 'Extract action items and append them to the current note.' },
  { action: 'continue_writing', label: 'Continue', icon: RefreshCw, command: 'Continue writing the current note.' },
  { action: 'create_related', label: 'Related', icon: FilePlus2, command: 'Create a related note that links back to the current note.' },
]

export function AgentComposer({
  command,
  activeAction,
  disabled,
  onCommandChange,
  onActionSelect,
  onSubmit,
}: AgentComposerProps) {
  return (
    <div className="agent-composer border-t border-base-300 bg-base-100 p-3">
      <textarea
        className="agent-command textarea textarea-bordered min-h-24 w-full resize-none text-sm"
        aria-label="Note agent command"
        value={command}
        onChange={(event) => onCommandChange(event.target.value)}
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
                onClick={(event) => {
                  onActionSelect(action, quickCommand)
                  const details = event.currentTarget.closest('details')
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
        <button className="agent-run-btn btn btn-primary btn-sm btn-square" title="Run agent" type="button" onClick={onSubmit} disabled={disabled}>
          {disabled ? <RefreshCw size={15} /> : <Send size={15} />}
        </button>
      </div>
    </div>
  )
}
