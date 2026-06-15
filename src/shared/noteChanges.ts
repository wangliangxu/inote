import type { Note } from './types'
import { normalizeMarkdownBody } from './normalizeMarkdown'

interface ParsedNoteContent {
  body: string
  metadata: Partial<Note>
}

export function hasNoteChanges(note: Note, content: ParsedNoteContent): boolean {
  const { body, metadata } = content

  return (
    normalizeMarkdownBody(body) !== normalizeMarkdownBody(note.body) ||
    (metadata.title !== undefined && metadata.title !== note.title) ||
    (metadata.category !== undefined && metadata.category !== note.category) ||
    (metadata.tags !== undefined && metadata.tags.join(',') !== note.tags.join(',')) ||
    (metadata.summary !== undefined && metadata.summary !== note.summary) ||
    (metadata.due !== undefined && metadata.due !== note.due) ||
    (metadata.status !== undefined && metadata.status !== note.status) ||
    (metadata.priority !== undefined && metadata.priority !== note.priority) ||
    (metadata.project !== undefined && metadata.project !== note.project)
  )
}
