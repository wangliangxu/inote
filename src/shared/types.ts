export type WorkspaceView = 'today' | 'category' | 'tags' | 'calendar' | 'search' | 'settings'

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
