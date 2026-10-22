use crate::agent_session::{
    AgentConversation, AgentMessage, AgentOperationEvent, AgentPreference, AgentSession,
    AgentSessionStore, AgentTurn, AgentUndoSnapshot,
};
use crate::indexer::{NoteIndex, NoteLink, SearchResult};
use crate::llm::{
    build_chat_request_preview, send_chat_request, LlmChatResponse, LlmProviderSettings,
    LlmRequestPreview, LlmRequestState, LlmStreamSummary,
};
use crate::markdown::NoteMetadata;
use crate::persistence::{mutation_lock, NoteCommitInput};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub struct ExitState(pub AtomicBool);
use crate::settings::{UserSettings, UserSettingsStore};
use crate::vault::{ArchiveNote, Vault};
use crate::watcher::WatcherState;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

#[tauri::command(async)]
pub fn commit_note(input: NoteCommitInput) -> Result<NoteMetadata, String> {
    crate::persistence::commit_note_change(input)
}

#[tauri::command(async)]
pub fn undo_agent_change(
    vault_root: String,
    note_path: String,
) -> Result<crate::persistence::UndoResult, String> {
    crate::persistence::undo_agent_change(vault_root, note_path)
}

#[tauri::command(async)]
pub fn refresh_vault_paths(
    vault_root: String,
    paths: Vec<String>,
) -> Result<crate::indexer::VaultDelta, String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(vault_root)?;
    let index = NoteIndex::open(vault.safe_path(".inote/index.sqlite3")?)?;
    let before = index.affected_paths(vault.root(), &paths)?;
    index.refresh_paths(vault.root(), &paths)?;
    let after = index.affected_paths(vault.root(), &paths)?;
    let present = after.iter().collect::<std::collections::HashSet<_>>();
    let removed_paths = before
        .into_iter()
        .filter(|path| !present.contains(path))
        .collect();
    Ok(crate::indexer::VaultDelta {
        notes: index.get_summaries_for_paths(&after)?,
        removed_paths,
    })
}

#[tauri::command(async)]
pub fn load_note_drafts(vault_root: String) -> Result<Vec<serde_json::Value>, String> {
    let vault = Vault::new(vault_root)?;
    let path = vault.safe_path(".inote/drafts.json")?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let drafts: Vec<serde_json::Value> =
        serde_json::from_str(&std::fs::read_to_string(path).map_err(|error| error.to_string())?)
            .map_err(|error| format!("failed to load recovered drafts: {error}"))?;
    for draft in &drafts {
        vault.note_path(draft["path"].as_str().ok_or("invalid recovered draft")?)?;
    }
    Ok(drafts)
}

#[tauri::command(async)]
pub fn save_note_drafts(vault_root: String, notes: Vec<serde_json::Value>) -> Result<(), String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(vault_root)?;
    let mut drafts = Vec::new();
    for note in notes {
        vault.note_path(note["path"].as_str().ok_or("invalid draft path")?)?;
        if note["isDirty"] == true {
            if !note["body"].is_string() || note["bodyLoaded"] == false {
                return Err("cannot save an unloaded draft".to_string());
            }
            drafts.push(note);
        }
    }
    let source = serde_json::to_string(&drafts).map_err(|error| error.to_string())?;
    vault.persist_content(&vault.safe_path(".inote/drafts.json")?, &source, false)
}

