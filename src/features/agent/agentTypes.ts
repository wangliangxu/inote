import type { Note } from '../../shared/types'

export type QuickAgentAction = 'summarize' | 'suggest_tags' | 'clean_metadata' | 'extract_tasks' | 'continue_writing' | 'create_related'

export interface AgentResult {
  version?: 1
  message: string
  operations: AgentOperation[]
  references?: AgentReference[]
  metrics?: AgentRunMetrics
  baseNoteRevision?: string
}

export interface AgentReference {
  path: string
  title?: string
  reason: 'search' | 'read' | 'backlink'
}

export interface AgentRunMetrics {
  modelCalls: number
  toolCalls: number
  repairAttempts: number
  durationMs: number
  inputTokens?: number
  outputTokens?: number
  finishReason?: string
  structuredOutputMode?: 'json_schema' | 'json_object' | 'prompt'
}

export type AgentToolName = 'search_notes' | 'read_note' | 'list_backlinks'

export interface AgentToolCall {
  id: string
  name: AgentToolName
  arguments: Record<string, unknown>
}

export type AgentStep =
  | { version: 1, message: string, toolCalls: AgentToolCall[] }
  | AgentResult

export type AgentOperation =
  | { type: 'update_current_note', patch: NotePatch }
  | { type: 'append_to_current_note', markdown: string }
  | { type: 'replace_current_note_body', markdown: string }
  | { type: 'create_note', note: NewNoteDraft }
  | { type: 'suggest_only', markdown: string }

export type NotePatch = Partial<Pick<Note, 'title' | 'category' | 'tags' | 'summary' | 'due' | 'status' | 'priority' | 'project'>>

export interface NewNoteDraft {
  title: string
  category: string
  tags?: string[]
  summary?: string
  body: string
  linkBackToCurrent?: boolean
}

export interface AppliedCurrentNoteChange {
  note: Note
  changedFields: string[]
}
