use crate::agent_session::{
    AgentMessage, AgentOperationEvent, AgentSessionStore, AgentUndoSnapshot,
};
use crate::indexer::NoteIndex;
use crate::markdown::NoteMetadata;
use crate::vault::Vault;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};

static MUTATION_LOCK: Mutex<()> = Mutex::new(());

pub fn mutation_lock() -> Result<MutexGuard<'static, ()>, String> {
    MUTATION_LOCK
        .lock()
        .map_err(|_| "failed to lock vault writes".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommit {
    pub event: AgentOperationEvent,
    pub undo_snapshot: AgentUndoSnapshot,
    pub messages: Vec<AgentMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCommitInput {
    pub vault_root: String,
    pub path: String,
    pub target_path: Option<String>,
    pub content: String,
    pub expected_revision: Option<String>,
    #[serde(default)]
    pub create: bool,
    pub agent: Option<AgentCommit>,
    pub source_check: Option<SourceCheck>,
    pub content_path: Option<String>,
    pub undo_snapshot_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceCheck {
    pub path: String,
    pub revision: String,
}

/// One logical write. File, index and Agent persistence failures restore the previous file.
pub fn commit_note_change(input: NoteCommitInput) -> Result<NoteMetadata, String> {
    let _lock = mutation_lock()?;
    commit_note_change_locked(input)
}

fn commit_note_change_locked(input: NoteCommitInput) -> Result<NoteMetadata, String> {
    let vault = Vault::new(&input.vault_root)?;
    if let Some(source) = &input.source_check {
        vault.check_revision(&source.path, Some(&source.revision))?;
    }
    let target = input.target_path.as_deref().unwrap_or(&input.path);
    let target_path = vault.note_path(target)?;
    let before = if input.create {
        None
    } else {
        Some(vault.read_note_source(&input.path)?)
    };
    if !input.create && input.expected_revision.is_none() {
        return Err(
            "Reload this note before saving so its disk version can be checked.".to_string(),
        );
    }
    let index = NoteIndex::open(vault.safe_path(".inote/index.sqlite3")?)?;
    let store = AgentSessionStore::open(vault.safe_path(".inote/agent.sqlite3")?)?;
    let previous = if input.create {
        None
    } else {
        Some(vault.read_note(&input.path)?)
    };
    let mut dependent_sources = Vec::new();
    let future = crate::markdown::parse_note_content(vault.root(), &target_path, &input.content)?;
    if let Some(previous) = &previous {
        if previous.path != target || previous.title != future.title {
            for link in index.backlinks(&input.path)? {
                if link.source_path != input.path
                    && !dependent_sources
                        .iter()
                        .any(|(path, _, _)| path == &link.source_path)
                {
                    let source = vault.read_note_source(&link.source_path)?;
                    let revision = crate::markdown::source_revision(&source);
                    dependent_sources.push((link.source_path, source, revision));
                }
            }
        }
    }
    let content = crate::markdown_paths::rebase_markdown(
        &input.content,
        input.content_path.as_deref().unwrap_or(&input.path),
        target,
    );
    let content = previous
        .as_ref()
        .map(|previous| {
            crate::markdown_paths::redirect_note_links(&content, target, previous, &future)
        })
        .unwrap_or(content);
    let saved = if input.create {
        vault.persist_content(&target_path, &content, true)?;
        match vault.read_note(target) {
            Ok(note) => note,
            Err(error) => {
                let _ = std::fs::remove_file(&target_path);
                return Err(error);
            }
        }
    } else {
        vault.save_note_at(
            &input.path,
            target,
            &content,
            input.expected_revision.as_deref(),
            Some(target),
        )?
    };
    let mut changed_dependencies: Vec<(String, String, String)> = Vec::new();
    let mut affected_paths = vec![
        vault.root().join(&input.path).to_string_lossy().to_string(),
        target_path.to_string_lossy().to_string(),
    ];
    let result = (|| {
        if let Some(previous) = &previous {
            for (path, source, revision) in &dependent_sources {
                let updated =
                    crate::markdown_paths::redirect_note_links(source, path, previous, &saved);
                if &updated != source {
                    vault.check_revision(path, Some(revision))?;
                    let updated_note = vault.write_note(path, &updated)?;
                    changed_dependencies.push((
                        path.clone(),
                        source.clone(),
                        updated_note.source_revision,
                    ));
                    affected_paths.push(vault.root().join(path).to_string_lossy().to_string());
                }
            }
        }
        index.refresh_paths(vault.root(), &affected_paths)?;
        store.commit_note_change(
            &input.path,
            &saved,
            input.agent.as_ref(),
            input.undo_snapshot_id.as_deref(),
        )?;
        Ok(())
    })();
    if let Err(error) = result {
        // Refuse to roll back over a subsequent external edit.
        vault.check_revision(target, Some(&saved.source_revision))?;
        let rollback = (|| {
            for (path, source, revision) in &changed_dependencies {
                vault.check_revision(path, Some(revision))?;
                vault.write_note(path, source)?;
            }
            if let Some(source) = before.as_deref() {
                if input.path == target {
                    vault.write_note(&input.path, source)?;
                } else {
                    vault.persist_content(&vault.note_path(&input.path)?, source, true)?;
                    std::fs::remove_file(&target_path).map_err(|error| error.to_string())?;
                }
            } else {
                std::fs::remove_file(&target_path).map_err(|error| error.to_string())?;
            }
            index.refresh_paths(vault.root(), &affected_paths)
        })();
        return match rollback {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!("{error}; recovery failed: {rollback}")),
        };
    }
    Ok(saved)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoResult {
    pub restored: Option<NoteMetadata>,
    pub removed_path: Option<String>,
    pub active_path: String,
}

pub fn undo_agent_change(vault_root: String, note_path: String) -> Result<UndoResult, String> {
    let _lock = mutation_lock()?;
    let vault = Vault::new(&vault_root)?;
    let store = AgentSessionStore::open(vault.safe_path(".inote/agent.sqlite3")?)?;
    let snapshot = store
        .load_last_undo_snapshot(&note_path)?
        .ok_or("No Agent undo snapshot is available.")?;
    let revision = snapshot.applied_revision.as_deref().ok_or(
        "This legacy undo snapshot cannot verify the disk version. Recover its contents manually.",
    )?;
    if let Some(created_path) = &snapshot.created_note_path {
        vault.check_revision(created_path, Some(revision))?;
        let source = vault.read_note_source(created_path)?;
        let trash_path = format!(
            ".trash/agent-undo-{}.md",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let trashed = vault.move_note(created_path, &trash_path)?;
        let index = NoteIndex::open(vault.safe_path(".inote/index.sqlite3")?)?;
        let paths = [
            vault
                .root()
                .join(created_path)
                .to_string_lossy()
                .to_string(),
            vault.root().join(&trash_path).to_string_lossy().to_string(),
        ];
        if let Err(error) = index
            .refresh_paths(vault.root(), &paths)
            .and_then(|_| store.clear_last_undo_snapshot(&snapshot.note_path))
        {
            vault
                .save_note_at(
                    &trash_path,
                    created_path,
                    &source,
                    Some(&trashed.source_revision),
                    Some(created_path),
                )
                .map_err(|rollback| format!("{error}; recovery failed: {rollback}"))?;
            index
                .refresh_paths(vault.root(), &paths)
                .map_err(|rollback| format!("{error}; index recovery failed: {rollback}"))?;
            return Err(error);
        }
        return Ok(UndoResult {
            restored: None,
            removed_path: Some(created_path.clone()),
            active_path: snapshot.note_before_path,
        });
    }
    let restored = commit_note_change_locked(NoteCommitInput {
        vault_root,
        path: snapshot.active_path_after_apply.clone(),
        target_path: Some(snapshot.note_before_path.clone()),
        content: snapshot.note_before_markdown.clone(),
        content_path: Some(snapshot.note_before_path.clone()),
        expected_revision: Some(revision.to_string()),
        create: false,
        agent: None,
        source_check: None,
        undo_snapshot_id: Some(snapshot.id),
    })?;
    Ok(UndoResult {
        active_path: restored.path.clone(),
        restored: Some(restored),
        removed_path: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_session::AgentTurn;

    fn input(vault: &Vault, note: &NoteMetadata, content: &str) -> NoteCommitInput {
        NoteCommitInput {
            vault_root: vault.root().to_string_lossy().to_string(),
            path: note.path.clone(),
            target_path: None,
            content: content.to_string(),
            expected_revision: Some(note.source_revision.clone()),
            create: false,
            agent: None,
            source_check: None,
            content_path: None,
            undo_snapshot_id: None,
        }
    }

    fn agent(vault: &Vault, note: &NoteMetadata) -> AgentCommit {
        let store = AgentSessionStore::open(vault.root().join(".inote/agent.sqlite3")).unwrap();
        store
            .upsert_session("session", &note.path, &note.title, "2026-10-22T00:00:00Z")
            .unwrap();
        store
            .record_turn(&AgentTurn {
                id: "turn".into(),
                session_id: "session".into(),
                note_path: note.path.clone(),
                command: "edit".into(),
                action: None,
                prompt: String::new(),
                context_summary: String::new(),
                raw_response: String::new(),
                parsed_result_json: None,
                status: "ready".into(),
                error: None,
                created_at: "2026-10-22T00:00:00Z".into(),
                completed_at: None,
            })
            .unwrap();
        AgentCommit {
            event: AgentOperationEvent {
                id: "event".into(),
                session_id: "session".into(),
                turn_id: "turn".into(),
                note_path: note.path.clone(),
                operation_types: vec![
                    "update_current_note".into(),
                    "append_to_current_note".into(),
                ],
                changed_fields: vec!["body".into(), "tags".into()],
                created_note_path: None,
                applied_at: "2026-10-22T00:00:00Z".into(),
            },
            undo_snapshot: AgentUndoSnapshot {
                id: "snapshot".into(),
                session_id: "session".into(),
                event_id: "event".into(),
                note_path: note.path.clone(),
                note_before_markdown: vault.read_note_source(&note.path).unwrap(),
                note_before_path: note.path.clone(),
                active_path_after_apply: note.path.clone(),
                created_note_path: None,
                created_at: "2026-10-22T00:00:00Z".into(),
                applied_revision: None,
            },
            messages: Vec::new(),
        }
    }

    #[test]
    fn stale_write_and_invalid_yaml_leave_the_disk_version_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let vault = Vault::new(directory.path()).unwrap();
        let original = vault.write_note("notes/a.md", "# Before").unwrap();
        let stale = input(&vault, &original, "# Stale");
        let current = vault.write_note("notes/a.md", "# External").unwrap();
        assert!(commit_note_change(stale)
            .unwrap_err()
            .contains("changed on disk"));
        assert!(
            commit_note_change(input(&vault, &current, "---\ntitle: [broken\n---\nBad")).is_err()
        );
        assert_eq!(vault.read_note_source("notes/a.md").unwrap(), "# External");
    }

    #[test]
    fn move_never_overwrites_an_existing_note() {
        let directory = tempfile::tempdir().unwrap();
        let vault = Vault::new(directory.path()).unwrap();
        let note = vault.write_note("a.md", "# A").unwrap();
        vault.write_note("b.md", "# B").unwrap();
        let mut change = input(&vault, &note, "# Changed");
        change.target_path = Some("b.md".into());
        assert!(commit_note_change(change).is_err());
        assert_eq!(vault.read_note_source("a.md").unwrap(), "# A");
        assert_eq!(vault.read_note_source("b.md").unwrap(), "# B");
    }

    #[test]
    fn failed_agent_persistence_rolls_back_file_index_and_undo() {
        let directory = tempfile::tempdir().unwrap();
        let vault = Vault::new(directory.path()).unwrap();
        let note = vault.write_note("a.md", "# Original searchable").unwrap();
        let mut change = input(&vault, &note, "# Replacement searchable");
        let mut payload = agent(&vault, &note);
        payload.event.session_id = "missing-session".into();
        change.agent = Some(payload);
        assert!(commit_note_change(change).is_err());
        assert_eq!(
            vault.read_note_source("a.md").unwrap(),
            "# Original searchable"
        );
        let index = NoteIndex::open(vault.safe_path(".inote/index.sqlite3").unwrap()).unwrap();
        assert_eq!(index.search("Original").unwrap().len(), 1);
        assert!(index.search("Replacement").unwrap().is_empty());
        assert!(
            AgentSessionStore::open(vault.root().join(".inote/agent.sqlite3"))
                .unwrap()
                .load_last_undo_snapshot("a.md")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn undo_restores_the_complete_review_and_rejects_later_external_edits() {
        let directory = tempfile::tempdir().unwrap();
        let vault = Vault::new(directory.path()).unwrap();
        let note = vault
            .write_note("a.md", "---\ntitle: Before\ntags: [old]\n---\n\nOriginal")
            .unwrap();
        let mut change = input(
            &vault,
            &note,
            "---\ntitle: After\ntags: [new]\n---\n\nOriginal\n\nAppendix",
        );
        change.agent = Some(agent(&vault, &note));
        let saved = commit_note_change(change).unwrap();
        let restored = undo_agent_change(vault.root().to_string_lossy().to_string(), saved.path)
            .unwrap()
            .restored
            .unwrap();
        assert_eq!(restored.title, "Before");
        assert_eq!(restored.tags, ["old"]);
        assert!(!restored.body.contains("Appendix"));

        let mut change = input(&vault, &restored, "# Another apply");
        change.agent = Some(agent(&vault, &restored));
        // The operation ID is unique per review.
        change.agent.as_mut().unwrap().event.id = "event-2".into();
        change.agent.as_mut().unwrap().undo_snapshot.id = "snapshot-2".into();
        change.agent.as_mut().unwrap().undo_snapshot.event_id = "event-2".into();
        commit_note_change(change).unwrap();
        vault.write_note("a.md", "# Later external edit").unwrap();
        assert!(
            undo_agent_change(vault.root().to_string_lossy().to_string(), "a.md".into()).is_err()
        );
        assert_eq!(
            vault.read_note_source("a.md").unwrap(),
            "# Later external edit"
        );
    }

    #[test]
    fn concurrent_saves_with_the_same_base_allow_only_one_commit() {
        let directory = tempfile::tempdir().unwrap();
        let vault = Vault::new(directory.path()).unwrap();
        let note = vault.write_note("a.md", "# Base").unwrap();
        let left = input(&vault, &note, "# Left");
        let right = input(&vault, &note, "# Right");
        let left = std::thread::spawn(move || commit_note_change(left));
        let right = std::thread::spawn(move || commit_note_change(right));
        assert_eq!(
            usize::from(left.join().unwrap().is_ok()) + usize::from(right.join().unwrap().is_ok()),
            1
        );
    }

    #[test]
    fn moving_a_note_updates_incoming_links_and_keeps_relative_assets_working() {
        let directory = tempfile::tempdir().unwrap();
        let vault = Vault::new(directory.path()).unwrap();
        let target = vault
            .write_note(
                "old/a.md",
                "# Target\n\n![image](_assets/a/pic.png)\n[self](a.md)",
            )
            .unwrap();
        vault
            .write_note(
                "notes/source.md",
                "# Source\n\n[Target](../old/a.md#section)\n[[Target|label]]",
            )
            .unwrap();
        std::fs::create_dir_all(vault.root().join("old/_assets/a")).unwrap();
        std::fs::write(vault.root().join("old/_assets/a/pic.png"), b"image").unwrap();
        let index = NoteIndex::open(vault.safe_path(".inote/index.sqlite3").unwrap()).unwrap();
        index
            .full_rebuild(vault.root(), &vault.scan().unwrap())
            .unwrap();
        let mut change = input(
            &vault,
            &target,
            &vault.read_note_source(&target.path).unwrap(),
        );
        change.target_path = Some("new/deep/renamed.md".into());
        let saved = commit_note_change(change).unwrap();
        assert!(saved.body.contains("../../old/_assets/a/pic.png"));
        assert!(saved.body.contains("[self](renamed.md)"));
        assert!(vault
            .read_note_source("notes/source.md")
            .unwrap()
            .contains("../new/deep/renamed.md#section"));
        assert!(index
            .backlinks(&saved.path)
            .unwrap()
            .iter()
            .any(|link| link.source_path == "notes/source.md"));
        assert!(vault.root().join("old/_assets/a/pic.png").exists());
        assert!(!vault.root().join("old/a.md").exists());
    }

    #[test]
    fn undoing_a_created_note_checks_its_revision_and_keeps_the_source_note() {
        let directory = tempfile::tempdir().unwrap();
        let vault = Vault::new(directory.path()).unwrap();
        let source = vault.write_note("source.md", "# Source").unwrap();
        let mut payload = agent(&vault, &source);
        payload.event.created_note_path = Some("created.md".into());
        payload.undo_snapshot.created_note_path = Some("created.md".into());
        payload.undo_snapshot.active_path_after_apply = "created.md".into();
        let mut change = input(&vault, &source, "# Created");
        change.path = "created.md".into();
        change.create = true;
        change.expected_revision = None;
        change.agent = Some(payload);
        commit_note_change(change).unwrap();
        vault
            .write_note("created.md", "# Edited after creation")
            .unwrap();
        assert!(undo_agent_change(
            vault.root().to_string_lossy().to_string(),
            "created.md".into()
        )
        .is_err());
        vault.write_note("created.md", "# Created").unwrap();
        let undone = undo_agent_change(
            vault.root().to_string_lossy().to_string(),
            "created.md".into(),
        )
        .unwrap();
        assert_eq!(undone.removed_path.as_deref(), Some("created.md"));
        assert!(!vault.root().join("created.md").exists());
        assert_eq!(vault.read_note_source("source.md").unwrap(), "# Source");
    }
}