#[tauri::command]
pub fn allow_vault_assets(app: AppHandle, vault_root: String) -> Result<(), String> {
    let vault = Vault::new(vault_root)?;
    let scope = app.asset_protocol_scope();
    scope
        .allow_directory(vault.root(), true)
        .map_err(|error| error.to_string())?;
    for directory in [".inote", ".git"] {
        scope
            .forbid_directory(vault.root().join(directory), true)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteNoteInput {
    pub vault_root: String,
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub expected_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteImageInput {
    pub vault_root: String,
    pub note_path: String,
    pub data_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateNoteImagesInput {
    pub vault_root: String,
    pub note_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveNoteInput {
    pub vault_root: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveNoteInput {
    pub vault_root: String,
    pub from: String,
    pub title: String,
    pub category: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexInput {
    pub vault_root: String,
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinksInput {
    pub vault_root: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinks {
    pub outgoing: Vec<NoteLink>,
    pub backlinks: Vec<NoteLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteInput {
    pub vault_root: String,
    pub title: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderInput {
    pub vault_root: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReviewInput {
    pub vault_root: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmPreviewInput {
    pub settings: LlmProviderSettings,
    pub prompt: String,
    pub context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatInput {
    pub settings: LlmProviderSettings,
    pub prompt: String,
    pub context: String,
    pub request_id: Option<String>,
    pub structured_output: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowStateInput {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAgentSessionInput {
    pub vault_root: String,
    pub note_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAgentConversationInput {
    pub vault_root: String,
    pub note_path: String,
    pub message_limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordAgentTurnInput {
    pub vault_root: String,
    pub note_title: String,
    pub turn: AgentTurn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordAgentMessageInput {
    pub vault_root: String,
    pub message: AgentMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordAgentMessagesInput {
    pub vault_root: String,
    pub messages: Vec<AgentMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentMessageInput {
    pub vault_root: String,
    pub message: AgentMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordAgentOperationEventInput {
    pub vault_root: String,
    pub note_title: Option<String>,
    pub event: AgentOperationEvent,
    pub undo_snapshot: Option<AgentUndoSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUndoSnapshotInput {
    pub vault_root: String,
    pub note_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPreferenceInput {
    pub vault_root: String,
    pub note_path: String,
    pub content: Option<String>,
    pub updated_at: Option<String>,
}

#[tauri::command(async)]
pub fn scan_vault(vault_root: String) -> Result<Vec<NoteMetadata>, String> {
    Vault::new(vault_root)?.scan()
}

#[tauri::command(async)]
pub fn rebuild_search_index(vault_root: String, is_full: bool) -> Result<(), String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(&vault_root)?;
    let index = NoteIndex::open(vault.safe_path(".inote/index.sqlite3")?)?;
    if is_full {
        let notes = vault.scan()?;
        index.full_rebuild(vault.root(), &notes)?;
    } else {
        index.lightweight_rebuild_summaries(vault.root())?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn scan_vault_and_rebuild_index(vault_root: String) -> Result<Vec<NoteMetadata>, String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(&vault_root)?;
    let index_path = vault.safe_path(".inote/index.sqlite3")?;
    let exists = index_path.exists();
    let index = NoteIndex::open(&index_path)?;
    if exists {
        index.lightweight_rebuild_summaries(vault.root())?;
    } else {
        let notes = vault.scan()?;
        index.full_rebuild(vault.root(), &notes)?;
    }
    index.get_note_summaries()
}

#[tauri::command(async)]
pub fn load_indexed_vault(vault_root: String) -> Result<Option<Vec<NoteMetadata>>, String> {
    let vault = Vault::new(&vault_root)?;
    let index_path = vault.safe_path(".inote/index.sqlite3")?;
    if !index_path.exists() {
        return Ok(None);
    }

    let index = NoteIndex::open(index_path)?;
    Ok(Some(index.get_note_summaries()?))
}

#[tauri::command(async)]
pub fn search_index(input: SearchIndexInput) -> Result<Vec<SearchResult>, String> {
    let vault = Vault::new(&input.vault_root)?;
    let index = NoteIndex::open(vault.safe_path(".inote/index.sqlite3")?)?;
    index.search(&input.query)
}

#[tauri::command(async)]
pub fn get_note_links(input: NoteLinksInput) -> Result<NoteLinks, String> {
    let vault = Vault::new(&input.vault_root)?;
    let index = NoteIndex::open(vault.safe_path(".inote/index.sqlite3")?)?;
    Ok(NoteLinks {
        outgoing: index.outgoing_links(&input.path)?,
        backlinks: index.backlinks(&input.path)?,
    })
}

#[tauri::command]
pub fn start_vault_watcher(
    vault_root: String,
    app: AppHandle,
    state: State<'_, WatcherState>,
) -> Result<(), String> {
    state.start(app, PathBuf::from(vault_root))
}

#[tauri::command]
pub fn stop_vault_watcher(state: State<'_, WatcherState>) -> Result<(), String> {
    state.stop()
}

#[tauri::command]
pub fn initialize_vault(vault_root: String) -> Result<Vec<NoteMetadata>, String> {
    let vault = Vault::new(vault_root)?;
    vault.create_starter_structure()?;
    vault.scan()
}

#[tauri::command(async)]
pub fn read_note(vault_root: String, path: String) -> Result<NoteMetadata, String> {
    Vault::new(vault_root)?.read_note(&path)
}

#[tauri::command]
pub fn check_file_exists(vault_root: String, relative_path: String) -> bool {
    Vault::new(vault_root)
        .and_then(|vault| vault.safe_path(&relative_path))
        .is_ok_and(|path| path.is_file())
}

#[tauri::command(async)]
pub fn write_note(input: WriteNoteInput) -> Result<NoteMetadata, String> {
    let vault = Vault::new(&input.vault_root)?;
    let create = !vault.note_path(&input.path)?.exists();
    crate::persistence::commit_note_change(NoteCommitInput {
        vault_root: input.vault_root,
        path: input.path,
        content: input.content,
        expected_revision: input.expected_revision,
        create,
        target_path: None,
        agent: None,
        source_check: None,
        content_path: None,
        undo_snapshot_id: None,
    })
}

#[tauri::command(async)]
pub fn save_note_image(input: SaveNoteImageInput) -> Result<String, String> {
    let _lock = mutation_lock()?;
    let (metadata, encoded) = input
        .data_url
        .split_once(',')
        .ok_or_else(|| "invalid image data URL".to_string())?;
    if !metadata.starts_with("data:image/") || !metadata.ends_with(";base64") {
        return Err("unsupported image data URL".to_string());
    }

    let mime_type = metadata
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .ok_or_else(|| "invalid image MIME type".to_string())?;
    let extension = image_extension_for_mime_type(mime_type)?;
    let bytes = BASE64
        .decode(encoded)
        .map_err(|error| format!("failed to decode pasted image: {error}"))?;

    Vault::new(&input.vault_root)?.write_note_image(&input.note_path, extension, &bytes)
}

#[tauri::command(async)]
pub fn migrate_note_images(input: MigrateNoteImagesInput) -> Result<Option<NoteMetadata>, String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(&input.vault_root)?;
    let source = vault.read_note_source(&input.note_path)?;
    let mut output = String::with_capacity(source.len());
    let mut cursor = 0;
    let mut migrated_count = 0;

    while let Some(relative_start) = source[cursor..].find("data:image/") {
        let data_start = cursor + relative_start;
        output.push_str(&source[cursor..data_start]);

        let Some((data_end, mime_type, encoded)) = inline_image_data(&source, data_start) else {
            output.push_str("data:image/");
            cursor = data_start + "data:image/".len();
            continue;
        };

        let extension = image_extension_for_mime_type(mime_type)?;
        let bytes = BASE64
            .decode(encoded)
            .map_err(|error| format!("failed to decode embedded image: {error}"))?;
        let relative_path = vault.write_note_image(&input.note_path, extension, &bytes)?;
        output.push_str(&relative_path);
        cursor = data_end;
        migrated_count += 1;
    }

    if migrated_count == 0 {
        return Ok(None);
    }

    output.push_str(&source[cursor..]);
    let note = vault.write_note(&input.note_path, &output)?;
    update_index_for_note(&vault, &note)?;
    Ok(Some(note))
}

fn inline_image_data(source: &str, data_start: usize) -> Option<(usize, &str, &str)> {
    if !source[..data_start].ends_with("](") {
        return None;
    }

    let metadata_end = source[data_start..].find(',')? + data_start;
    let metadata = &source[data_start..metadata_end];
    let mime_type = metadata
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))?;
    let encoded_start = metadata_end + 1;
    let encoded_end = source.as_bytes()[encoded_start..]
        .iter()
        .position(|byte| !byte.is_ascii_alphanumeric() && !matches!(byte, b'+' | b'/' | b'='))
        .map(|offset| encoded_start + offset)
        .unwrap_or(source.len());

    if source.as_bytes().get(encoded_end) != Some(&b')') {
        return None;
    }
    Some((encoded_end, mime_type, &source[encoded_start..encoded_end]))
}

fn image_extension_for_mime_type(mime_type: &str) -> Result<&'static str, String> {
    match mime_type.to_ascii_lowercase().as_str() {
        "image/png" => Ok("png"),
        "image/jpeg" | "image/jpg" => Ok("jpg"),
        "image/gif" => Ok("gif"),
        "image/webp" => Ok("webp"),
        "image/avif" => Ok("avif"),
        "image/bmp" => Ok("bmp"),
        "image/svg+xml" => Ok("svg"),
        other => Err(format!("unsupported pasted image type: {other}")),
    }
}

#[tauri::command(async)]
pub fn create_inbox_note(vault_root: String, title: String) -> Result<NoteMetadata, String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(&vault_root)?;
    let note = vault.create_inbox_note(&title)?;
    update_index_for_note(&vault, &note)?;
    Ok(note)
}

#[tauri::command(async)]
pub fn create_today_note(vault_root: String, category: String) -> Result<NoteMetadata, String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(&vault_root)?;
    let note = vault.create_today_note(&category)?;
    update_index_for_note(&vault, &note)?;
    Ok(note)
}

#[tauri::command(async)]
pub fn create_weekly_review(input: CreateReviewInput) -> Result<NoteMetadata, String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(&input.vault_root)?;
    let note = vault.create_weekly_review(&input.date)?;
    update_index_for_note(&vault, &note)?;
    Ok(note)
}

#[tauri::command(async)]
pub fn create_monthly_review(input: CreateReviewInput) -> Result<NoteMetadata, String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(&input.vault_root)?;
    let note = vault.create_monthly_review(&input.date)?;
    update_index_for_note(&vault, &note)?;
    Ok(note)
}

#[tauri::command(async)]
pub fn create_note(input: CreateNoteInput) -> Result<NoteMetadata, String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(&input.vault_root)?;
    let note = vault.create_note(&input.title, &input.category)?;
    update_index_for_note(&vault, &note)?;
    Ok(note)
}

#[tauri::command]
pub fn create_folder(input: CreateFolderInput) -> Result<(), String> {
    Vault::new(input.vault_root)?.create_folder(&input.path)
}

#[tauri::command(async)]
pub fn move_note(input: MoveNoteInput) -> Result<NoteMetadata, String> {
    let vault = Vault::new(&input.vault_root)?;
    let source = vault.read_note_source(&input.from)?;
    crate::persistence::commit_note_change(NoteCommitInput {
        vault_root: input.vault_root,
        path: input.from,
        target_path: Some(input.to),
        expected_revision: Some(crate::markdown::source_revision(&source)),
        content: source,
        create: false,
        agent: None,
        source_check: None,
        content_path: None,
        undo_snapshot_id: None,
    })
}

#[tauri::command(async)]
pub fn archive_note(input: ArchiveNoteInput) -> Result<NoteMetadata, String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(&input.vault_root)?;
    let old_path = input.from.clone();
    let note = vault.archive_note(ArchiveNote {
        from: input.from,
        title: input.title,
        category: input.category,
        tags: input.tags,
        created_at: input.created_at,
        body: input.body,
    })?;
    update_index_for_move(&vault, &old_path, &note)?;
    Ok(note)
}

#[tauri::command(async)]
pub fn delete_note(vault_root: String, path: String) -> Result<(), String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(&vault_root)?;
    vault.delete_note(&path)?;
    let index = NoteIndex::open(vault.safe_path(".inote/index.sqlite3")?)?;
    index.delete_note(&path)
}

#[tauri::command(async)]
pub fn empty_trash(vault_root: String) -> Result<(), String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(&vault_root)?;
    vault.empty_trash()?;
    let index = NoteIndex::open(vault.safe_path(".inote/index.sqlite3")?)?;
    let notes = vault.scan()?;
    index.full_rebuild(vault.root(), &notes)
}

#[tauri::command]
pub fn build_llm_request_preview(input: LlmPreviewInput) -> Result<LlmRequestPreview, String> {
    build_chat_request_preview(&input.settings, &input.prompt, &input.context)
}

#[tauri::command]
pub async fn execute_llm_chat(input: LlmChatInput) -> Result<LlmChatResponse, String> {
    send_chat_request(&input.settings, &input.prompt, &input.context).await
}

#[tauri::command]
pub async fn execute_llm_chat_stream(
    input: LlmChatInput,
    on_chunk: tauri::ipc::Channel<String>,
    state: State<'_, LlmRequestState>,
) -> Result<LlmStreamSummary, String> {
    let request_id = input
        .request_id
        .clone()
        .unwrap_or_else(|| "anonymous".to_string());
    let cancellation = state.register(&request_id)?;
    let result = crate::llm::send_chat_request_stream(
        &input.settings,
        &input.prompt,
        &input.context,
        move |content| {
            let _ = on_chunk.send(content);
        },
        cancellation,
        input.structured_output.unwrap_or(false),
    )
    .await;
    state.finish(&request_id);
    result
}

#[tauri::command]
pub fn cancel_llm_request(
    request_id: String,
    state: State<'_, LlmRequestState>,
) -> Result<bool, String> {
    state.cancel(&request_id)
}

#[tauri::command]
pub fn load_agent_session(input: LoadAgentSessionInput) -> Result<Option<AgentSession>, String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?
        .load_session(&input.note_path)
}

#[tauri::command]
pub fn load_agent_conversation(
    input: LoadAgentConversationInput,
) -> Result<AgentConversation, String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?
        .load_conversation(&input.note_path, input.message_limit.unwrap_or(60))
}

#[tauri::command]
pub fn record_agent_turn(input: RecordAgentTurnInput) -> Result<(), String> {
    let store = AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?;
    store.upsert_session(
        &input.turn.session_id,
        &input.turn.note_path,
        &input.note_title,
        &input.turn.created_at,
    )?;
    store.record_turn(&input.turn)
}

#[tauri::command]
pub fn record_agent_message(input: RecordAgentMessageInput) -> Result<(), String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?
        .record_message(&input.message)
}

#[tauri::command]
pub fn record_agent_messages(input: RecordAgentMessagesInput) -> Result<(), String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?
        .record_messages(&input.messages)
}

#[tauri::command]
pub fn update_agent_message(input: UpdateAgentMessageInput) -> Result<(), String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?
        .record_message(&input.message)
}

#[tauri::command]
pub fn record_agent_operation_event(input: RecordAgentOperationEventInput) -> Result<(), String> {
    let store = AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?;
    if let Some(note_title) = &input.note_title {
        store.update_session_note_target(
            &input.event.session_id,
            &input.event.note_path,
            note_title,
            &input.event.applied_at,
        )?;
    }
    store.record_operation_event(&input.event)?;
    if let Some(snapshot) = input.undo_snapshot {
        store.store_undo_snapshot(&snapshot)?;
    }
    Ok(())
}

#[tauri::command]
pub fn load_last_agent_undo_snapshot(
    input: AgentUndoSnapshotInput,
) -> Result<Option<AgentUndoSnapshot>, String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?
        .load_last_undo_snapshot(&input.note_path)
}

#[tauri::command]
pub fn clear_last_agent_undo_snapshot(input: AgentUndoSnapshotInput) -> Result<(), String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?
        .clear_last_undo_snapshot(&input.note_path)
}

#[tauri::command]
pub fn load_agent_preference(
    input: AgentPreferenceInput,
) -> Result<Option<AgentPreference>, String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?
        .load_preference(&input.note_path)
}

#[tauri::command]
pub fn save_agent_preference(input: AgentPreferenceInput) -> Result<(), String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?.save_preference(
        &AgentPreference {
            note_path: input.note_path,
            content: input.content.unwrap_or_default(),
            updated_at: input
                .updated_at
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        },
    )
}

#[tauri::command]
pub fn clear_agent_preference(input: AgentPreferenceInput) -> Result<(), String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?
        .clear_preference(&input.note_path)
}

#[tauri::command]
pub fn load_user_settings(app: AppHandle) -> Result<UserSettings, String> {
    UserSettingsStore::open(settings_db_path(&app)?)?.load()
}

#[tauri::command]
pub fn save_user_settings(app: AppHandle, settings: UserSettings) -> Result<(), String> {
    UserSettingsStore::open(settings_db_path(&app)?)?.save(&settings)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.state::<ExitState>().0.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
pub fn get_setting(app: AppHandle, key: String) -> Result<Option<String>, String> {
    UserSettingsStore::open(settings_db_path(&app)?)?.get_value(&key)
}

#[tauri::command]
pub fn get_system_fonts() -> Result<Vec<String>, String> {
    let source = font_kit::source::SystemSource::new();
    match source.all_families() {
        Ok(mut families) => {
            families.sort_by_key(|f| f.to_lowercase());
            Ok(families)
        }
        Err(e) => Err(format!("Failed to load fonts: {}", e)),
    }
}

#[tauri::command]
pub fn set_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    UserSettingsStore::open(settings_db_path(&app)?)?.set_value(&key, &value)
}

#[tauri::command]
pub fn save_window_state(app: AppHandle, input: WindowStateInput) -> Result<(), String> {
    let store = UserSettingsStore::open(settings_db_path(&app)?)?;
    store.set_value("window_width", &input.width.to_string())?;
    store.set_value("window_height", &input.height.to_string())?;
    store.set_value("window_x", &input.x.to_string())?;
    store.set_value("window_y", &input.y.to_string())?;
    store.set_value(
        "window_maximized",
        if input.maximized { "true" } else { "false" },
    )?;
    Ok(())
}

pub(crate) fn settings_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data folder: {error}"))?
        .join("settings.sqlite3"))
}

