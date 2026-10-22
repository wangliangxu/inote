import { invoke, Channel } from '@tauri-apps/api/core'
import type {
  AgentConversation,
  AgentMessage,
  AgentPreference,
  AgentOperationEvent,
  AgentSession,
  AgentTurn,
  AgentUndoSnapshot,
  LlmChatResponse,
  LlmProviderSettings,
  LlmStreamSummary,
  Note,
  NoteLinks,
  SearchResult,
  UserSettings,
  VaultDelta,
} from './types'

interface WriteNoteInput {
  vaultRoot: string
  path: string
  content: string
  expectedRevision?: string
}

export interface NoteCommitInput extends WriteNoteInput {
  targetPath?: string
  create?: boolean
  sourceCheck?: { path: string; revision: string }
  contentPath?: string
  agent?: {
    event: AgentOperationEvent
    undoSnapshot: AgentUndoSnapshot
    messages: AgentMessage[]
  }
}

export async function commitNote(input: NoteCommitInput): Promise<Note> {
  return invoke<Note>('commit_note', { input })
}

export async function undoAgentChange(vaultRoot: string, notePath: string): Promise<{ restored: Note | null; removedPath: string | null; activePath: string }> {
  return invoke('undo_agent_change', { vaultRoot, notePath })
}

export async function loadNoteDrafts(vaultRoot: string): Promise<Note[]> {
  return invoke<Note[]>('load_note_drafts', { vaultRoot })
}

export async function saveNoteDrafts(vaultRoot: string, notes: Note[]): Promise<void> {
  return invoke<void>('save_note_drafts', { vaultRoot, notes })
}

export async function allowVaultAssets(vaultRoot: string): Promise<void> {
  return invoke<void>('allow_vault_assets', { vaultRoot })
}

interface SaveNoteImageInput {
  vaultRoot: string
  notePath: string
  dataUrl: string
}

interface MigrateNoteImagesInput {
  vaultRoot: string
  notePath: string
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
  requestId?: string
  structuredOutput?: boolean
}

interface LoadAgentSessionInput {
  vaultRoot: string
  notePath: string
}

interface LoadAgentConversationInput {
  vaultRoot: string
  notePath: string
  messageLimit?: number
}

interface RecordAgentTurnInput {
  vaultRoot: string
  noteTitle: string
  turn: AgentTurn
}

interface RecordAgentMessageInput {
  vaultRoot: string
  message: AgentMessage
}

interface RecordAgentMessagesInput {
  vaultRoot: string
  messages: AgentMessage[]
}

interface UpdateAgentMessageInput {
  vaultRoot: string
  message: AgentMessage
}

interface RecordAgentOperationEventInput {
  vaultRoot: string
  noteTitle?: string | null
  event: AgentOperationEvent
  undoSnapshot?: AgentUndoSnapshot | null
}

interface AgentUndoSnapshotInput {
  vaultRoot: string
  notePath: string
}

interface AgentPreferenceInput {
  vaultRoot: string
  notePath: string
  content?: string
  updatedAt?: string
}

export async function quitApp(): Promise<void> {
  return invoke<void>('quit_app')
}

export async function scanVault(vaultRoot: string): Promise<Note[]> {
  return invoke<Note[]>('scan_vault', { vaultRoot })
}

export async function rebuildSearchIndex(vaultRoot: string, isFull: boolean = false): Promise<void> {
  return invoke<void>('rebuild_search_index', { vaultRoot, isFull })
}

export async function scanVaultAndRebuildIndex(vaultRoot: string): Promise<Note[]> {
  return invoke<Note[]>('scan_vault_and_rebuild_index', { vaultRoot })
}

export async function refreshVaultPaths(vaultRoot: string, paths: string[]): Promise<VaultDelta> {
  return invoke<VaultDelta>('refresh_vault_paths', { vaultRoot, paths })
}

