import { useState } from 'react'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import type { AgentMessage, ReviewPlan } from '../../shared/types'
import { sortConversationMessages } from './agentConversation'
import { AgentMessageBubble } from './AgentMessageBubble'
import { AgentReviewMessage } from './AgentReviewMessage'
import { formatTurnTimestamp } from './agentTimeFormat'

interface AgentConversationViewProps {
  messages: AgentMessage[]
  disabled: boolean
  hasMoreMessages?: boolean
  onLoadMore?: () => void
  onToggleReviewGroup: (messageId: string, groupId: string) => void
  onApplyReview: (message: AgentMessage, plan: ReviewPlan) => void
  onCreateReview: (message: AgentMessage, plan: ReviewPlan) => void
  onDiscardReview: (message: AgentMessage) => void
  onUndo: (message: AgentMessage) => void
}

interface TurnGroup {
  turnId: string | null
  messages: AgentMessage[]
  timestamp: string
  commandText: string
  isCompleted: boolean
}

function groupMessagesByTurn(messages: AgentMessage[]): TurnGroup[] {
  const sorted = sortConversationMessages(messages)
  const groups: TurnGroup[] = []
  const turnMap = new Map<string, AgentMessage[]>()
  const orphans: AgentMessage[] = []

  for (const message of sorted) {
    if (message.turnId) {
      const existing = turnMap.get(message.turnId)
      if (existing) {
        existing.push(message)
      } else {
        turnMap.set(message.turnId, [message])
      }
    } else {
      orphans.push(message)
    }
  }

  // Build ordered groups by first message appearance
  const seenTurns = new Set<string>()
  for (const message of sorted) {
    if (message.turnId && !seenTurns.has(message.turnId)) {
      seenTurns.add(message.turnId)
      const turnMessages = turnMap.get(message.turnId) ?? []
      const userCommand = turnMessages.find((m) => m.kind === 'user_command')
      const hasApplied = turnMessages.some((m) => m.status === 'applied')
      const hasDiscarded = turnMessages.some((m) => m.status === 'discarded')
      const hasFailed = turnMessages.some((m) => m.status === 'failed')
      const hasReady = turnMessages.some((m) => m.kind === 'review_plan' && m.status === 'ready')

      groups.push({
        turnId: message.turnId,
        messages: turnMessages,
        timestamp: turnMessages[0]?.createdAt ?? '',
        commandText: userCommand?.text ?? '',
        isCompleted: hasApplied || hasDiscarded || hasFailed || (!hasReady && turnMessages.every((m) => m.status === 'ready')),
      })
    } else if (!message.turnId) {
      // Standalone messages (operation events without turnId)
      groups.push({
        turnId: null,
        messages: [message],
        timestamp: message.createdAt,
        commandText: message.text,
        isCompleted: true,
      })
    }
  }

  return groups
}

function TurnGroupView({
  group,
  isLast,
  disabled,
  onToggleReviewGroup,
  onApplyReview,
  onCreateReview,
  onDiscardReview,
  onUndo,
}: {
  group: TurnGroup
  isLast: boolean
  disabled: boolean
  onToggleReviewGroup: (messageId: string, groupId: string) => void
  onApplyReview: (message: AgentMessage, plan: ReviewPlan) => void
  onCreateReview: (message: AgentMessage, plan: ReviewPlan) => void
  onDiscardReview: (message: AgentMessage) => void
  onUndo: (message: AgentMessage) => void
}) {
  const [expanded, setExpanded] = useState(!group.isCompleted || isLast)

  // For standalone messages (no turnId), render directly
  if (!group.turnId) {
    return (
      <div className="agent-turn-group standalone">
        {group.messages.map((message) => (
          <AgentMessageBubble key={message.id} message={message} onUndo={onUndo} />
        ))}
      </div>
    )
  }

  const timeLabel = formatTurnTimestamp(group.timestamp)

  // Collapsed view for completed turns
  if (!expanded) {
    return (
      <button
        type="button"
        className="agent-turn-collapsed"
        onClick={() => setExpanded(true)}
        title="点击展开详情"
      >
        <ChevronRight size={14} className="agent-turn-chevron" />
        <span className="agent-turn-command">{group.commandText || '(Agent 操作)'}</span>
        {timeLabel ? <time className="agent-turn-time">{timeLabel}</time> : null}
      </button>
    )
  }

  // Filter out noise messages within the turn:
  // - assistant_status is transient (streaming progress, "审阅计划已就绪") — always hide in history
  // - assistant_result is redundant when a review_plan exists in the same turn
  // - operation_event is merged into the review_plan if one exists
  const hasReviewPlan = group.messages.some((m) => m.kind === 'review_plan')
  const operationEvent = group.messages.find((m) => m.kind === 'operation_event')
  const visibleMessages = group.messages.filter((m) => {
    if (m.kind === 'assistant_status') return false
    if (m.kind === 'assistant_result' && hasReviewPlan) return false
    if (m.kind === 'operation_event' && hasReviewPlan) return false
    return true
  })

  return (
    <div className="agent-turn-group">
      <button
        type="button"
        className="agent-turn-header"
        onClick={() => group.isCompleted ? setExpanded(false) : undefined}
        title={group.isCompleted ? '点击折叠' : undefined}
      >
        {group.isCompleted ? <ChevronDown size={14} className="agent-turn-chevron" /> : null}
        {timeLabel ? <time className="agent-turn-time">{timeLabel}</time> : null}
      </button>
      <div className="agent-turn-messages">
        {visibleMessages.map((message) => (
          message.kind === 'review_plan'
            ? (
              <AgentReviewMessage
                key={message.id}
                message={message}
                disabled={disabled}
                operationEvent={operationEvent}
                onToggleGroup={onToggleReviewGroup}
                onApply={onApplyReview}
                onCreate={onCreateReview}
                onDiscard={onDiscardReview}
                onUndo={onUndo}
              />
            )
            : <AgentMessageBubble key={message.id} message={message} onUndo={onUndo} />
        ))}
      </div>
    </div>
  )
}

export function AgentConversationView({
  messages,
  disabled,
  hasMoreMessages,
  onLoadMore,
  onToggleReviewGroup,
  onApplyReview,
  onCreateReview,
  onDiscardReview,
  onUndo,
}: AgentConversationViewProps) {
  if (messages.length === 0) {
    return null
  }

  const groups = groupMessagesByTurn(messages)

  return (
    <div className="agent-conversation-stream">
      {hasMoreMessages && onLoadMore ? (
        <button
          type="button"
          className="agent-load-more"
          onClick={onLoadMore}
        >
          <History size={14} />
          <span>加载更多历史</span>
        </button>
      ) : null}
      {groups.map((group, index) => (
        <TurnGroupView
          key={group.turnId ?? `orphan-${group.messages[0]?.id}`}
          group={group}
          isLast={index === groups.length - 1}
          disabled={disabled}
          onToggleReviewGroup={onToggleReviewGroup}
          onApplyReview={onApplyReview}
          onCreateReview={onCreateReview}
          onDiscardReview={onDiscardReview}
          onUndo={onUndo}
        />
      ))}
    </div>
  )
}
