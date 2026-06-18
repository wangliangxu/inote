use crate::indexer::{NoteIndex, NoteLink, SearchResult};
use crate::llm::{
    build_chat_request_preview, send_chat_request, LlmChatResponse, LlmProviderSettings,
    LlmRequestPreview,
};
use crate::markdown::NoteMetadata;
use crate::settings::{UserSettings, UserSettingsStore};
use crate::vault::{ArchiveNote, Vault};
use crate::watcher::WatcherState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteNoteInput {
    pub vault_root: String,
    pub path: String,
    pub content: String,
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

#[tauri::command]
pub fn scan_vault(vault_root: String) -> Result<Vec<NoteMetadata>, String> {
    Vault::new(vault_root)?.scan()
}

#[tauri::command]
pub fn rebuild_search_index(vault_root: String, is_full: bool) -> Result<(), String> {
    let vault = Vault::new(&vault_root)?;
    let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3"))?;
    if is_full {
        let notes = vault.scan()?;
        index.full_rebuild(vault.root(), &notes)?;
    } else {
        index.lightweight_rebuild(vault.root())?;
    }
    Ok(())
}

#[tauri::command]
pub fn scan_vault_and_rebuild_index(vault_root: String) -> Result<Vec<NoteMetadata>, String> {
    let vault = Vault::new(&vault_root)?;
    let index_path = vault.root().join(".inote/index.sqlite3");
    let exists = index_path.exists();
    let index = NoteIndex::open(&index_path)?;
    if exists {
        index.lightweight_rebuild(vault.root())
    } else {
        let notes = vault.scan()?;
        index.full_rebuild(vault.root(), &notes)?;
        index.get_all_notes()
    }
}

#[tauri::command]
pub fn search_index(input: SearchIndexInput) -> Result<Vec<SearchResult>, String> {
    let vault = Vault::new(&input.vault_root)?;
    let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3"))?;
    index.search(&input.query)
}

#[tauri::command]
pub fn get_note_links(input: NoteLinksInput) -> Result<NoteLinks, String> {
    let vault = Vault::new(&input.vault_root)?;
    let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3"))?;
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

#[tauri::command]
pub fn read_note(vault_root: String, path: String) -> Result<NoteMetadata, String> {
    Vault::new(vault_root)?.read_note(&path)
}

#[tauri::command]
pub fn write_note(input: WriteNoteInput) -> Result<NoteMetadata, String> {
    let vault = Vault::new(&input.vault_root)?;
    let note = vault.write_note(&input.path, &input.content)?;
    update_index_for_note(&vault, &note)?;
    Ok(note)
}

#[tauri::command]
pub fn create_inbox_note(vault_root: String, title: String) -> Result<NoteMetadata, String> {
    let vault = Vault::new(&vault_root)?;
    let note = vault.create_inbox_note(&title)?;
    update_index_for_note(&vault, &note)?;
    Ok(note)
}

#[tauri::command]
pub fn create_today_note(vault_root: String) -> Result<NoteMetadata, String> {
    let vault = Vault::new(&vault_root)?;
    let note = vault.create_today_note()?;
    update_index_for_note(&vault, &note)?;
    Ok(note)
}

#[tauri::command]
pub fn create_weekly_review(input: CreateReviewInput) -> Result<NoteMetadata, String> {
    let vault = Vault::new(&input.vault_root)?;
    let note = vault.create_weekly_review(&input.date)?;
    update_index_for_note(&vault, &note)?;
    Ok(note)
}

#[tauri::command]
pub fn create_monthly_review(input: CreateReviewInput) -> Result<NoteMetadata, String> {
    let vault = Vault::new(&input.vault_root)?;
    let note = vault.create_monthly_review(&input.date)?;
    update_index_for_note(&vault, &note)?;
    Ok(note)
}

#[tauri::command]
pub fn create_note(input: CreateNoteInput) -> Result<NoteMetadata, String> {
    let vault = Vault::new(&input.vault_root)?;
    let note = vault.create_note(&input.title, &input.category)?;
    update_index_for_note(&vault, &note)?;
    Ok(note)
}

#[tauri::command]
pub fn create_folder(input: CreateFolderInput) -> Result<(), String> {
    Vault::new(input.vault_root)?.create_folder(&input.path)
}

#[tauri::command]
pub fn move_note(input: MoveNoteInput) -> Result<NoteMetadata, String> {
    let vault = Vault::new(&input.vault_root)?;
    let note = vault.move_note(&input.from, &input.to)?;
    update_index_for_move(&vault, &input.from, &note)?;
    Ok(note)
}

#[tauri::command]
pub fn archive_note(input: ArchiveNoteInput) -> Result<NoteMetadata, String> {
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

#[tauri::command]
pub fn delete_note(vault_root: String, path: String) -> Result<(), String> {
    let vault = Vault::new(&vault_root)?;
    vault.delete_note(&path)?;
    let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3"))?;
    index.delete_note(&path)
}

#[tauri::command]
pub fn empty_trash(vault_root: String) -> Result<(), String> {
    let vault = Vault::new(&vault_root)?;
    vault.empty_trash()?;
    let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3"))?;
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
) -> Result<(), String> {
    crate::llm::send_chat_request_stream(
        &input.settings,
        &input.prompt,
        &input.context,
        move |content| {
            let _ = on_chunk.send(content);
        },
    )
    .await
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
    store.set_value("window_maximized", if input.maximized { "true" } else { "false" })?;
    Ok(())
}

pub(crate) fn settings_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data folder: {error}"))?
        .join("settings.sqlite3"))
}

fn update_index_for_note(vault: &Vault, note: &NoteMetadata) -> Result<(), String> {
    let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3"))?;
    let notes = vault.scan()?;
    index.update_note(vault.root(), note, &notes)
}

fn update_index_for_move(vault: &Vault, old_path: &str, new_note: &NoteMetadata) -> Result<(), String> {
    let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3"))?;
    index.delete_note(old_path)?;
    let notes = vault.scan()?;
    index.update_note(vault.root(), new_note, &notes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn command_scans_reads_and_writes_note() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        write_note(WriteNoteInput {
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
    fn command_moves_and_deletes_note() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        write_note(WriteNoteInput {
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
            vault_root: root.clone(),
            path: "knowledge/source.md".to_string(),
            content: "---\ntitle: Source\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nSee [[Target]].".to_string(),
        })
        .unwrap();
        write_note(WriteNoteInput {
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
    fn command_builds_llm_preview() {
        let preview = build_llm_request_preview(LlmPreviewInput {
            settings: LlmProviderSettings {
                provider_name: "OpenAI compatible".to_string(),
                api_base_url: "https://api.example.com/v1".to_string(),
                api_key: "secret".to_string(),
                model: "model-a".to_string(),
            },
            prompt: "Summarize".to_string(),
            context: "Note".to_string(),
        })
        .unwrap();

        assert_eq!(preview.url, "https://api.example.com/v1/chat/completions");
    }
}
