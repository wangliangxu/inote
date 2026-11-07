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
    expect(app).toContain('await saveNoteWithPathSync(change.note')
    expect(app).toContain('commitNote({')
  })

  it('validates stale reviews in the shared commit builder', () => {
    const commit = readFileSync(resolve(__dirname, '../features/agent/agentNoteCommit.ts'), 'utf8')
    expect(commit.includes('result.baseNoteRevision !== noteRevision(before)')).toBe(true)
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

  it('creates the agent session before recording its first messages', () => {
    const hook = readFileSync(resolve(__dirname, '../features/agent/useNoteAgent.ts'), 'utf8')
    const runningTurn = hook.indexOf("status: 'running'")
    const firstMessageWrite = hook.indexOf('await recordAgentMessages')

    expect(runningTurn).toBeGreaterThan(-1)
    expect(firstMessageWrite).toBeGreaterThan(runningTurn)
  })

  it('uses the transactional commit and version-checked undo APIs', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const commit = readFileSync(resolve(__dirname, '../features/agent/agentNoteCommit.ts'), 'utf8')
    expect(app.includes('undoAgentChange(root, before.path)')).toBe(true)
    expect(app.includes('change.agent, before')).toBe(true)
    expect(commit.includes('noteBeforeMarkdown: noteToMarkdown(before)')).toBe(true)
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
    expect(review).toContain('agent-apply-btn')
    expect(composer).toContain('agent-composer')
    expect(composer).toContain("placeholder={t('agent.placeholder')}")
    expect(composer).toContain('<ArrowUp')
    expect(view).not.toContain('当前笔记暂无 Agent 会话记录。')
  })

  it('does not use timeline as the primary NoteAgent experience', () => {
    const hook = readFileSync(resolve(__dirname, '../features/agent/useNoteAgent.ts'), 'utf8')

    expect(hook).toContain('loadAgentConversation')
    expect(hook).toContain('getRecentMeaningfulMessages')
    expect(hook).toContain("const [command, setCommand] = useState('')")
    expect(hook).not.toContain("useState('更新当前笔记的标签和摘要。')")
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
    const app = readFileSync(resolve(__dirname, '../features/agent/agentNoteCommit.ts'), 'utf8')
    const utils = readFileSync(resolve(__dirname, '../features/agent/agentUtils.ts'), 'utf8')

    expect(app).toContain('makeAgentId')
    expect(app).toContain('nowIso')
    expect(app).toContain("from './agentUtils'")
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

  it('persists discarded reviews with a distinct status', () => {
    const hook = readFileSync(resolve(__dirname, '../features/agent/useNoteAgent.ts'), 'utf8')
    const review = readFileSync(resolve(__dirname, '../features/agent/AgentReviewMessage.tsx'), 'utf8')
    const conversation = readFileSync(resolve(__dirname, '../features/agent/AgentConversationView.tsx'), 'utf8')

    expect(hook).toContain("markReviewMessage(message, 'discarded', '审阅已丢弃。')")
    expect(review).toContain("message.status === 'discarded'")
    expect(conversation).toContain("m.status === 'discarded'")
  })
})
