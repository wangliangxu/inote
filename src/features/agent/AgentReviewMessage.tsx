import type { AgentMessage, ReviewPlan } from '../../shared/types'
import { decodeReviewPlanPayload } from './agentMessagePayloads'

interface AgentReviewMessageProps {
  message: AgentMessage
  disabled: boolean
  onToggleGroup: (messageId: string, groupId: string) => void
  onApply: (message: AgentMessage, plan: ReviewPlan) => void
  onCreate: (message: AgentMessage, plan: ReviewPlan) => void
  onDiscard: (message: AgentMessage) => void
}

export function AgentReviewMessage({
  message,
  disabled,
  onToggleGroup,
  onApply,
  onCreate,
  onDiscard,
}: AgentReviewMessageProps) {
  const plan = decodeReviewPlanPayload(message.payloadJson)
  if (!plan) {
    return <div className="agent-review-plan invalid">Review Plan could not be loaded.</div>
  }

  const hasCurrentNoteOperation = plan.groups.some((group) => (
    group.selected && group.operationIndexes.length > 0 && group.kind !== 'create_note' && group.kind !== 'risk' && group.kind !== 'suggestion'
  ))
  const hasCreateOperation = plan.groups.some((group) => group.selected && group.kind === 'create_note')
  const isApplied = message.status === 'applied'

  return (
    <div className={`agent-review-plan ${isApplied ? 'applied' : ''}`}>
      <p className="panel-title compact">Review Plan</p>
      <p>{plan.message || message.text || 'Review the proposed changes before applying.'}</p>
      {plan.groups.map((group) => (
        <div key={group.id} className={`agent-review-group ${group.kind}`}>
          <label>
            <input
              type="checkbox"
              checked={group.selected}
              disabled={disabled || isApplied || group.kind === 'risk' || group.kind === 'suggestion'}
              onChange={() => onToggleGroup(message.id, group.id)}
            />
            <strong>{group.title}</strong>
          </label>
          <small>{group.summary}</small>
          {group.items.map((item) => (
            <div className="agent-review-item" key={`${group.id}-${item.label}`}>
              <span>{item.label}</span>
              {item.before !== undefined || item.after !== undefined ? <code>{item.before ?? ''} -&gt; {item.after ?? ''}</code> : null}
              {item.previewMarkdown ? <pre>{item.previewMarkdown}</pre> : null}
            </div>
          ))}
        </div>
      ))}
      <div className="agent-review-actions">
        <button className="btn btn-primary btn-sm" type="button" disabled={disabled || isApplied || !hasCurrentNoteOperation} onClick={() => onApply(message, plan)}>Apply</button>
        <button className="btn btn-outline btn-sm" type="button" disabled={disabled || isApplied || !hasCreateOperation} onClick={() => onCreate(message, plan)}>Create</button>
        <button className="btn btn-ghost btn-sm" type="button" disabled={disabled || isApplied} onClick={() => onDiscard(message)}>Discard</button>
      </div>
    </div>
  )
}
