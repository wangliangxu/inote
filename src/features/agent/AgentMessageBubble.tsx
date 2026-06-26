import { useState } from 'react'
import { Undo } from 'lucide-react'
import type { AgentMessage } from '../../shared/types'
import { decodeAssistantResultPayload, decodeOperationEventPayload } from './agentMessagePayloads'
import { formatRelativeTime } from './agentTimeFormat'

const FIELD_LABELS: Record<string, string> = {
  title: '标题',
  category: '分类',
  tags: '标签',
  summary: '摘要',
  due: '截止日期',
  status: '状态',
  priority: '优先级',
  project: '项目',
}

function translateField(field: string): string {
  return FIELD_LABELS[field] ?? field
}

interface AgentMessageBubbleProps {
  message: AgentMessage
  onUndo: (message: AgentMessage) => void
}

type DetailTab = 'prompt' | 'context' | 'response'

function MessageTimestamp({ iso }: { iso: string }) {
  const label = formatRelativeTime(iso)
  return <time className="agent-message-timestamp">{label}</time>
}

function DetailTabs({ details }: { details: { prompt: string, context: string, rawResponse: string } }) {
  const [activeTab, setActiveTab] = useState<DetailTab>('response')

  const tabs: Array<{ key: DetailTab, label: string }> = [
    { key: 'response', label: '响应' },
    { key: 'prompt', label: '提示词' },
    { key: 'context', label: '上下文' },
  ]

  const content = activeTab === 'prompt' ? details.prompt
    : activeTab === 'context' ? details.context
    : details.rawResponse

  return (
    <div className="agent-detail-tabs">
      <div className="agent-detail-tab-bar">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`agent-detail-tab ${activeTab === key ? 'active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <pre className="agent-detail-content">{content}</pre>
    </div>
  )
}

export function AgentMessageBubble({ message, onUndo }: AgentMessageBubbleProps) {
  if (message.kind === 'operation_event') {
    const payload = decodeOperationEventPayload(message.payloadJson)
    const fields = payload?.event.changedFields ?? []
    return (
      <div className="agent-operation-event">
        <div className="agent-operation-event-content">
          <span>
            {message.text}
            {fields.length > 0 ? ` (${fields.map(translateField).join('、')})` : ''}
          </span>
          {payload?.canUndo ? (
            <button className="btn btn-ghost btn-xs agent-operation-undo" type="button" onClick={() => onUndo(message)}>
              <Undo size={12} /> 撤销
            </button>
          ) : null}
        </div>
        <MessageTimestamp iso={message.createdAt} />
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
            <summary>查看详情</summary>
            <DetailTabs details={details} />
          </details>
        ) : null}
        <MessageTimestamp iso={message.createdAt} />
      </div>
    )
  }

  if (message.kind === 'error') {
    return (
      <div className={`agent-message-bubble ${message.role} error`}>
        <p>{message.text}</p>
        <MessageTimestamp iso={message.createdAt} />
      </div>
    )
  }

  // user_command, assistant_status, etc.
  return (
    <div className={`agent-message-bubble ${message.role} ${message.kind}`}>
      <p>{message.text}</p>
      <MessageTimestamp iso={message.createdAt} />
    </div>
  )
}
