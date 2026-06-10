use crate::indexer::{NoteIndex, SearchResult};
use crate::llm::{build_chat_request_preview, LlmProviderSettings, LlmRequestPreview};
use crate::markdown::NoteMetadata;
use crate::vault::Vault;
use crate::watcher::WatcherState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, State};

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
pub struct SearchIndexInput {
    pub vault_root: String,
    pub query: String,
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

#[tauri::command]
pub fn scan_vault(vault_root: String) -> Result<Vec<NoteMetadata>, String> {
    Vault::new(vault_root)?.scan()
}

#[tauri::command]
pub fn rebuild_search_index(vault_root: String) -> Result<(), String> {
    let vault = Vault::new(&vault_root)?;
    let notes = vault.scan()?;
    let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3"))?;
    index.rebuild(&notes)
}

#[tauri::command]
pub fn search_index(input: SearchIndexInput) -> Result<Vec<SearchResult>, String> {
    let vault = Vault::new(&input.vault_root)?;
    let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3"))?;
    index.search(&input.query)
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
    Vault::new(input.vault_root)?.write_note(&input.path, &input.content)
}

#[tauri::command]
pub fn create_inbox_note(vault_root: String, title: String) -> Result<NoteMetadata, String> {
    Vault::new(vault_root)?.create_inbox_note(&title)
}

#[tauri::command]
pub fn create_today_note(vault_root: String) -> Result<NoteMetadata, String> {
    Vault::new(vault_root)?.create_today_note()
}

#[tauri::command]
pub fn create_weekly_review(input: CreateReviewInput) -> Result<NoteMetadata, String> {
    Vault::new(input.vault_root)?.create_weekly_review(&input.date)
}

#[tauri::command]
pub fn create_monthly_review(input: CreateReviewInput) -> Result<NoteMetadata, String> {
    Vault::new(input.vault_root)?.create_monthly_review(&input.date)
}

#[tauri::command]
pub fn create_note(input: CreateNoteInput) -> Result<NoteMetadata, String> {
    Vault::new(input.vault_root)?.create_note(&input.title, &input.category)
}

#[tauri::command]
pub fn create_folder(input: CreateFolderInput) -> Result<(), String> {
    Vault::new(input.vault_root)?.create_folder(&input.path)
}

#[tauri::command]
pub fn move_note(input: MoveNoteInput) -> Result<NoteMetadata, String> {
    Vault::new(input.vault_root)?.move_note(&input.from, &input.to)
}

#[tauri::command]
pub fn delete_note(vault_root: String, path: String) -> Result<(), String> {
    Vault::new(vault_root)?.delete_note(&path)
}

#[tauri::command]
pub fn build_llm_request_preview(input: LlmPreviewInput) -> Result<LlmRequestPreview, String> {
    build_chat_request_preview(&input.settings, &input.prompt, &input.context)
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
        assert!(scan_vault(root).unwrap().is_empty());
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

        rebuild_search_index(root.clone()).unwrap();
        let results = search_index(SearchIndexInput {
            vault_root: root,
            query: "phase2".to_string(),
        })
        .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Searchable");
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
