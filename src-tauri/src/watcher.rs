use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct WatcherState {
    watcher: Mutex<Option<ActiveWatcher>>,
}

enum WatchMessage {
    Changed(Vec<PathBuf>),
    Stop,
}

struct ActiveWatcher {
    watcher: Option<RecommendedWatcher>,
    sender: Sender<WatchMessage>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for ActiveWatcher {
    fn drop(&mut self) {
        self.watcher.take();
        let _ = self.sender.send(WatchMessage::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn collect_batches(
    receiver: mpsc::Receiver<WatchMessage>,
    mut emit: impl FnMut(Vec<String>),
    delay: Duration,
) {
    while let Ok(message) = receiver.recv() {
        let WatchMessage::Changed(paths) = message else {
            break;
        };
        let mut pending = paths.into_iter().collect::<HashSet<_>>();
        let started = Instant::now();
        loop {
            let wait = delay.min(Duration::from_secs(1).saturating_sub(started.elapsed()));
            match receiver.recv_timeout(wait) {
                Ok(WatchMessage::Changed(paths)) => pending.extend(paths),
                Ok(WatchMessage::Stop) | Err(RecvTimeoutError::Disconnected) => return,
                Err(RecvTimeoutError::Timeout) => break,
            }
            if started.elapsed() >= Duration::from_secs(1) {
                break;
            }
        }
        let mut paths = pending
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        paths.sort();
        emit(paths);
    }
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

        let root = std::fs::canonicalize(root).map_err(|error| error.to_string())?;
        let watched_root = root.clone();
        let (sender, receiver) = mpsc::channel();
        let event_sender = sender.clone();
        let mut watcher = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| {
                let Ok(event) = result else {
                    return;
                };
                if matches!(event.kind, notify::EventKind::Access(_)) {
                    return;
                }
                let paths = event
                    .paths
                    .into_iter()
                    .filter(|path| path.strip_prefix(&watched_root).is_ok_and(is_relevant_path))
                    .collect::<Vec<_>>();
                if !paths.is_empty() {
                    let _ = event_sender.send(WatchMessage::Changed(paths));
                }
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
        let worker = std::thread::spawn(move || {
            collect_batches(
                receiver,
                |paths| {
                    let _ = app.emit("vault://changed", VaultChangedEvent { paths });
                },
                Duration::from_millis(350),
            )
        });
        *current = Some(ActiveWatcher {
            watcher: Some(watcher),
            sender,
            worker: Some(worker),
        });
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
    if path.components().any(|component| {
        matches!(
            component.as_os_str().to_str(),
            Some(".inote" | ".git" | "node_modules")
        )
    }) || path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(".inote-tmp-"))
    {
        return false;
    }

    // Check extension
    if let Some(ext) = path.extension().and_then(|v| v.to_str()) {
        if ext == "md" {
            return true;
        }
        // If it has an extension but is actually a directory (e.g., "v1.0")
        if path.is_dir() || !path.exists() {
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
    fn burst_events_are_merged_and_the_last_path_is_not_dropped() {
        let (sender, receiver) = mpsc::channel();
        let (result_sender, result_receiver) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            collect_batches(
                receiver,
                |paths| {
                    result_sender.send(paths).unwrap();
                },
                Duration::from_millis(20),
            )
        });
        for path in ["a.md", "b.md", "a.md", "last.md"] {
            sender
                .send(WatchMessage::Changed(vec![PathBuf::from(path)]))
                .unwrap();
        }
        assert_eq!(
            result_receiver
                .recv_timeout(Duration::from_secs(2))
                .unwrap(),
            ["a.md", "b.md", "last.md"]
        );
        sender.send(WatchMessage::Stop).unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn trash_changes_are_relevant_but_internal_files_are_ignored() {
        assert!(is_relevant_path(Path::new(".trash/note.md")));
        assert!(!is_relevant_path(Path::new(".inote/drafts.json")));
        assert!(!is_relevant_path(Path::new(".git/notes.md")));
    }

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
