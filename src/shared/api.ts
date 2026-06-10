import { invoke } from '@tauri-apps/api/core'
import type { Note } from './types'

interface WriteNoteInput {
  vaultRoot: string
  path: string
  content: string
}

export async function scanVault(vaultRoot: string): Promise<Note[]> {
  return invoke<Note[]>('scan_vault', { vaultRoot })
}

export async function writeNote(input: WriteNoteInput): Promise<Note> {
  return invoke<Note>('write_note', { input })
}

export async function createTodayNote(vaultRoot: string): Promise<Note> {
  return invoke<Note>('create_today_note', { vaultRoot })
}

export async function createInboxNote(vaultRoot: string, title: string): Promise<Note> {
  return invoke<Note>('create_inbox_note', { vaultRoot, title })
}

export function noteToMarkdown(note: Note): string {
  const tags = note.tags.map((tag) => `"${tag}"`).join(', ')
  const summary = note.summary ? `summary: "${escapeYamlString(note.summary)}"\n` : ''
  return `---\ntitle: "${escapeYamlString(note.title)}"\ncategory: "${note.category}"\ntags: [${tags}]\ncreated_at: ${note.createdAt}\nupdated_at: ${note.updatedAt}\n${summary}---\n\n${note.body}`
}

function escapeYamlString(value: string): string {
  return value.replace(/"/g, '\\"')
}
