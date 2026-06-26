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

  it('wires persisted NoteAgent conversation props', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const agent = readFileSync(resolve(__dirname, '../features/agent/NoteAgent.tsx'), 'utf8')

    expect(app).toContain('vaultRoot={vaultRoot}')
    expect(app).toContain('onUndoLastApply={undoLastAgentApply}')
    expect(agent).toContain('loadAgentConversation')
    expect(agent).toContain('recordAgentMessages')
    expect(agent).toContain('buildReviewPlan')
    expect(agent).toContain('AgentConversationView')
    expect(agent).not.toContain('renderSessionTimeline')
  })

  it('records agent operation events and supports current-note undo wiring', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toContain('recordAgentOperationEvent')
    expect(app).toContain('loadLastAgentUndoSnapshot')
    expect(app).toContain('clearLastAgentUndoSnapshot')
    expect(app).toContain('noteBeforeMarkdown: noteToMarkdown(activeNote)')
    expect(app).toContain('noteTitle: saved.title')
    expect(app).toContain('Undo is not available for created notes yet.')
  })

  it('uses Codex-style conversation components for NoteAgent', () => {
    const view = readFileSync(resolve(__dirname, '../features/agent/AgentConversationView.tsx'), 'utf8')
    const bubble = readFileSync(resolve(__dirname, '../features/agent/AgentMessageBubble.tsx'), 'utf8')
    const review = readFileSync(resolve(__dirname, '../features/agent/AgentReviewMessage.tsx'), 'utf8')
    const composer = readFileSync(resolve(__dirname, '../features/agent/AgentComposer.tsx'), 'utf8')

    expect(view).toContain('agent-conversation-stream')
    expect(bubble).toContain('agent-message-bubble')
    expect(review).toContain('Review Plan')
    expect(review).toContain('decodeReviewPlanPayload')
    expect(composer).toContain('agent-composer')
  })

  it('does not use timeline as the primary NoteAgent experience', () => {
    const agent = readFileSync(resolve(__dirname, '../features/agent/NoteAgent.tsx'), 'utf8')

    expect(agent).toContain('loadAgentConversation')
    expect(agent).toContain('getRecentMeaningfulMessages')
    expect(agent).not.toContain('agent-stage-list')
    expect(agent).not.toContain('agent-timeline')
  })
})
