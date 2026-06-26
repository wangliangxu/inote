import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('note agent integration', () => {
  it('renders NoteAgent in the right sidebar instead of LlmAssistant', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toContain('NoteAgent')
    expect(app).not.toContain('const LlmAssistant')
    expect(app).not.toContain('<LlmAssistant')
  })

  it('has dedicated Note Agent styles', () => {
    const styles = readFileSync(resolve(__dirname, './styles.css'), 'utf8')

    expect(styles).toContain('.note-agent')
    expect(styles).toContain('.agent-review-plan')
    expect(styles).toContain('.agent-input-toolbar')
  })

  it('shares save path behavior between manual save and agent apply', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toContain('async function saveNoteWithPathSync')
    expect(app).toContain('await saveNoteWithPathSync(applied.note')
    expect(app).toContain('moveNote({')
  })

  it('wires persisted NoteAgent conversation props via useNoteAgent hook', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const agent = readFileSync(resolve(__dirname, '../features/agent/NoteAgent.tsx'), 'utf8')
    const hook = readFileSync(resolve(__dirname, '../features/agent/useNoteAgent.ts'), 'utf8')

    expect(app).toContain('vaultRoot={vaultRoot}')
    expect(app).toContain('onUndoLastApply={undoLastAgentApply}')
    expect(agent).toContain('useNoteAgent')
    expect(agent).toContain('AgentConversationView')
    expect(hook).toContain('loadAgentConversation')
    expect(hook).toContain('recordAgentMessages')
    expect(hook).toContain('buildReviewPlan')
    expect(hook).toContain('getRecentMeaningfulMessages')
    expect(hook).not.toContain('renderSessionTimeline')
  })

  it('records agent operation events and supports current-note undo wiring', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toContain('recordAgentOperationEvent')
    expect(app).toContain('buildOperationEventMessage')
    expect(app).toContain('recordAgentMessages({')
    expect(app).toContain('loadLastAgentUndoSnapshot')
    expect(app).toContain('clearLastAgentUndoSnapshot')
    expect(app).toContain('noteBeforeMarkdown: noteToMarkdown(activeNote)')
    expect(app).toContain('noteTitle: saved.title')
    expect(app).toContain('Undo is not available for created notes yet.')
    expect(app).toContain('action: "applied"')
    expect(app).toContain('action: "created"')
    expect(app).toContain('action: "undone"')
  })

  it('uses Codex-style conversation components for NoteAgent', () => {
    const view = readFileSync(resolve(__dirname, '../features/agent/AgentConversationView.tsx'), 'utf8')
    const bubble = readFileSync(resolve(__dirname, '../features/agent/AgentMessageBubble.tsx'), 'utf8')
    const review = readFileSync(resolve(__dirname, '../features/agent/AgentReviewMessage.tsx'), 'utf8')
    const composer = readFileSync(resolve(__dirname, '../features/agent/AgentComposer.tsx'), 'utf8')

    expect(view).toContain('agent-conversation-stream')
    expect(bubble).toContain('agent-message-bubble')
    expect(review).toContain('审阅计划')
    expect(review).toContain('decodeReviewPlanPayload')
    expect(composer).toContain('agent-composer')
  })

  it('does not use timeline as the primary NoteAgent experience', () => {
    const hook = readFileSync(resolve(__dirname, '../features/agent/useNoteAgent.ts'), 'utf8')

    expect(hook).toContain('loadAgentConversation')
    expect(hook).toContain('getRecentMeaningfulMessages')
    expect(hook).not.toContain('agent-stage-list')
    expect(hook).not.toContain('agent-timeline')
  })

  it('has Codex-style conversation sidebar styles', () => {
    const styles = readFileSync(resolve(__dirname, './styles.css'), 'utf8')

    expect(styles).toContain('.agent-conversation-stream')
    expect(styles).toContain('.agent-message-bubble.user')
    expect(styles).toContain('.agent-message-bubble.assistant')
    expect(styles).toContain('.agent-review-actions')
    expect(styles).toContain('.agent-composer')
  })

  it('uses shared agentUtils for ID generation', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const utils = readFileSync(resolve(__dirname, '../features/agent/agentUtils.ts'), 'utf8')

    expect(app).toContain('makeAgentId')
    expect(app).toContain('nowIso')
    expect(app).toContain('from "../features/agent/agentUtils"')
    expect(utils).toContain('export function makeAgentId')
    expect(utils).toContain('export function nowIso')
  })

  it('NoteAgent uses useNoteAgent hook with cancel support', () => {
    const agent = readFileSync(resolve(__dirname, '../features/agent/NoteAgent.tsx'), 'utf8')
    const hook = readFileSync(resolve(__dirname, '../features/agent/useNoteAgent.ts'), 'utf8')

    expect(agent).toContain('cancelAgent')
    expect(agent).toContain('onCancel={cancelAgent}')
    expect(hook).toContain('AbortController')
    expect(hook).toContain('cancelAgent')
  })

  it('supports Turn grouping and load-more in conversation history', () => {
    const view = readFileSync(resolve(__dirname, '../features/agent/AgentConversationView.tsx'), 'utf8')
    const hook = readFileSync(resolve(__dirname, '../features/agent/useNoteAgent.ts'), 'utf8')
    const agent = readFileSync(resolve(__dirname, '../features/agent/NoteAgent.tsx'), 'utf8')

    // Turn grouping
    expect(view).toContain('groupMessagesByTurn')
    expect(view).toContain('agent-turn-group')
    expect(view).toContain('agent-turn-collapsed')
    expect(view).toContain('TurnGroupView')

    // Load more
    expect(view).toContain('agent-load-more')
    expect(view).toContain('hasMoreMessages')
    expect(view).toContain('onLoadMore')
    expect(hook).toContain('loadMoreMessages')
    expect(hook).toContain('hasMoreMessages')
    expect(hook).toContain('INITIAL_DISPLAY_LIMIT')
    expect(agent).toContain('hasMoreMessages')
    expect(agent).toContain('loadMoreMessages')
  })

  it('has Turn group and load-more styles', () => {
    const styles = readFileSync(resolve(__dirname, './styles.css'), 'utf8')

    expect(styles).toContain('.agent-turn-group')
    expect(styles).toContain('.agent-turn-collapsed')
    expect(styles).toContain('.agent-turn-time')
    expect(styles).toContain('.agent-load-more')
    expect(styles).toContain('.agent-message-timestamp')
    expect(styles).toContain('.agent-detail-tab')
    expect(styles).toContain('.agent-review-badge')
    expect(styles).toContain('.agent-review-collapsed-header')
  })

  it('displays timestamps and Chinese labels in message bubbles', () => {
    const bubble = readFileSync(resolve(__dirname, '../features/agent/AgentMessageBubble.tsx'), 'utf8')
    const review = readFileSync(resolve(__dirname, '../features/agent/AgentReviewMessage.tsx'), 'utf8')

    // Timestamps
    expect(bubble).toContain('formatRelativeTime')
    expect(bubble).toContain('agent-message-timestamp')
    expect(review).toContain('formatRelativeTime')

    // Chinese labels
    expect(bubble).toContain('撤销')
    expect(bubble).toContain('查看详情')
    expect(review).toContain('审阅计划')
    expect(review).toContain('应用')
    expect(review).toContain('丢弃')
    expect(review).toContain('已应用')
    expect(review).toContain('已丢弃')
  })

  it('auto-collapses applied review plans', () => {
    const review = readFileSync(resolve(__dirname, '../features/agent/AgentReviewMessage.tsx'), 'utf8')

    expect(review).toContain('CollapsedReview')
    expect(review).toContain('applied-collapsed')
    expect(review).toContain('ReviewStatusBadge')
    expect(review).toContain('agent-review-collapsed-header')
  })
})
