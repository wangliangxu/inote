use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct WatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultChangedEvent {
    pub paths: Vec<String>,
}

impl WatcherState {
    pub fn start(&self, app: AppHandle, root: PathBuf) -> Result<(), String> {
        if !root.exists() {
            return Err("vault path does not exist".to_string());
        }

        let mut last_emit = Instant::now() - Duration::from_secs(1);
        let mut watcher = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| {
                let Ok(event) = result else {
                    return;
                };
                if !is_relevant_event(&event) {
                    return;
                }
                if last_emit.elapsed() < Duration::from_millis(350) {
                    return;
                }
                last_emit = Instant::now();
                let payload = VaultChangedEvent {
                    paths: event
                        .paths
                        .iter()
                        .map(|path| path.to_string_lossy().to_string())
                        .collect(),
                };
                let _ = app.emit("vault://changed", payload);
            },
            Config::default(),
        )
        .map_err(|error| format!("failed to create file watcher: {error}"))?;

        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|error| format!("failed to watch vault: {error}"))?;

        let mut current = self
            .watcher
            .lock()
            .map_err(|_| "failed to lock watcher state".to_string())?;
        *current = Some(watcher);
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut current = self
            .watcher
            .lock()
            .map_err(|_| "failed to lock watcher state".to_string())?;
        *current = None;
        Ok(())
    }
}

pub fn is_relevant_event(event: &Event) -> bool {
    event.paths.iter().any(|path| is_relevant_path(path))
}

fn is_relevant_path(path: &Path) -> bool {
    // Ignore hidden files and directories (like .git, .inote, .DS_Store)
    if path.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.')) {
        return false;
    }

    // Check extension
    if let Some(ext) = path.extension().and_then(|v| v.to_str()) {
        if ext == "md" {
            return true;
        }
        // If it has an extension but is actually a directory (e.g., "v1.0")
        if path.is_dir() {
            return true;
        }
        return false;
    }

    // Paths without extensions are treated as directories/relevant
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::{event::ModifyKind, EventKind};

    #[test]
    fn markdown_events_trigger_refresh() {
        let event = Event::new(EventKind::Modify(ModifyKind::Data(
            notify::event::DataChange::Content,
        )))
        .add_path(PathBuf::from("knowledge/rust.md"));

        assert!(is_relevant_event(&event));
    }

    #[test]
    fn index_database_events_do_not_trigger_refresh() {
        let event = Event::new(EventKind::Modify(ModifyKind::Data(
            notify::event::DataChange::Content,
        )))
        .add_path(PathBuf::from(".inote/index.sqlite3"));

        assert!(!is_relevant_event(&event));
    }

    #[test]
    fn directory_events_trigger_refresh() {
        let event = Event::new(EventKind::Modify(ModifyKind::Name(
            notify::event::RenameMode::Both,
        )))
        .add_path(PathBuf::from("Notes/OldCategory"))
        .add_path(PathBuf::from("Notes/NewCategory"));

        assert!(is_relevant_event(&event));
    }
}
