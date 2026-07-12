export type WorkspaceView = 'today' | 'category' | 'calendar' | 'search' | 'settings' | 'archive' | 'trash' | 'todo'

export type SaveState = 'loading' | 'demo' | 'dirty' | 'saving' | 'saved' | 'error'

export interface Note {
  path: string
  title: string
  category: string
  tags: string[]
  createdAt: string
  updatedAt: string
  due?: string
  status?: string
  priority?: string
  project?: string
  summary?: string
  body: string
  wordCount: number
  isDirty?: boolean
}

export interface CategoryGroup {
  name: string
  count: number
}

export interface TagGroup {
  name: string
  count: number
}

export interface MonthGroup {
  month: string
  notes: Note[]
}

export interface SearchResult {
  path: string
  title: string
  category: string
  tags: string[]
  createdAt: string
  updatedAt: string
  due?: string
  status?: string
  priority?: string
  project?: string
  summary?: string
  excerpt: string
}

export interface NoteLink {
  sourcePath: string
  sourceTitle: string
  targetPath: string
  targetTitle: string
  label: string
  kind: string
}

export interface NoteLinks {
  outgoing: NoteLink[]
  backlinks: NoteLink[]
}

export interface LlmProviderSettings {
  providerName: string
  apiBaseUrl: string
  apiKey: string
  model: string
  maxContextLength?: number
}

export interface UserSettings {
  vaultRoot: string
  activePath: string
  activeView: WorkspaceView
  activeCategory: string
  selectedSearchCategories: string[]
  llmSettings: LlmProviderSettings
  defaultCategory?: string
  leftSidebarVisible?: boolean
  rightSidebarVisible?: boolean
  leftSidebarWidth?: number
  rightSidebarWidth?: number
  windowWidth?: number
  windowHeight?: number
  windowX?: number
  windowY?: number
  windowMaximized?: boolean
  showTodayNoteButton?: boolean
  lockUpdateTime?: boolean
  autoSaveOnExit?: boolean
  fontFamily?: string
}

export interface LlmChatResponse {
  content: string
}

export type AgentTurnStatus = 'running' | 'ready' | 'applied' | 'discarded' | 'failed'

export interface AgentSession {
  id: string
  notePath: string
  noteTitle: string
  createdAt: string
  updatedAt: string
  turns: AgentTurn[]
  operationEvents: AgentOperationEvent[]
  lastUndoSnapshot?: AgentUndoSnapshot | null
}

export interface AgentTurn {
  id: string
  sessionId: string
  notePath: string
  command: string
  action?: string | null
  prompt: string
  contextSummary: string
  rawResponse: string
  parsedResultJson?: string | null
  status: AgentTurnStatus
  error?: string | null
  createdAt: string
  completedAt?: string | null
}

export interface AgentOperationEvent {
  id: string
  sessionId: string
  turnId: string
  notePath: string
  operationTypes: string[]
  changedFields: string[]
  createdNotePath?: string | null
  appliedAt: string
}

export interface AgentUndoSnapshot {
  id: string
  sessionId: string
  eventId: string
  notePath: string
  noteBeforeMarkdown: string
  noteBeforePath: string
  activePathAfterApply: string
  createdNotePath?: string | null
  createdAt: string
}

export type AgentMessageRole = 'user' | 'assistant' | 'system'

export type AgentMessageKind =
  | 'user_command'
  | 'assistant_status'
  | 'assistant_result'
  | 'review_plan'
  | 'operation_event'
  | 'error'

export type AgentMessageStatus = 'pending' | 'streaming' | 'ready' | 'applied' | 'discarded' | 'failed'

export interface AgentMessage {
  id: string
  sessionId: string
  notePath: string
  turnId?: string | null
  role: AgentMessageRole
  kind: AgentMessageKind
  text: string
  payloadJson?: string | null
  status: AgentMessageStatus
  createdAt: string
  updatedAt: string
}

export interface AgentConversation {
  session: AgentSession | null
  messages: AgentMessage[]
  lastUndoSnapshot?: AgentUndoSnapshot | null
}

export type ReviewGroupKind = 'metadata' | 'body_append' | 'body_replace' | 'create_note' | 'suggestion' | 'risk'

export interface ReviewPlan {
  id: string
  turnId: string
  message: string
  groups: ReviewGroup[]
  canApply: boolean
  highRisk: boolean
}

export interface ReviewGroup {
  id: string
  operationIndexes: number[]
  kind: ReviewGroupKind
  title: string
  summary: string
  items: ReviewItem[]
  selected: boolean
  requiresConfirmation?: boolean
}

export interface ReviewItem {
  label: string
  before?: string
  after?: string
  previewMarkdown?: string
}
