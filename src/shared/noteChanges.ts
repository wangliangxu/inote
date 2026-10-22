import type { Note } from './types'
import { normalizeMarkdownBody } from './normalizeMarkdown'
import { stableJson } from './stableJson'
import { hasFrontmatterSourceChanges } from './noteMarkdown'

interface ParsedNoteContent {
  body: string
  metadata: Partial<Note>
}

export function hasNoteChanges(note: Note, content: ParsedNoteContent): boolean {
  if (note.rawMarkdown !== undefined) return true
  const { body, metadata } = content

  return (
    normalizeMarkdownBody(body) !== normalizeMarkdownBody(note.body) ||
    (metadata.title !== undefined && metadata.title !== note.title) ||
    (metadata.category !== undefined && metadata.category !== note.category) ||
    (metadata.tags !== undefined && metadata.tags.join(',') !== note.tags.join(',')) ||
    (metadata.summary !== undefined && metadata.summary !== (note.summary ?? '')) ||
    (metadata.due !== undefined && metadata.due !== (note.due ?? '')) ||
    (metadata.status !== undefined && metadata.status !== (note.status ?? '')) ||
    (metadata.priority !== undefined && metadata.priority !== (note.priority ?? '')) ||
    (metadata.project !== undefined && metadata.project !== (note.project ?? '')) ||
    (metadata.createdAt !== undefined && metadata.createdAt !== note.createdAt) ||
    (metadata.updatedAt !== undefined && metadata.updatedAt !== note.updatedAt)
    || (metadata.frontmatter !== undefined && stableJson(metadata.frontmatter) !== stableJson(note.frontmatter ?? {}))
    || hasFrontmatterSourceChanges(note, metadata.frontmatterSource)
  )
}
