import type { Note } from '../../shared/types'

export type QuickAgentAction = 'summarize' | 'suggest_tags' | 'clean_metadata' | 'extract_tasks' | 'continue_writing' | 'create_related'

export interface AgentResult {
  message: string
  operations: AgentOperation[]
}

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
