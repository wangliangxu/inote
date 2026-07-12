import { useCallback, useRef } from 'react'
import { FilePlus2, ListChecks, RefreshCw, Send, Sparkles, Tags, Wand2, X, Zap } from 'lucide-react'
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

const quickActions: Array<{ action: QuickAgentAction, label: string, icon: typeof Sparkles, command: string }> = [
  { action: 'summarize', label: '摘要', icon: Sparkles, command: '更新当前笔记的摘要。' },
  { action: 'suggest_tags', label: '标签', icon: Tags, command: '为当前笔记建议并应用简洁的标签。' },
  { action: 'clean_metadata', label: 'YAML', icon: Wand2, command: '清理当前笔记的元数据。' },
  { action: 'extract_tasks', label: '任务', icon: ListChecks, command: '提取待办事项并追加到当前笔记。' },
  { action: 'continue_writing', label: '续写', icon: RefreshCw, command: '续写当前笔记内容。' },
  { action: 'create_related', label: '关联', icon: FilePlus2, command: '创建一个关联笔记并链接回当前笔记。' },
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
          aria-label="Note agent command"
          value={command}
          onChange={(event) => onCommandChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入指令让 Agent 更新或创建笔记。（⌘/Ctrl+Enter 提交）"
          disabled={isRunning}
        />
        <div className="agent-input-toolbar flex items-center justify-between">
          <details
            ref={actionDropdownRef}
            className="agent-quick-action-dropdown dropdown dropdown-top"
            data-no-drag
            onBlur={handleActionBlur}
          >
            <summary className="agent-quick-action-btn btn btn-ghost btn-sm btn-square" title="Quick Actions">
              <Zap size={16} />
            </summary>
            <div className="agent-quick-action-menu dropdown-content menu z-20 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
              {quickActions.map(({ action, label, icon: Icon, command: quickCommand }) => (
                <button
                  key={action}
                  className={activeAction === action ? 'active bg-primary/10 text-primary' : ''}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onActionSelect(action, quickCommand)
                    actionDropdownRef.current?.removeAttribute('open')
                  }}
                  title={label}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </details>
          <div className="flex items-center gap-1">
            {isRunning && onCancel ? (
              <button
                className="agent-cancel-btn btn btn-ghost btn-sm btn-square"
                title="取消"
                type="button"
                onClick={onCancel}
              >
                <X size={15} />
              </button>
            ) : null}
            <button className="agent-run-btn btn btn-primary btn-sm btn-square" title="运行 Agent" type="button" onClick={onSubmit} disabled={disabled}>
              {disabled ? <RefreshCw size={15} /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
