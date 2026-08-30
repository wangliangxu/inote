import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Trash2, Undo, X } from 'lucide-react'
import type { AgentMessage, ReviewPlan } from '../../shared/types'
import { decodeOperationEventPayload, decodeReviewPlanPayload } from './agentMessagePayloads'
import { formatRelativeTime } from './agentTimeFormat'

function ReviewDiff({ lines }: { lines: NonNullable<import('../../shared/types').ReviewItem['diffLines']> }) {
  return (
    <pre className="agent-review-diff">
      {lines.map((line, index) => (
        <span className={`agent-diff-line ${line.kind}`} key={`${index}-${line.text}`}>
          {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '} {line.text || ' '}
        </span>
      ))}
    </pre>
  )
}

interface AgentReviewMessageProps {
  message: AgentMessage
  disabled: boolean
  operationEvent?: AgentMessage
  onToggleGroup: (messageId: string, groupId: string) => void
  onApply: (message: AgentMessage, plan: ReviewPlan) => void
  onCreate: (message: AgentMessage, plan: ReviewPlan) => void
  onDiscard: (message: AgentMessage) => void
  onUndo?: (message: AgentMessage) => void
}

function ReviewStatusBadge({ status }: { status: 'applied' | 'discarded' }) {
  if (status === 'applied') {
    return <span className="agent-review-badge applied"><Check size={12} /> 已应用</span>
  }
  return <span className="agent-review-badge discarded"><X size={12} /> 已丢弃</span>
}

export function AgentReviewMessage({
  message,
  disabled,
  operationEvent,
  onToggleGroup,
  onApply,
  onCreate,
  onDiscard,
  onUndo,
}: AgentReviewMessageProps) {
  const plan = decodeReviewPlanPayload(message.payloadJson)
  if (!plan) {
    return <div className="agent-review-plan invalid">审阅计划加载失败。</div>
  }

  const isApplied = message.status === 'applied'
  const isDiscarded = message.status === 'discarded'
  const isFinished = isApplied || isDiscarded

  // Collapsed view for finished review plans
  if (isFinished) {
    return <CollapsedReview message={message} plan={plan} isApplied={isApplied} operationEvent={operationEvent} onUndo={onUndo} />
  }

  const hasCurrentNoteOperation = plan.groups.some((group) => (
    group.selected && group.operationIndexes.length > 0 && group.kind !== 'create_note' && group.kind !== 'risk' && group.kind !== 'suggestion'
  ))
  const hasCreateOperation = plan.groups.some((group) => group.selected && group.kind === 'create_note')

  return (
    <div className="agent-review-plan">
      <p className="panel-title compact">审阅计划</p>
      <p>{plan.message || message.text || '请在应用前审阅以下修改建议。'}</p>
      {plan.groups.map((group) => (
        <div key={group.id} className={`agent-review-group ${group.kind}`}>
          <label>
            <input
              type="checkbox"
              checked={group.selected}
              disabled={disabled || group.kind === 'risk' || group.kind === 'suggestion'}
              onChange={() => onToggleGroup(message.id, group.id)}
            />
            <strong>{group.title}</strong>
          </label>
          <small>{group.summary}</small>
          {group.items.map((item) => (
            <div className="agent-review-item" key={`${group.id}-${item.label}`}>
              <span>{item.label}</span>
              {item.before !== undefined || item.after !== undefined ? <code>{item.before ?? ''} -&gt; {item.after ?? ''}</code> : null}
              {item.diffLines ? <ReviewDiff lines={item.diffLines} /> : null}
              {item.previewMarkdown ? <pre>{item.previewMarkdown}</pre> : null}
            </div>
          ))}
        </div>
      ))}
      <div className="agent-review-actions">
        <button className="agent-apply-btn btn btn-primary btn-sm" type="button" disabled={disabled || !hasCurrentNoteOperation} onClick={() => onApply(message, plan)}>应用</button>
        <button className="btn btn-outline btn-sm" type="button" disabled={disabled || !hasCreateOperation} onClick={() => onCreate(message, plan)}>创建</button>
        <button className="btn btn-ghost btn-sm" type="button" disabled={disabled} onClick={() => onDiscard(message)}>
          <Trash2 size={13} /> 丢弃
        </button>
      </div>
      <time className="agent-message-timestamp">{formatRelativeTime(message.createdAt)}</time>
    </div>
  )
}

function CollapsedReview({ 
  message, 
  plan, 
  isApplied, 
  operationEvent, 
  onUndo 
}: { 
  message: AgentMessage
  plan: ReviewPlan
  isApplied: boolean
  operationEvent?: AgentMessage
  onUndo?: (message: AgentMessage) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const groupSummary = plan.groups
    .filter((group) => group.selected)
    .map((group) => group.title)
    .join(', ')

  const opPayload = operationEvent ? decodeOperationEventPayload(operationEvent.payloadJson) : null
  const canUndo = opPayload?.canUndo && onUndo

  return (
    <div className={`agent-review-plan applied-collapsed ${expanded ? 'expanded' : ''}`}>
      <div className="agent-review-collapsed-header-wrapper">
        <button
          type="button"
          className="agent-review-collapsed-header"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <ReviewStatusBadge status={isApplied ? 'applied' : 'discarded'} />
          <span className="agent-review-collapsed-summary">{groupSummary || '审阅计划'}</span>
          <time className="agent-message-timestamp">{formatRelativeTime(message.createdAt)}</time>
        </button>
        {canUndo && operationEvent ? (
          <button className="btn btn-ghost btn-xs agent-operation-undo" type="button" onClick={() => onUndo(operationEvent)}>
            <Undo size={12} /> 撤销
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="agent-review-collapsed-body">
          <p>{plan.message || message.text}</p>
          {plan.groups.map((group) => (
            <div key={group.id} className={`agent-review-group ${group.kind} readonly`}>
              <label>
                <input type="checkbox" checked={group.selected} disabled />
                <strong>{group.title}</strong>
              </label>
              <small>{group.summary}</small>
              {group.items.map((item) => (
                <div className="agent-review-item" key={`${group.id}-${item.label}`}>
                  <span>{item.label}</span>
                  {item.before !== undefined || item.after !== undefined ? <code>{item.before ?? ''} -&gt; {item.after ?? ''}</code> : null}
                  {item.diffLines ? <ReviewDiff lines={item.diffLines} /> : null}
                  {item.previewMarkdown ? <pre>{item.previewMarkdown}</pre> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
