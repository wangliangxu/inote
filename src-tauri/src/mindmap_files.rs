//! Import/export only paths selected by the user in a native file dialog.
use serde::Serialize;
use std::io::Read;
use tauri_plugin_dialog::DialogExt;
const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Serialize)]
pub struct MapFile {
    name: String,
    content: Option<String>,
    error: Option<String>,
}

fn read_map_file(path: &std::path::Path) -> MapFile {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let result = (|| -> Result<String, &str> {
        if path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("mindnode"))
        {
            return Err("mindnode");
        }
        let file = std::fs::File::open(path).map_err(|_| "read")?;
        if file.metadata().map_err(|_| "read")?.len() > MAX_FILE_BYTES {
            return Err("limit");
        }
        let mut bytes = Vec::new();
        file.take(MAX_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "read")?;
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err("limit");
        }
        String::from_utf8(bytes).map_err(|_| "read")
    })();
    match result {
        Ok(content) => MapFile {
            name,
            content: Some(content),
            error: None,
        },
        Err(error) => MapFile {
            name,
            content: None,
            error: Some(error.into()),
        },
    }
}

#[tauri::command(async)]
pub fn pick_mindmap_files(app: tauri::AppHandle) -> Result<Vec<MapFile>, String> {
    let paths = app
        .dialog()
        .file()
        .add_filter(
            "Mind maps",
            &["mm", "opml", "inote-mindmap", "json", "mindnode"],
        )
        .blocking_pick_files()
        .unwrap_or_default();
    if paths.len() > 100 {
        return Err("batch".into());
    }
    Ok(paths
        .into_iter()
        .map(|path| match path.into_path() {
            Ok(path) => read_map_file(&path),
            Err(_) => MapFile {
                name: String::new(),
                content: None,
                error: Some("read".into()),
            },
        })
        .collect())
}

#[tauri::command(async)]
pub fn export_mindmap_file(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<bool, String> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err("Export exceeds 10 MiB.".into());
    }
    let filename = std::path::Path::new(&filename)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("Invalid filename")?;
    let extension = std::path::Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .ok_or("Invalid extension")?;
    if !["mm", "opml", "inote-mindmap", "md"].contains(&extension) {
        return Err("Unsupported extension".into());
    }
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("Mind map", &[extension])
        .set_file_name(filename)
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mindmap_notes_commit_reopen_move_and_search_without_losing_tree_data() {
        use crate::persistence::{commit_note_change, NoteCommitInput};
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let source = "---\ntitle: 导图\ntags: [planning]\ncreated_at: 2026-10-29\nupdated_at: 2026-10-29\ninote_mindmap:\n  version: 1\n  roots:\n    - id: root\n      text: 中心\n      collapsed: true\n      children:\n        - id: child\n          text: searchabletopic\n          note: 节点备注\n          children: []\n---\n\n- 中心\n  - searchabletopic\n    节点备注\n";
        let create = NoteCommitInput {
            vault_root: root.clone(),
            path: "knowledge/map.md".into(),
            target_path: None,
            content: source.into(),
            expected_revision: None,
            create: true,
            agent: None,
            source_check: None,
            content_path: None,
            undo_snapshot_id: None,
        };
        let saved = commit_note_change(create.clone()).unwrap();
        assert!(commit_note_change(create).is_err());
        let vault = crate::vault::Vault::new(dir.path()).unwrap();
        let reopened = vault.read_note(&saved.path).unwrap();
        assert_eq!(
            reopened.frontmatter["inote_mindmap"]["roots"][0]["children"][0]["note"],
            "节点备注"
        );
        let index =
            crate::indexer::NoteIndex::open(dir.path().join(".inote/index.sqlite3")).unwrap();
        assert_eq!(index.search("searchabletopic").unwrap().len(), 1);
        let moved = commit_note_change(NoteCommitInput {
            vault_root: root,
            path: saved.path,
            target_path: Some("archive/map.md".into()),
            content: source.into(),
            expected_revision: Some(saved.source_revision),
            create: false,
            agent: None,
            source_check: None,
            content_path: None,
            undo_snapshot_id: None,
        })
        .unwrap();
        assert_eq!(moved.frontmatter, reopened.frontmatter);
        assert_eq!(
            index.search("searchabletopic").unwrap()[0].path,
            "archive/map.md"
        );
        assert!(!dir.path().join("knowledge/map.md").exists());
    }

    #[test]
    fn reads_unicode_and_reports_invalid_or_large_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("map.mm");
        std::fs::write(&path, "中文节点").unwrap();
        assert_eq!(read_map_file(&path).content.as_deref(), Some("中文节点"));
        assert!(read_map_file(&dir.path().join("missing.mm"))
            .error
            .is_some());
        std::fs::write(&path, [0xff]).unwrap();
        assert_eq!(read_map_file(&path).error.as_deref(), Some("read"));
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        assert_eq!(read_map_file(&path).error.as_deref(), Some("limit"));
        assert_eq!(
            read_map_file(&dir.path().join("old.mindnode"))
                .error
                .as_deref(),
            Some("mindnode")
        );
    }
}