pub(crate) fn agent_session_db_path(vault_root: &str) -> Result<PathBuf, String> {
    if !Path::new(vault_root).exists() {
        return Err("vault path does not exist".to_string());
    }
    let vault = Vault::new(vault_root)?;
    vault.safe_path(".inote/agent.sqlite3")
}

fn update_index_for_note(vault: &Vault, note: &NoteMetadata) -> Result<(), String> {
    let index = NoteIndex::open(vault.safe_path(".inote/index.sqlite3")?)?;
    let mut notes = index.get_note_summaries()?;
    notes.retain(|existing| existing.path != note.path);
    notes.push(note.clone());
    index.update_note(vault.root(), note, &notes)
}

fn update_index_for_move(
    vault: &Vault,
    old_path: &str,
    new_note: &NoteMetadata,
) -> Result<(), String> {
    let index = NoteIndex::open(vault.safe_path(".inote/index.sqlite3")?)?;
    index.delete_note(old_path)?;
    let mut notes = index.get_note_summaries()?;
    notes.retain(|existing| existing.path != new_note.path && existing.path != old_path);
    notes.push(new_note.clone());
    index.update_note(vault.root(), new_note, &notes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_session::{AgentOperationEvent, AgentTurn, AgentUndoSnapshot};
    use tempfile::tempdir;

    #[test]
    fn watcher_refresh_returns_only_changed_metadata_and_removed_paths() {
        let directory = tempdir().unwrap();
        let vault = Vault::new(directory.path()).unwrap();
        for name in ["a", "b", "unchanged"] {
            write_note(WriteNoteInput {
                vault_root: vault.root().to_string_lossy().to_string(),
                path: format!("{name}.md"),
                content: format!("# {name}"),
                expected_revision: None,
            })
            .unwrap();
        }
        std::fs::remove_file(vault.root().join("a.md")).unwrap();
        vault.write_note("b.md", "# B updated").unwrap();
        let delta = refresh_vault_paths(
            vault.root().to_string_lossy().to_string(),
            vec![
                vault.root().join("a.md").to_string_lossy().to_string(),
                vault.root().join("b.md").to_string_lossy().to_string(),
            ],
        )
        .unwrap();
        assert_eq!(delta.removed_paths, ["a.md"]);
        assert_eq!(delta.notes.len(), 1);
        assert_eq!(delta.notes[0].path, "b.md");
        assert!(!delta.notes[0].body_loaded);
        assert!(delta.notes[0].body.is_empty());
    }

    #[test]
    fn drafts_round_trip_and_invalid_paths_are_rejected() {
        let directory = tempdir().unwrap();
        let vault = Vault::new(directory.path()).unwrap();
        let root = vault.root().to_string_lossy().to_string();
        let note = vault.write_note("a.md", "# Before").unwrap();
        let mut draft = serde_json::to_value(note).unwrap();
        draft["isDirty"] = true.into();
        draft["body"] = "unsaved text".into();
        save_note_drafts(root.clone(), vec![draft.clone()]).unwrap();
        assert_eq!(load_note_drafts(root.clone()).unwrap(), [draft.clone()]);
        draft["path"] = "../outside.md".into();
        assert!(save_note_drafts(root.clone(), vec![draft]).is_err());
        assert_eq!(load_note_drafts(root.clone()).unwrap().len(), 1);
        save_note_drafts(root.clone(), Vec::new()).unwrap();
        assert!(load_note_drafts(root).unwrap().is_empty());
    }

    #[test]
    fn legacy_write_command_requires_a_version_for_existing_files() {
        let directory = tempdir().unwrap();
        let root = directory.path().to_string_lossy().to_string();
        let before = write_note(WriteNoteInput {
            vault_root: root.clone(),
            path: "a.md".into(),
            content: "# Before".into(),
            expected_revision: None,
        })
        .unwrap();
        assert!(write_note(WriteNoteInput {
            vault_root: root.clone(),
            path: "a.md".into(),
            content: "# Unchecked".into(),
            expected_revision: None
        })
        .is_err());
        let saved = write_note(WriteNoteInput {
            vault_root: root,
            path: "a.md".into(),
            content: "# Saved".into(),
            expected_revision: Some(before.source_revision),
        })
        .unwrap();
        assert_eq!(saved.body, "# Saved");
    }

    fn sample_agent_turn(
        id: &str,
        session_id: &str,
        note_path: &str,
        created_at: &str,
    ) -> AgentTurn {
        AgentTurn {
            id: id.to_string(),
            session_id: session_id.to_string(),
            note_path: note_path.to_string(),
            command: "Summarize this note".to_string(),
            action: Some("summarize".to_string()),
            prompt: "Return JSON".to_string(),
            context_summary: "Title: Example".to_string(),
            raw_response: "{\"message\":\"ok\",\"operations\":[]}".to_string(),
            parsed_result_json: Some("{\"message\":\"ok\",\"operations\":[]}".to_string()),
            status: "ready".to_string(),
            error: None,
            created_at: created_at.to_string(),
            completed_at: Some(created_at.to_string()),
        }
    }

    fn sample_agent_event(
        id: &str,
        session_id: &str,
        turn_id: &str,
        note_path: &str,
        applied_at: &str,
    ) -> AgentOperationEvent {
        AgentOperationEvent {
            id: id.to_string(),
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            note_path: note_path.to_string(),
            operation_types: vec!["update_current_note".to_string()],
            changed_fields: vec!["summary".to_string()],
            created_note_path: None,
            applied_at: applied_at.to_string(),
        }
    }

    fn sample_agent_snapshot(
        id: &str,
        session_id: &str,
        event_id: &str,
        note_path: &str,
        created_at: &str,
    ) -> AgentUndoSnapshot {
        AgentUndoSnapshot {
            id: id.to_string(),
            session_id: session_id.to_string(),
            event_id: event_id.to_string(),
            note_path: note_path.to_string(),
            note_before_markdown: "---\ntitle: Example\n---\nBefore".to_string(),
            note_before_path: note_path.to_string(),
            active_path_after_apply: note_path.to_string(),
            created_note_path: None,
            created_at: created_at.to_string(),
            applied_revision: None,
        }
    }

    #[test]
    fn command_scans_reads_and_writes_note() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        write_note(WriteNoteInput {
            expected_revision: None,
            vault_root: root.clone(),
            path: "knowledge/test.md".to_string(),
            content: "# Test Note\n\nBody".to_string(),
        })
        .unwrap();

        let notes = scan_vault(root.clone()).unwrap();
        assert_eq!(notes.len(), 1);

        let note = read_note(root, "knowledge/test.md".to_string()).unwrap();
        assert_eq!(note.title, "Test Note");
    }

    #[test]
    fn command_loads_cached_vault_without_scanning_disk() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        assert!(load_indexed_vault(root.clone()).unwrap().is_none());

        write_note(WriteNoteInput {
            expected_revision: None,
            vault_root: root.clone(),
            path: "knowledge/cached.md".to_string(),
            content: "# Cached Note\n\nBody".to_string(),
        })
        .unwrap();

        let notes = load_indexed_vault(root).unwrap().unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].path, "knowledge/cached.md");
        assert_eq!(notes[0].title, "Cached Note");
    }

    #[test]
    fn command_decodes_and_saves_pasted_image_outside_markdown() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        write_note(WriteNoteInput {
            expected_revision: None,
            vault_root: root.clone(),
            path: "knowledge/test.md".to_string(),
            content: "# Test Note".to_string(),
        })
        .unwrap();

        let relative_path = save_note_image(SaveNoteImageInput {
            vault_root: root.clone(),
            note_path: "knowledge/test.md".to_string(),
            data_url: "data:image/png;base64,cG5nLWJ5dGVz".to_string(),
        })
        .unwrap();

        assert!(relative_path.starts_with("_assets/test/image-"));
        assert_eq!(
            std::fs::read(dir.path().join("knowledge").join(relative_path)).unwrap(),
            b"png-bytes",
        );
    }

    #[test]
    fn command_rejects_non_image_data_urls() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        let error = save_note_image(SaveNoteImageInput {
            vault_root: root,
            note_path: "knowledge/test.md".to_string(),
            data_url: "data:text/plain;base64,dGV4dA==".to_string(),
        })
        .unwrap_err();

        assert_eq!(error, "unsupported image data URL");
    }

    #[test]
    fn command_migrates_legacy_embedded_images_to_assets() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        write_note(WriteNoteInput {
            expected_revision: None,
            vault_root: root.clone(),
            path: "ideas/legacy.md".to_string(),
            content: "# Legacy\n\n![image](data:image/png;base64,cG5nLWJ5dGVz)\n".to_string(),
        })
        .unwrap();

        let migrated = migrate_note_images(MigrateNoteImagesInput {
            vault_root: root.clone(),
            note_path: "ideas/legacy.md".to_string(),
        })
        .unwrap()
        .unwrap();

        assert!(!migrated.body.contains("data:image/"));
        assert!(migrated.body.contains("](_assets/legacy/image-"));
        let relative_path = migrated
            .body
            .split("](")
            .nth(1)
            .unwrap()
            .split(')')
            .next()
            .unwrap();
        assert_eq!(
            std::fs::read(dir.path().join("ideas").join(relative_path)).unwrap(),
            b"png-bytes",
        );
    }

    #[test]
    fn command_moves_and_deletes_note() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        write_note(WriteNoteInput {
            expected_revision: None,
            vault_root: root.clone(),
            path: "00-inbox/a.md".to_string(),
            content: "# A\n\nBody".to_string(),
        })
        .unwrap();

        let moved = move_note(MoveNoteInput {
            vault_root: root.clone(),
            from: "00-inbox/a.md".to_string(),
            to: "knowledge/a.md".to_string(),
        })
        .unwrap();
        assert_eq!(moved.path, "knowledge/a.md");

        delete_note(root.clone(), "knowledge/a.md".to_string()).unwrap();
        let notes = scan_vault(root).unwrap();
        assert_eq!(notes.len(), 1);
        assert!(notes[0].path.starts_with(".trash/"));
    }

    #[test]
    fn command_archives_inbox_note() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        write_note(WriteNoteInput {
            expected_revision: None,
            vault_root: root.clone(),
            path: "00-inbox/raw.md".to_string(),
            content: "---\ntitle: Raw\ncategory: 00-inbox\ntags: [inbox]\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\n# Raw\n\nBody.".to_string(),
        })
        .unwrap();

        let archived = archive_note(ArchiveNoteInput {
            vault_root: root,
            from: "00-inbox/raw.md".to_string(),
            title: "Refined".to_string(),
            category: "knowledge/refined".to_string(),
            tags: vec!["refined".to_string()],
            created_at: "2026-06-10".to_string(),
            body: "# Raw\n\nBody.".to_string(),
        })
        .unwrap();

        assert_eq!(archived.path, "knowledge/refined/refined.md");
        assert_eq!(archived.category, "knowledge/refined");
        assert_eq!(archived.tags, vec!["refined"]);
        assert!(!dir.path().join("00-inbox/raw.md").exists());
    }

    #[test]
    fn command_initializes_vault_and_creates_category_note() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        let notes = initialize_vault(root.clone()).unwrap();
        assert!(notes.is_empty());
        assert!(dir.path().join("00-inbox").exists());
        assert!(dir.path().join("knowledge/rust").exists());

        create_folder(CreateFolderInput {
            vault_root: root.clone(),
            path: "knowledge/cities".to_string(),
        })
        .unwrap();

        let note = create_note(CreateNoteInput {
            vault_root: root,
            title: "城市网络大模型".to_string(),
            category: "knowledge/cities".to_string(),
        })
        .unwrap();

        assert_eq!(note.title, "城市网络大模型");
        assert_eq!(note.category, "knowledge/cities");
        assert!(dir
            .path()
            .join("knowledge/cities/城市网络大模型.md")
            .exists());
    }

    #[test]
    fn command_creates_journal_reviews() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        write_note(WriteNoteInput {
            expected_revision: None,
            vault_root: root.clone(),
            path: "journal/2026/06/2026-06-10.md".to_string(),
            content: "---\ntitle: Journal Day\ncategory: journal\ntags: [journal]\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\n# Journal Day\n\nBody.".to_string(),
        })
        .unwrap();

        let weekly = create_weekly_review(CreateReviewInput {
            vault_root: root.clone(),
            date: "2026-06-10".to_string(),
        })
        .unwrap();
        let monthly = create_monthly_review(CreateReviewInput {
            vault_root: root,
            date: "2026-06-10".to_string(),
        })
        .unwrap();

        assert_eq!(weekly.path, "journal/reviews/2026-W24-review.md");
        assert_eq!(monthly.path, "journal/reviews/2026-06-review.md");
        assert!(weekly.body.contains("Journal Day"));
        assert!(monthly.body.contains("Journal Day"));
    }

    #[test]
    fn command_rebuilds_and_searches_index() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        write_note(WriteNoteInput {
            expected_revision: None,
            vault_root: root.clone(),
            path: "knowledge/search.md".to_string(),
            content: "---\ntitle: Searchable\ntags: [phase2]\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nIndexed body text".to_string(),
        })
        .unwrap();

        rebuild_search_index(root.clone(), true).unwrap();
        let results = search_index(SearchIndexInput {
            vault_root: root,
            query: "phase2".to_string(),
        })
        .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Searchable");
    }

    #[test]
    fn command_returns_note_links() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        write_note(WriteNoteInput {
            expected_revision: None,
            vault_root: root.clone(),
            path: "knowledge/source.md".to_string(),
            content: "---\ntitle: Source\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nSee [[Target]].".to_string(),
        })
        .unwrap();
        write_note(WriteNoteInput {
            expected_revision: None,
            vault_root: root.clone(),
            path: "knowledge/target.md".to_string(),
            content:
                "---\ntitle: Target\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nTarget."
                    .to_string(),
        })
        .unwrap();

        rebuild_search_index(root.clone(), true).unwrap();
        let links = get_note_links(NoteLinksInput {
            vault_root: root,
            path: "knowledge/target.md".to_string(),
        })
        .unwrap();

        assert_eq!(links.outgoing.len(), 0);
        assert_eq!(links.backlinks.len(), 1);
        assert_eq!(links.backlinks[0].source_path, "knowledge/source.md");
    }

    #[test]
    fn agent_session_db_path_points_inside_vault_inote_folder() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        let path = agent_session_db_path(&root).unwrap();

        assert_eq!(
            path,
            std::fs::canonicalize(dir.path())
                .unwrap()
                .join(".inote")
                .join("agent.sqlite3")
        );
    }

    #[test]
    fn agent_session_db_path_rejects_missing_vault() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("missing-vault");
        let root = missing.to_string_lossy().to_string();

        let error = agent_session_db_path(&root).unwrap_err();

        assert!(error.contains("vault path does not exist"));
        assert!(!missing.exists());
    }

    #[test]
    fn command_records_and_loads_agent_turn() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let turn = sample_agent_turn(
            "turn-1",
            "session-1",
            "knowledge/example.md",
            "2026-06-20T09:05:00Z",
        );

        record_agent_turn(RecordAgentTurnInput {
            vault_root: root.clone(),
            note_title: "Example".to_string(),
            turn: turn.clone(),
        })
        .unwrap();

        let session = load_agent_session(LoadAgentSessionInput {
            vault_root: root,
            note_path: "knowledge/example.md".to_string(),
        })
        .unwrap()
        .unwrap();

        assert_eq!(session.id, "session-1");
        assert_eq!(session.note_path, "knowledge/example.md");
        assert_eq!(session.note_title, "Example");
        assert_eq!(session.created_at, turn.created_at);
        assert_eq!(session.updated_at, turn.created_at);
        assert_eq!(session.turns, vec![turn]);
    }

    #[test]
    fn command_records_and_loads_agent_conversation_messages() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let note_path = "journal/conversation.md";
        let session_id = "session-command-message";
        let turn = sample_agent_turn(
            "turn-command-message",
            session_id,
            note_path,
            "2026-06-26T12:00:00Z",
        );
        record_agent_turn(RecordAgentTurnInput {
            vault_root: root.clone(),
            note_title: "Conversation".to_string(),
            turn,
        })
        .unwrap();

        record_agent_message(RecordAgentMessageInput {
            vault_root: root.clone(),
            message: AgentMessage {
                id: "message-command-1".to_string(),
                session_id: session_id.to_string(),
                note_path: note_path.to_string(),
                turn_id: Some("turn-command-message".to_string()),
                role: "user".to_string(),
                kind: "user_command".to_string(),
                text: "Summarize".to_string(),
                payload_json: None,
                status: "ready".to_string(),
                created_at: "2026-06-26T12:00:00Z".to_string(),
                updated_at: "2026-06-26T12:00:00Z".to_string(),
            },
        })
        .unwrap();

        let conversation = load_agent_conversation(LoadAgentConversationInput {
            vault_root: root,
            note_path: note_path.to_string(),
            message_limit: Some(10),
        })
        .unwrap();

        assert_eq!(conversation.session.unwrap().id, session_id);
        assert_eq!(conversation.messages.len(), 1);
        assert_eq!(conversation.messages[0].text, "Summarize");
    }

    #[test]
    fn command_records_agent_message_batch() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let note_path = "journal/batch.md";
        let session_id = "session-command-batch";
        record_agent_turn(RecordAgentTurnInput {
            vault_root: root.clone(),
            note_title: "Batch".to_string(),
            turn: sample_agent_turn(
                "turn-command-batch",
                session_id,
                note_path,
                "2026-06-26T13:00:00Z",
            ),
        })
        .unwrap();

        record_agent_messages(RecordAgentMessagesInput {
            vault_root: root.clone(),
            messages: vec![
                AgentMessage {
                    id: "message-batch-1".to_string(),
                    session_id: session_id.to_string(),
                    note_path: note_path.to_string(),
                    turn_id: Some("turn-command-batch".to_string()),
                    role: "assistant".to_string(),
                    kind: "assistant_status".to_string(),
                    text: "Reading current note context...".to_string(),
                    payload_json: None,
                    status: "ready".to_string(),
                    created_at: "2026-06-26T13:00:00Z".to_string(),
                    updated_at: "2026-06-26T13:00:00Z".to_string(),
                },
                AgentMessage {
                    id: "message-batch-2".to_string(),
                    session_id: session_id.to_string(),
                    note_path: note_path.to_string(),
                    turn_id: Some("turn-command-batch".to_string()),
                    role: "assistant".to_string(),
                    kind: "assistant_result".to_string(),
                    text: "Ready to review.".to_string(),
                    payload_json: Some("{\"ok\":true}".to_string()),
                    status: "ready".to_string(),
                    created_at: "2026-06-26T13:00:01Z".to_string(),
                    updated_at: "2026-06-26T13:00:01Z".to_string(),
                },
            ],
        })
        .unwrap();

        let conversation = load_agent_conversation(LoadAgentConversationInput {
            vault_root: root,
            note_path: note_path.to_string(),
            message_limit: Some(10),
        })
        .unwrap();
        assert_eq!(conversation.messages.len(), 2);
        assert_eq!(conversation.messages[1].kind, "assistant_result");
    }

    #[test]
    fn command_updates_agent_message() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let note_path = "journal/update.md";
        let session_id = "session-command-update";
        record_agent_turn(RecordAgentTurnInput {
            vault_root: root.clone(),
            note_title: "Update".to_string(),
            turn: sample_agent_turn(
                "turn-command-update",
                session_id,
                note_path,
                "2026-06-26T14:00:00Z",
            ),
        })
        .unwrap();

        let mut message = AgentMessage {
            id: "message-update-1".to_string(),
            session_id: session_id.to_string(),
            note_path: note_path.to_string(),
            turn_id: Some("turn-command-update".to_string()),
            role: "assistant".to_string(),
            kind: "assistant_status".to_string(),
            text: "Reading current note context...".to_string(),
            payload_json: None,
            status: "streaming".to_string(),
            created_at: "2026-06-26T14:00:00Z".to_string(),
            updated_at: "2026-06-26T14:00:00Z".to_string(),
        };
        record_agent_message(RecordAgentMessageInput {
            vault_root: root.clone(),
            message: message.clone(),
        })
        .unwrap();

        message.text = "Ready to review.".to_string();
        message.status = "ready".to_string();
        message.updated_at = "2026-06-26T14:00:01Z".to_string();
        update_agent_message(UpdateAgentMessageInput {
            vault_root: root.clone(),
            message,
        })
        .unwrap();

        let conversation = load_agent_conversation(LoadAgentConversationInput {
            vault_root: root,
            note_path: note_path.to_string(),
            message_limit: Some(10),
        })
        .unwrap();
        assert_eq!(conversation.messages.len(), 1);
        assert_eq!(conversation.messages[0].text, "Ready to review.");
        assert_eq!(conversation.messages[0].status, "ready");
    }

    #[test]
    fn command_records_operation_event_and_undo_snapshot() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let turn = sample_agent_turn(
            "turn-1",
            "session-1",
            "knowledge/example.md",
            "2026-06-20T09:05:00Z",
        );
        record_agent_turn(RecordAgentTurnInput {
            vault_root: root.clone(),
            note_title: "Example".to_string(),
            turn,
        })
        .unwrap();
        let event = sample_agent_event(
            "event-1",
            "session-1",
            "turn-1",
            "knowledge/renamed.md",
            "2026-06-20T10:00:00Z",
        );
        let snapshot = sample_agent_snapshot(
            "snapshot-1",
            "session-1",
            "event-1",
            "knowledge/renamed.md",
            "2026-06-20T10:01:00Z",
        );

        record_agent_operation_event(RecordAgentOperationEventInput {
            vault_root: root.clone(),
            note_title: Some("Renamed".to_string()),
            event: event.clone(),
            undo_snapshot: Some(snapshot.clone()),
        })
        .unwrap();

        let session = load_agent_session(LoadAgentSessionInput {
            vault_root: root.clone(),
            note_path: "knowledge/renamed.md".to_string(),
        })
        .unwrap()
        .unwrap();
        let loaded_snapshot = load_last_agent_undo_snapshot(AgentUndoSnapshotInput {
            vault_root: root.clone(),
            note_path: "knowledge/renamed.md".to_string(),
        })
        .unwrap();

        assert_eq!(session.note_title, "Renamed");
        assert_eq!(session.updated_at, event.applied_at);
        assert_eq!(session.operation_events, vec![event]);
        assert_eq!(loaded_snapshot, Some(snapshot));

        clear_last_agent_undo_snapshot(AgentUndoSnapshotInput {
            vault_root: root,
            note_path: "knowledge/renamed.md".to_string(),
        })
        .unwrap();
        assert_eq!(
            None,
            load_last_agent_undo_snapshot(AgentUndoSnapshotInput {
                vault_root: dir.path().to_string_lossy().to_string(),
                note_path: "knowledge/renamed.md".to_string(),
            })
            .unwrap()
        );
    }

    #[test]
    fn command_builds_llm_preview() {
        let preview = build_llm_request_preview(LlmPreviewInput {
            settings: LlmProviderSettings {
                provider_name: "OpenAI compatible".to_string(),
                api_base_url: "https://api.example.com/v1".to_string(),
                api_key: "secret".to_string(),
                model: "model-a".to_string(),
                max_context_length: Some(10000),
            },
            prompt: "Summarize".to_string(),
            context: "Note".to_string(),
        })
        .unwrap();

        assert_eq!(preview.url, "https://api.example.com/v1/chat/completions");
    }
}
