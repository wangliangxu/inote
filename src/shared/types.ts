export type WorkspaceView = 'today' | 'category' | 'tags' | 'calendar' | 'search' | 'settings'

export type SaveState = 'loading' | 'demo' | 'dirty' | 'saving' | 'saved' | 'error'

export interface Note {
  path: string
  title: string
  category: string
  tags: string[]
  createdAt: string
  updatedAt: string
  summary?: string
  body: string
  wordCount: number
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
}

export interface UserSettings {
  vaultRoot: string
  activePath: string
  llmSettings: LlmProviderSettings
  defaultCategory?: string
}

export interface LlmChatResponse {
  content: string
}
