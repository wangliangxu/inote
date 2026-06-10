export type WorkspaceView = 'today' | 'category' | 'calendar' | 'search' | 'settings'

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

export interface MonthGroup {
  month: string
  notes: Note[]
}
