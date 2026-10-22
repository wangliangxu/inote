import type { Note } from '../../shared/types'
import { stableJson } from '../../shared/stableJson'

export function noteRevision(note: Note): string {
  return fnv1a(stableJson({
    path: note.path,
    title: note.title,
    category: note.category,
    tags: note.tags,
    summary: note.summary ?? '',
    due: note.due ?? '',
    status: note.status ?? '',
    priority: note.priority ?? '',
    project: note.project ?? '',
    body: note.body,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    frontmatter: note.frontmatter ?? {},
    rawMarkdown: note.rawMarkdown,
  }))
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