export async function loadIndexedVault(vaultRoot: string): Promise<Note[] | null> {
  return invoke<Note[] | null>('load_indexed_vault', { vaultRoot })
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

export async function checkFileExists(vaultRoot: string, relativePath: string): Promise<boolean> {
  return invoke<boolean>('check_file_exists', { vaultRoot, relativePath })
}

export async function initializeVault(vaultRoot: string): Promise<Note[]> {
  return invoke<Note[]>('initialize_vault', { vaultRoot })
}

export async function writeNote(input: WriteNoteInput): Promise<Note> {
  return invoke<Note>('write_note', { input })
}

export async function saveNoteImage(input: SaveNoteImageInput): Promise<string> {
  return invoke<string>('save_note_image', { input })
}

export async function migrateNoteImages(input: MigrateNoteImagesInput): Promise<Note | null> {
  return invoke<Note | null>('migrate_note_images', { input })
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  return invoke<Note>('create_note', { input })
}

export async function createFolder(input: CreateFolderInput): Promise<void> {
  return invoke<void>('create_folder', { input })
}

export async function createTodayNote(vaultRoot: string, category: string): Promise<Note> {
  return invoke<Note>('create_today_note', { vaultRoot, category })
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

export async function executeLlmChatStream(input: LlmChatInput, onChunk: (chunk: string) => void): Promise<LlmStreamSummary> {
  const channel = new Channel<string>()
  channel.onmessage = (message: string) => {
    onChunk(message)
  }
  return invoke<LlmStreamSummary>('execute_llm_chat_stream', { input, onChunk: channel })
}

export async function cancelLlmRequest(requestId: string): Promise<boolean> {
  return invoke<boolean>('cancel_llm_request', { requestId })
}

export async function loadAgentSession(input: LoadAgentSessionInput): Promise<AgentSession | null> {
  return invoke<AgentSession | null>('load_agent_session', { input })
}

export async function loadAgentConversation(input: LoadAgentConversationInput): Promise<AgentConversation> {
  return invoke<AgentConversation>('load_agent_conversation', { input })
}

export async function recordAgentTurn(input: RecordAgentTurnInput): Promise<void> {
  return invoke<void>('record_agent_turn', { input })
}

export async function recordAgentMessage(input: RecordAgentMessageInput): Promise<void> {
  return invoke<void>('record_agent_message', { input })
}

export async function recordAgentMessages(input: RecordAgentMessagesInput): Promise<void> {
  return invoke<void>('record_agent_messages', { input })
}

export async function updateAgentMessage(input: UpdateAgentMessageInput): Promise<void> {
  return invoke<void>('update_agent_message', { input })
}

export async function recordAgentOperationEvent(input: RecordAgentOperationEventInput): Promise<void> {
  return invoke<void>('record_agent_operation_event', { input })
}

export async function loadLastAgentUndoSnapshot(input: AgentUndoSnapshotInput): Promise<AgentUndoSnapshot | null> {
  return invoke<AgentUndoSnapshot | null>('load_last_agent_undo_snapshot', { input })
}

export async function clearLastAgentUndoSnapshot(input: AgentUndoSnapshotInput): Promise<void> {
  return invoke<void>('clear_last_agent_undo_snapshot', { input })
}

export async function loadAgentPreference(input: AgentPreferenceInput): Promise<AgentPreference | null> {
  return invoke<AgentPreference | null>('load_agent_preference', { input })
}

export async function saveAgentPreference(input: AgentPreferenceInput): Promise<void> {
  return invoke<void>('save_agent_preference', { input })
}

export async function clearAgentPreference(input: AgentPreferenceInput): Promise<void> {
  return invoke<void>('clear_agent_preference', { input })
}

export async function loadUserSettings(): Promise<UserSettings> {
  return invoke<UserSettings>('load_user_settings')
}

export async function saveUserSettings(settings: UserSettings): Promise<void> {
  return invoke<void>('save_user_settings', { settings })
}

export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>('get_setting', { key })
}

export async function setSetting(key: string, value: string): Promise<void> {
  return invoke<void>('set_setting', { key, value })
}

export async function saveWindowState(input: { width: number, height: number, x: number, y: number, maximized: boolean }): Promise<void> {
  return invoke<void>('save_window_state', { input })
}

export async function getSystemFonts(): Promise<string[]> {
  return invoke<string[]>('get_system_fonts')
}

export { noteToMarkdown, parseMarkdownWithFrontmatter } from './noteMarkdown'
