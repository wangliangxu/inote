import { isMap, parseDocument } from 'yaml'
import type { Note } from './types'
import { stableJson } from './stableJson'

const optionalFields = ['summary', 'due', 'status', 'priority', 'project'] as const
const knownFields = new Set(['title', 'tags', 'created', 'updated', 'created_at', 'updated_at', ...optionalFields])

function frontmatterDocument(source: string) {
  const document = parseDocument(source, { uniqueKeys: true })
  if (document.errors.length) throw new Error(`Invalid frontmatter: ${document.errors[0].message}`)
  if (document.contents !== null && !isMap(document.contents)) throw new Error('Frontmatter must be a YAML mapping.')
  return document
}

export function noteToMarkdown(note: Note): string {
  if (note.rawMarkdown !== undefined) return note.rawMarkdown
  if (note.bodyLoaded === false) throw new Error('Load the note body before saving.')
  const document = frontmatterDocument(note.frontmatterSource ?? '')
  const original = (document.toJS({ maxAliasCount: 100 }) ?? {}) as Record<string, unknown>
  const set = (key: string, value: unknown) => { if (stableJson(original[key]) !== stableJson(value)) document.set(key, value) }
  for (const [key, value] of Object.entries(note.frontmatter ?? {})) {
    if (!knownFields.has(key)) set(key, value)
  }
  set('title', note.title)
  set('tags', note.tags)
  set('created_at', note.createdAt)
  set('updated_at', note.updatedAt)
  for (const field of optionalFields) {
    if (note[field]) set(field, note[field])
    else document.delete(field)
  }
  return `---\n${document.toString({ lineWidth: 0 })}---\n\n${note.body}`
}

export function hasFrontmatterSourceChanges(note: Note, source: string | undefined): boolean {
  if (source === undefined) return false
  const baseline = parseMarkdownWithFrontmatter(noteToMarkdown(note)).metadata.frontmatterSource ?? ''
  return frontmatterDocument(source).toString() !== frontmatterDocument(baseline).toString()
}

export function parseMarkdownWithFrontmatter(content: string): { body: string; metadata: Partial<Note> } {
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/)
  if (!match) return { body: content, metadata: {} }
  const document = frontmatterDocument(match[1])
  const value = (document.toJS({ maxAliasCount: 100 }) ?? {}) as Record<string, unknown>
  const metadata: Partial<Note> = { frontmatter: {}, frontmatterSource: match[1] }
  for (const [key, item] of Object.entries(value)) {
    if (!knownFields.has(key)) Object.defineProperty(metadata.frontmatter!, key, { value: item, enumerable: true, configurable: true, writable: true })
  }
  if (typeof value.title === 'string') metadata.title = value.title
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string'))) throw new Error('Frontmatter tags must be a list of strings.')
  metadata.tags = (value.tags as string[] | undefined) ?? []
  const created = value.created_at ?? value.created
  const updated = value.updated_at ?? value.updated
  if (typeof created === 'string') metadata.createdAt = created
  if (typeof updated === 'string') metadata.updatedAt = updated
  for (const field of optionalFields) metadata[field] = typeof value[field] === 'string' ? value[field] : ''
  return { body: match[2].replace(/^\r?\n/, ''), metadata }
}
