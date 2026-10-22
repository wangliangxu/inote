import type { Note } from './types'

export function getFilenameForTitle(title: string): string {
  const trimmed = title.trim()
  if (/[^\x00-\x7F]/.test(trimmed)) return trimmed.replace(/[\\/:*?"<>|]/g, '-').replace(/^[ -]+|[ -]+$/g, '') || 'note'
  return trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note'
}

export function noteSavePath(note: Note): string {
  const filename = note.path.split('/').pop() || ''
  const name = filename.replace(/\.md$/, '')
  const untitled = /^(?:untitled|无标题|note)(?:-\d+)?$/i.test(name) || /^\d{14}-\d{4}$/.test(name)
  const nextFilename = untitled ? `${getFilenameForTitle(note.title)}.md` : filename
  return [note.category, nextFilename].filter(Boolean).join('/').replace(/\/+/g, '/')
}

export function newNotePath(title: string, category: string, existingPaths: string[]): string {
  const base = [category, getFilenameForTitle(title)].filter(Boolean).join('/')
  const existing = new Set(existingPaths)
  let path = `${base}.md`
  let suffix = 2
  while (existing.has(path)) path = `${base}-${suffix++}.md`
  return path
}
