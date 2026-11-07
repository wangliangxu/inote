import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, FilePlus2, ListChecks, RefreshCw, Sparkles, Tags, Wand2, X, Zap } from 'lucide-react'
import type { QuickAgentAction } from './agentTypes'

interface AgentComposerProps {
  command: string
  activeAction?: QuickAgentAction
  disabled: boolean
  isRunning?: boolean
  onCommandChange: (value: string) => void
  onActionSelect: (action: QuickAgentAction, command: string) => void
  onSubmit: () => void
  onCancel?: () => void
}

export const quickActions: Array<{ action: QuickAgentAction, icon: typeof Sparkles }> = [
  { action: 'summarize', icon: Sparkles },
  { action: 'suggest_tags', icon: Tags },
  { action: 'clean_metadata', icon: Wand2 },
  { action: 'extract_tasks', icon: ListChecks },
  { action: 'continue_writing', icon: RefreshCw },
  { action: 'create_related', icon: FilePlus2 },
]

export function AgentComposer({
  command,
  activeAction,
  disabled,
  isRunning,
  onCommandChange,
  onActionSelect,
  onSubmit,
  onCancel,
}: AgentComposerProps) {
  const { t } = useTranslation()
  const actionDropdownRef = useRef<HTMLDetailsElement>(null)

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (!disabled) {
        onSubmit()
      }
    }
  }, [disabled, onSubmit])

  const handleActionBlur = useCallback((event: React.FocusEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      event.currentTarget.open = false
    }
  }, [])

  return (
    <div className="agent-composer border-t border-base-300 bg-base-100 p-3">
      <div className="agent-input-shell">
        <textarea
          className="agent-command textarea min-h-24 w-full resize-none text-sm"
          id="agent-command"
          aria-label={t('agent.commandLabel')}
          value={command}
          onChange={(event) => onCommandChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('agent.placeholder')}
          disabled={isRunning}
        />
        <div className="agent-input-toolbar flex items-center justify-between">
          <details
            ref={actionDropdownRef}
            className="agent-quick-action-dropdown dropdown dropdown-top"
            data-no-drag
            onBlur={handleActionBlur}
          >
            <summary className="agent-quick-action-btn btn btn-ghost btn-sm btn-square" title={t('agent.quickActions')} aria-label={t('agent.quickActions')}>
              <Zap size={16} />
            </summary>
            <div className="agent-quick-action-menu dropdown-content menu z-20 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
              {quickActions.map(({ action, icon: Icon }) => (
                <button
                  key={action}
                  className={activeAction === action ? 'active bg-primary/10 text-primary' : ''}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onActionSelect(action, t(`agent.commands.${action}`))
                    actionDropdownRef.current?.removeAttribute('open')
                  }}
                  title={t(`agent.actions.${action}`)}
                >
                  <Icon size={14} />
                  <span>{t(`agent.actions.${action}`)}</span>
                </button>
              ))}
            </div>
          </details>
          <div className="flex items-center gap-1">
            {isRunning && onCancel ? (
              <button
                className="agent-cancel-btn btn btn-ghost btn-sm btn-square"
                title={t('common.cancel')}
                aria-label={t('common.cancel')}
                type="button"
                onClick={onCancel}
              >
                <X size={15} />
              </button>
            ) : null}
            <button className="agent-run-btn btn btn-primary btn-sm btn-circle" title={`${t('agent.send')} (⌘↩)`} aria-label={t('agent.send')} type="button" onClick={onSubmit} disabled={disabled}>
              {disabled ? <RefreshCw size={16} /> : <ArrowUp className="agent-send-icon" size={18} strokeWidth={2.6} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
