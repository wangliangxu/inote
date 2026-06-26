import type { AgentMessage } from '../../shared/types'
import { decodeAssistantResultPayload, decodeOperationEventPayload } from './agentMessagePayloads'

interface AgentMessageBubbleProps {
  message: AgentMessage
  onUndo: (message: AgentMessage) => void
}

export function AgentMessageBubble({ message, onUndo }: AgentMessageBubbleProps) {
  if (message.kind === 'operation_event') {
    const payload = decodeOperationEventPayload(message.payloadJson)
    return (
      <div className={`agent-message-bubble ${message.role} ${message.kind}`}>
        <p>{message.text}</p>
        {payload?.event.changedFields.length ? <small>Changed: {payload.event.changedFields.join(', ')}</small> : null}
        {payload?.event.createdNotePath ? <small>Created: {payload.event.createdNotePath}</small> : null}
        {payload?.canUndo ? <button className="btn btn-ghost btn-xs" type="button" onClick={() => onUndo(message)}>Undo</button> : null}
      </div>
    )
  }

  if (message.kind === 'assistant_result') {
    const details = decodeAssistantResultPayload(message.payloadJson)
    return (
      <div className={`agent-message-bubble ${message.role} ${message.kind}`}>
        <p>{message.text}</p>
        {details ? (
          <details>
            <summary>Details</summary>
            <strong>Prompt</strong>
            <pre>{details.prompt}</pre>
            <strong>Context</strong>
            <pre>{details.context}</pre>
            <strong>Raw response</strong>
            <pre>{details.rawResponse}</pre>
          </details>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`agent-message-bubble ${message.role} ${message.kind}`}>
      <p>{message.text}</p>
    </div>
  )
}
