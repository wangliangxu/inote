import { invoke } from '@tauri-apps/api/core'
import type { Note, NoteLinks, SearchResult } from './types'

interface WriteNoteInput {
  vaultRoot: string
  path: string
  content: string
}

interface CreateNoteInput {
  vaultRoot: string
  title: string
  category: string
}

interface CreateFolderInput {
  vaultRoot: string
  path: string
}

interface MoveNoteInput {
  vaultRoot: string
  from: string
  to: string
}

interface SearchIndexInput {
  vaultRoot: string
  query: string
}

interface NoteLinksInput {
  vaultRoot: string
  path: string
}

interface CreateReviewInput {
  vaultRoot: string
  date: string
}

export async function scanVault(vaultRoot: string): Promise<Note[]> {
  return invoke<Note[]>('scan_vault', { vaultRoot })
}

export async function rebuildSearchIndex(vaultRoot: string): Promise<void> {
  return invoke<void>('rebuild_search_index', { vaultRoot })
}

export async function searchIndex(input: SearchIndexInput): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('search_index', { input })
}

export async function getNoteLinks(input: NoteLinksInput): Promise<NoteLinks> {
  return invoke<NoteLinks>('get_note_links', { input })
}

export async function startVaultWatcher(vaultRoot: string): Promise<void> {
  return invoke<void>('start_vault_watcher', { vaultRoot })
}

export async function stopVaultWatcher(): Promise<void> {
  return invoke<void>('stop_vault_watcher')
}

export async function readNote(vaultRoot: string, path: string): Promise<Note> {
  return invoke<Note>('read_note', { vaultRoot, path })
}

export async function initializeVault(vaultRoot: string): Promise<Note[]> {
  return invoke<Note[]>('initialize_vault', { vaultRoot })
}

export async function writeNote(input: WriteNoteInput): Promise<Note> {
  return invoke<Note>('write_note', { input })
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  return invoke<Note>('create_note', { input })
}

export async function createFolder(input: CreateFolderInput): Promise<void> {
  return invoke<void>('create_folder', { input })
}

export async function createTodayNote(vaultRoot: string): Promise<Note> {
  return invoke<Note>('create_today_note', { vaultRoot })
}

export async function createWeeklyReview(input: CreateReviewInput): Promise<Note> {
  return invoke<Note>('create_weekly_review', { input })
}

export async function createMonthlyReview(input: CreateReviewInput): Promise<Note> {
  return invoke<Note>('create_monthly_review', { input })
}

export async function createInboxNote(vaultRoot: string, title: string): Promise<Note> {
  return invoke<Note>('create_inbox_note', { vaultRoot, title })
}

export async function moveNote(input: MoveNoteInput): Promise<Note> {
  return invoke<Note>('move_note', { input })
}

export async function deleteNote(vaultRoot: string, path: string): Promise<void> {
  return invoke<void>('delete_note', { vaultRoot, path })
}

export function noteToMarkdown(note: Note): string {
  const tags = note.tags.map((tag) => `"${tag}"`).join(', ')
  const summary = note.summary ? `summary: "${escapeYamlString(note.summary)}"\n` : ''
  return `---\ntitle: "${escapeYamlString(note.title)}"\ncategory: "${note.category}"\ntags: [${tags}]\ncreated_at: ${note.createdAt}\nupdated_at: ${note.updatedAt}\n${summary}---\n\n${note.body}`
}

function escapeYamlString(value: string): string {
  return value.replace(/"/g, '\\"')
}
