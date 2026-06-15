import { invoke } from '@tauri-apps/api/core'
import type { LlmChatResponse, LlmProviderSettings, Note, NoteLinks, SearchResult, UserSettings } from './types'

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

interface ArchiveNoteInput {
  vaultRoot: string
  from: string
  title: string
  category: string
  tags: string[]
  createdAt: string
  body: string
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

interface LlmChatInput {
  settings: LlmProviderSettings
  prompt: string
  context: string
}

export async function scanVault(vaultRoot: string): Promise<Note[]> {
  return invoke<Note[]>('scan_vault', { vaultRoot })
}

export async function rebuildSearchIndex(vaultRoot: string): Promise<void> {
  return invoke<void>('rebuild_search_index', { vaultRoot })
}

export async function scanVaultAndRebuildIndex(vaultRoot: string): Promise<Note[]> {
  return invoke<Note[]>('scan_vault_and_rebuild_index', { vaultRoot })
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

export async function archiveNote(input: ArchiveNoteInput): Promise<Note> {
  return invoke<Note>('archive_note', { input })
}

export async function deleteNote(vaultRoot: string, path: string): Promise<void> {
  return invoke<void>('delete_note', { vaultRoot, path })
}

export async function emptyTrash(vaultRoot: string): Promise<void> {
  return invoke<void>('empty_trash', { vaultRoot })
}

export async function executeLlmChat(input: LlmChatInput): Promise<LlmChatResponse> {
  return invoke<LlmChatResponse>('execute_llm_chat', { input })
}

export async function loadUserSettings(): Promise<UserSettings> {
  return invoke<UserSettings>('load_user_settings')
}

export async function saveUserSettings(settings: UserSettings): Promise<void> {
  return invoke<void>('save_user_settings', { settings })
}

export function noteToMarkdown(note: Note): string {
  const tags = note.tags.map((tag) => `"${tag}"`).join(', ')
  const summary = note.summary ? `summary: "${escapeYamlString(note.summary)}"\n` : ''
  const due = note.due ? `due: "${escapeYamlString(note.due)}"\n` : ''
  const status = note.status ? `status: "${escapeYamlString(note.status)}"\n` : ''
  const priority = note.priority ? `priority: "${escapeYamlString(note.priority)}"\n` : ''
  const project = note.project ? `project: "${escapeYamlString(note.project)}"\n` : ''
  return `---\ntitle: "${escapeYamlString(note.title)}"\ncategory: "${note.category}"\ntags: [${tags}]\ncreated_at: ${note.createdAt}\nupdated_at: ${note.updatedAt}\n${due}${status}${priority}${project}${summary}---\n\n${note.body}`
}

function escapeYamlString(value: string): string {
  return value.replace(/"/g, '\\"')
}

export function parseMarkdownWithFrontmatter(content: string): { body: string, metadata: Partial<Note> } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { body: content, metadata: {} }

  const yamlRaw = match[1]
  const body = match[2].replace(/^\n/, '')
  
  const metadata: Partial<Note> = {}
  
  const titleMatch = yamlRaw.match(/^title:\s*"(.*?)"/m) || yamlRaw.match(/^title:\s*(.*?)$/m)
  if (titleMatch) metadata.title = titleMatch[1].replace(/\\"/g, '"').trim()
  
  const categoryMatch = yamlRaw.match(/^category:\s*"(.*?)"/m) || yamlRaw.match(/^category:\s*(.*?)$/m)
  if (categoryMatch) metadata.category = categoryMatch[1].replace(/\\"/g, '"').trim()
  
  const tagsMatch = yamlRaw.match(/^tags:\s*\[(.*?)\]/m)
  if (tagsMatch) {
    const tagsStr = tagsMatch[1]
    metadata.tags = tagsStr.split(',').map(t => t.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"')).filter(Boolean)
  }
  
  const summaryMatch = yamlRaw.match(/^summary:\s*"(.*?)"/m) || yamlRaw.match(/^summary:\s*(.*?)$/m)
  if (summaryMatch) metadata.summary = summaryMatch[1].replace(/\\"/g, '"').trim()

  const dueMatch = yamlRaw.match(/^due:\s*"(.*?)"/m) || yamlRaw.match(/^due:\s*(.*?)$/m)
  if (dueMatch) metadata.due = dueMatch[1].replace(/\\"/g, '"').trim()

  const statusMatch = yamlRaw.match(/^status:\s*"(.*?)"/m) || yamlRaw.match(/^status:\s*(.*?)$/m)
  if (statusMatch) metadata.status = statusMatch[1].replace(/\\"/g, '"').trim()

  const priorityMatch = yamlRaw.match(/^priority:\s*"(.*?)"/m) || yamlRaw.match(/^priority:\s*(.*?)$/m)
  if (priorityMatch) metadata.priority = priorityMatch[1].replace(/\\"/g, '"').trim()

  const projectMatch = yamlRaw.match(/^project:\s*"(.*?)"/m) || yamlRaw.match(/^project:\s*(.*?)$/m)
  if (projectMatch) metadata.project = projectMatch[1].replace(/\\"/g, '"').trim()
  
  return { body, metadata }
}
