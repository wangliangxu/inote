use crate::llm::{build_chat_request_preview, LlmProviderSettings, LlmRequestPreview};
use crate::markdown::NoteMetadata;
use crate::vault::Vault;
use serde::{Deserialize, Serialize};

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
