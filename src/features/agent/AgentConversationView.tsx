import type { AgentMessage, ReviewPlan } from '../../shared/types'
import { sortConversationMessages } from './agentConversation'
import { AgentMessageBubble } from './AgentMessageBubble'
import { AgentReviewMessage } from './AgentReviewMessage'

interface AgentConversationViewProps {
  messages: AgentMessage[]
  disabled: boolean
  onToggleReviewGroup: (messageId: string, groupId: string) => void
  onApplyReview: (message: AgentMessage, plan: ReviewPlan) => void
  onCreateReview: (message: AgentMessage, plan: ReviewPlan) => void
  onDiscardReview: (message: AgentMessage) => void
  onUndo: (message: AgentMessage) => void
}

export function AgentConversationView({
  messages,
  disabled,
  onToggleReviewGroup,
  onApplyReview,
  onCreateReview,
  onDiscardReview,
  onUndo,
}: AgentConversationViewProps) {
  const sorted = sortConversationMessages(messages)
  if (sorted.length === 0) {
    return <p className="agent-empty text-sm text-base-content/60">No saved agent conversation for this note yet.</p>
  }

  return (
    <div className="agent-conversation-stream">
      {sorted.map((message) => (
        message.kind === 'review_plan'
          ? (
            <AgentReviewMessage
              key={message.id}
              message={message}
              disabled={disabled}
              onToggleGroup={onToggleReviewGroup}
              onApply={onApplyReview}
              onCreate={onCreateReview}
              onDiscard={onDiscardReview}
            />
          )
          : <AgentMessageBubble key={message.id} message={message} onUndo={onUndo} />
      ))}
    </div>
  )
}
