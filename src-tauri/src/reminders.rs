//! One-way, opt-in synchronization of committed note tasks to Apple Reminders.
//! Identifiers stay in local app data; Markdown contains only the reminder timing.
use crate::markdown::NoteMetadata;
use crate::settings::UserSettingsStore;
use crate::vault::Vault;
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone};
use ring::rand::{SecureRandom, SystemRandom};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use tauri::AppHandle;

static SYNC_LOCK: Mutex<()> = Mutex::new(());
const SETTINGS_KEY: &str = "macos_reminders";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReminderSettings {
    pub supported: bool,
    pub enabled: bool,
    pub calendar_id: String,
}

// EventKit waits for callbacks and may show a permission prompt. Keep those waits
// off both the UI thread and Tokio's async workers.
async fn on_worker<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_reminders_settings(app: AppHandle) -> Result<ReminderSettings, String> {
    on_worker(move || get_reminders_settings_impl(app)).await
}

#[tauri::command]
pub async fn connect_reminders() -> Result<Value, String> {
    on_worker(connect_reminders_impl).await
}

#[tauri::command]
pub async fn configure_reminders(
    app: AppHandle,
    enabled: bool,
    calendar_id: String,
) -> Result<ReminderSettings, String> {
    on_worker(move || configure_reminders_impl(app, enabled, calendar_id)).await
}

#[tauri::command]
pub async fn sync_note_reminder(
    app: AppHandle,
    vault_root: String,
    old_path: String,
    path: Option<String>,
) -> Result<SyncReport, String> {
    on_worker(move || sync_note_reminder_impl(app, vault_root, old_path, path)).await
}

#[tauri::command]
pub async fn sync_reminders(app: AppHandle, vault_root: String) -> Result<SyncReport, String> {
    on_worker(move || sync_reminders_impl(app, vault_root)).await
}

fn settings(path: &Path) -> Result<ReminderSettings, String> {
    let saved = UserSettingsStore::open(path)?.get_value(SETTINGS_KEY)?;
    let mut settings: ReminderSettings = match saved {
        Some(value) => serde_json::from_str(&value).map_err(|e| e.to_string())?,
        None => ReminderSettings::default(),
    };
    settings.supported = cfg!(target_os = "macos");
    Ok(settings)
}

fn get_reminders_settings_impl(app: AppHandle) -> Result<ReminderSettings, String> {
    settings(&crate::commands::settings_db_path(&app)?)
}

fn connect_reminders_impl() -> Result<Value, String> {
    let _guard = SYNC_LOCK.lock().map_err(|e| e.to_string())?;
    native(json!({"operation": "connect"}))
}

fn configure_reminders_impl(
    app: AppHandle,
    enabled: bool,
    calendar_id: String,
) -> Result<ReminderSettings, String> {
    let _guard = SYNC_LOCK.lock().map_err(|e| e.to_string())?;
    if enabled {
        let available = native(json!({"operation": "calendars"}))?;
        if !available["calendars"].as_array().is_some_and(|items| {
            items
                .iter()
                .any(|item| item["id"].as_str() == Some(&calendar_id))
        }) {
            return Err("Choose a writable reminders list before enabling sync.".into());
        }
    }
    let settings = ReminderSettings {
        supported: cfg!(target_os = "macos"),
        enabled,
        calendar_id,
    };
    UserSettingsStore::open(crate::commands::settings_db_path(&app)?)?.set_value(
        SETTINGS_KEY,
        &serde_json::to_string(&settings).map_err(|e| e.to_string())?,
    )?;
    Ok(settings)
}

#[derive(Debug)]
struct Link {
    path: String,
    marker: String,
    identifier: String,
    fingerprint: String,
}

struct Links {
    conn: Connection,
    vault: String,
}
impl Links {
    fn open(path: &Path, vault: &Vault) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS reminder_links (
            vault TEXT NOT NULL, path TEXT NOT NULL, marker TEXT NOT NULL UNIQUE,
            identifier TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (vault, path)
        )",
        )
        .map_err(|e| e.to_string())?;
        Ok(Self {
            conn,
            vault: vault.root().to_string_lossy().into_owned(),
        })
    }

    fn get(&self, path: &str) -> Result<Option<Link>, String> {
        self.conn.query_row("SELECT path, marker, identifier, fingerprint FROM reminder_links WHERE vault=?1 AND path=?2",
            params![self.vault, path], |row| Ok(Link { path: row.get(0)?, marker: row.get(1)?, identifier: row.get(2)?, fingerprint: row.get(3)? }))
            .optional().map_err(|e| e.to_string())
    }

    fn all(&self) -> Result<Vec<Link>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT path, marker, identifier, fingerprint FROM reminder_links WHERE vault=?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&self.vault], |row| {
                Ok(Link {
                    path: row.get(0)?,
                    marker: row.get(1)?,
                    identifier: row.get(2)?,
                    fingerprint: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn ensure(&self, path: &str) -> Result<Link, String> {
        if let Some(link) = self.get(path)? {
            return Ok(link);
        }
        let mut bytes = [0u8; 16];
        SystemRandom::new()
            .fill(&mut bytes)
            .map_err(|_| "Could not create reminder ID.")?;
        let key: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let marker = format!("inote://reminder/{key}");
        // Persist ownership before calling EventKit, allowing recovery if the app exits mid-save.
        self.conn
            .execute(
                "INSERT INTO reminder_links (vault, path, marker) VALUES (?1, ?2, ?3)",
                params![self.vault, path, marker],
            )
            .map_err(|e| e.to_string())?;
        self.get(path)?
            .ok_or_else(|| "Could not record reminder ID.".into())
    }

    fn remove(
        &self,
        link: &Link,
        backend: &mut impl FnMut(Value) -> Result<Value, String>,
    ) -> Result<(), String> {
        backend(
            json!({"operation": "remove", "marker": link.marker, "identifier": link.identifier}),
        )?;
        self.conn
            .execute(
                "DELETE FROM reminder_links WHERE vault=?1 AND path=?2",
                params![self.vault, link.path],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn rename(
        &self,
        from: &str,
        to: &str,
        backend: &mut impl FnMut(Value) -> Result<Value, String>,
    ) -> Result<(), String> {
        if from == to || self.get(from)?.is_none() {
            return Ok(());
        }
        if let Some(stale) = self.get(to)? {
            self.remove(&stale, backend)?;
        }
        self.conn
            .execute(
                "UPDATE reminder_links SET path=?1, fingerprint='' WHERE vault=?2 AND path=?3",
                params![to, self.vault, from],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn due_timestamp(due: &str) -> Result<(i64, bool), String> {
    if let Ok(date) = DateTime::parse_from_rfc3339(due) {
        return Ok((date.timestamp(), false));
    }
    let (date, all_day) = if let Ok(date) = NaiveDate::parse_from_str(due, "%Y-%m-%d") {
        (date.and_hms_opt(9, 0, 0).unwrap(), true)
    } else {
        let date = NaiveDateTime::parse_from_str(due, "%Y-%m-%dT%H:%M:%S")
            .or_else(|_| NaiveDateTime::parse_from_str(due, "%Y-%m-%dT%H:%M"))
            .map_err(|_| format!("Invalid task due date: {due}"))?;
        (date, false)
    };
    Local
        .from_local_datetime(&date)
        .single()
        .map(|date| (date.timestamp(), all_day))
        .ok_or_else(|| format!("The due time is ambiguous or unavailable in your time zone: {due}"))
}

fn task(note: &NoteMetadata, calendar_id: &str) -> Result<Option<Value>, String> {
    if note.raw_markdown.is_some() {
        return Err(format!(
            "{}: fix invalid frontmatter before syncing.",
            note.path
        ));
    }
    if note.path.starts_with(".trash/")
        || note.category == "archive"
        || note.category.starts_with("archive/")
        || note.status.as_deref() == Some("cancelled")
    {
        return Ok(None);
    }
    let timing = match note.frontmatter.get("reminder") {
        None => "at_due",
        Some(Value::String(value)) => value.as_str(),
        _ => return Err(format!("{}: invalid reminder timing.", note.path)),
    };
    if timing == "none" {
        return Ok(None);
    }
    let offset = match timing {
        "at_due" => 0,
        "10_minutes" => 600,
        "1_day" => 86400,
        _ => return Err(format!("{}: unknown reminder timing: {timing}", note.path)),
    };
    let Some(due) = note.due.as_deref().filter(|due| !due.is_empty()) else {
        return Ok(None);
    };
    let (timestamp, all_day) = due_timestamp(due)?;
    let completed = note.status.as_deref() == Some("done");
    Ok(Some(json!({
        "operation": "upsert", "calendarId": calendar_id, "title": note.title,
        "dueTimestamp": timestamp, "allDay": all_day, "alarmTimestamp": if completed { None } else { Some(timestamp - offset) },
        "completed": completed, "priority": match note.priority.as_deref() { Some("high") => 1, Some("medium") => 5, Some("low") => 9, _ => 0 },
        "notes": format!("iNote · {}", note.path)
    })))
}

fn sync_one(
    links: &Links,
    note: &NoteMetadata,
    calendar: &str,
    force: bool,
    backend: &mut impl FnMut(Value) -> Result<Value, String>,
) -> Result<usize, String> {
    let existing = links.get(&note.path)?;
    let Some(mut payload) = task(note, calendar)? else {
        if let Some(link) = existing {
            links.remove(&link, backend)?;
            return Ok(1);
        }
        return Ok(0);
    };
    // Never populate the system with historical completed tasks.
    if existing.is_none() && note.status.as_deref() == Some("done") {
        return Ok(0);
    }
    let recover = existing.is_some();
    let link = links.ensure(&note.path)?;
    let fingerprint = crate::markdown::source_revision(&payload.to_string());
    if !force && link.fingerprint == fingerprint {
        return Ok(0);
    }
    payload["recover"] = json!(recover);
    payload["marker"] = json!(link.marker);
    payload["identifier"] = json!(link.identifier);
    let result = backend(payload)?;
    let identifier = result["identifier"]
        .as_str()
        .ok_or("Reminders did not return an identifier.")?;
    links
        .conn
        .execute(
            "UPDATE reminder_links SET identifier=?1, fingerprint=?2 WHERE vault=?3 AND path=?4",
            params![identifier, fingerprint, links.vault, note.path],
        )
        .map_err(|e| e.to_string())?;
    Ok(1)
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub updated: usize,
    pub errors: Vec<String>,
}

fn sync_note_reminder_impl(
    app: AppHandle,
    vault_root: String,
    old_path: String,
    path: Option<String>,
) -> Result<SyncReport, String> {
    let _guard = SYNC_LOCK.lock().map_err(|e| e.to_string())?;
    let db = crate::commands::settings_db_path(&app)?;
    let config = settings(&db)?;
    if !config.supported || !config.enabled {
        return Ok(SyncReport::default());
    }
    let vault = Vault::new(vault_root)?;
    vault.note_path(&old_path)?;
    let links = Links::open(&db.with_file_name("reminders.sqlite3"), &vault)?;
    let updated = if let Some(path) = path {
        vault.note_path(&path)?;
        links.rename(&old_path, &path, &mut native)?;
        // Read the committed version, never frontend drafts or an earlier save's payload.
        sync_one(
            &links,
            &vault.read_note(&path)?,
            &config.calendar_id,
            false,
            &mut native,
        )?
    } else if let Some(link) = links.get(&old_path)? {
        links.remove(&link, &mut native)?;
        1
    } else {
        0
    };
    Ok(SyncReport {
        updated,
        errors: vec![],
    })
}

fn sync_reminders_impl(app: AppHandle, vault_root: String) -> Result<SyncReport, String> {
    let _guard = SYNC_LOCK.lock().map_err(|e| e.to_string())?;
    let db = crate::commands::settings_db_path(&app)?;
    let config = settings(&db)?;
    if !config.supported || !config.enabled {
        return Ok(SyncReport::default());
    }
    // Check access and the selected list once, before potentially reconciling many tasks.
    let available = native(json!({"operation": "calendars"}))?;
    if !available["calendars"].as_array().is_some_and(|items| {
        items
            .iter()
            .any(|item| item["id"].as_str() == Some(&config.calendar_id))
    }) {
        return Err(
            "The reminders list is missing or read-only. Choose another list in Settings.".into(),
        );
    }
    let vault = Vault::new(vault_root)?;
    let notes = {
        let _guard = crate::persistence::mutation_lock()?;
        vault.scan()?
    };
    let links = Links::open(&db.with_file_name("reminders.sqlite3"), &vault)?;
    reconcile(&links, &notes, &config.calendar_id, &mut native)
}

fn reconcile(
    links: &Links,
    notes: &[NoteMetadata],
    calendar: &str,
    backend: &mut impl FnMut(Value) -> Result<Value, String>,
) -> Result<SyncReport, String> {
    let mut report = SyncReport::default();
    let present: HashSet<_> = notes.iter().map(|note| note.path.as_str()).collect();
    for note in notes {
        match sync_one(links, note, calendar, true, backend) {
            Ok(count) => report.updated += count,
            Err(error) => report.errors.push(format!("{}: {error}", note.path)),
        }
    }
    // Only clean up missing paths after a complete, successful disk scan.
    for link in links.all()? {
        if !present.contains(link.path.as_str()) {
            match links.remove(&link, backend) {
                Ok(()) => report.updated += 1,
                Err(error) => report.errors.push(format!("{}: {error}", link.path)),
            }
        }
    }
    Ok(report)
}

#[cfg(target_os = "macos")]
fn native(input: Value) -> Result<Value, String> {
    use std::ffi::{CStr, CString};
    unsafe extern "C" {
        fn inote_reminders_call(request: *const std::ffi::c_char) -> *mut std::ffi::c_char;
        fn inote_reminders_free(response: *mut std::ffi::c_char);
    }
    let request = CString::new(input.to_string()).map_err(|e| e.to_string())?;
    // The bridge returns a strdup-allocated UTF-8 JSON string, freed by its matching allocator.
    let response = unsafe { inote_reminders_call(request.as_ptr()) };
    if response.is_null() {
        return Err("Could not allocate reminders response.".into());
    }
    let json = unsafe { CStr::from_ptr(response) }
        .to_string_lossy()
        .into_owned();
    unsafe { inote_reminders_free(response) };
    let value: Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    if let Some(error) = value["error"].as_str() {
        return Err(error.into());
    }
    Ok(value)
}

#[cfg(not(target_os = "macos"))]
fn native(_input: Value) -> Result<Value, String> {
    Err("Apple Reminders integration is available on macOS only.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::markdown::parse_note_content;
    use tempfile::tempdir;

    fn note(root: &Path, path: &str, fields: &str) -> NoteMetadata {
        parse_note_content(
            root,
            &root.join(path),
            &format!("---\ntitle: Test\ndue: 2030-10-23T14:30\n{fields}\n---\n\nBody"),
        )
        .unwrap()
    }

    #[test]
    fn maps_local_due_time_offsets_priority_and_completion() {
        let dir = tempdir().unwrap();
        let mut n = note(dir.path(), "a.md", "reminder: 10_minutes\npriority: high");
        let value = task(&n, "list").unwrap().unwrap();
        let expected = Local
            .with_ymd_and_hms(2030, 10, 23, 14, 30, 0)
            .single()
            .unwrap()
            .timestamp();
        assert_eq!(value["dueTimestamp"], expected);
        assert_eq!(value["alarmTimestamp"], expected - 600);
        assert_eq!(value["priority"], 1);
        n.status = Some("done".into());
        let value = task(&n, "list").unwrap().unwrap();
        assert_eq!(value["completed"], true);
        assert!(value["alarmTimestamp"].is_null());
        n.due = Some("2030-10-23".into());
        n.frontmatter.insert("reminder".into(), json!("1_day"));
        n.status = None;
        let value = task(&n, "list").unwrap().unwrap();
        assert_eq!(value["allDay"], true);
        assert_eq!(
            value["alarmTimestamp"].as_i64().unwrap(),
            value["dueTimestamp"].as_i64().unwrap() - 86400
        );
        assert_eq!(
            due_timestamp("2030-10-23T14:30:00+08:00").unwrap().0,
            DateTime::parse_from_rfc3339("2030-10-23T14:30:00+08:00")
                .unwrap()
                .timestamp()
        );
    }

    #[test]
    fn excludes_cancelled_archived_trashed_and_opted_out_tasks_and_rejects_invalid_dates() {
        let dir = tempdir().unwrap();
        for (path, fields) in [
            ("a.md", "status: cancelled"),
            ("archive/a.md", ""),
            (".trash/a.md", ""),
            ("a.md", "reminder: none"),
        ] {
            assert!(task(&note(dir.path(), path, fields), "list")
                .unwrap()
                .is_none());
        }
        let mut n = note(dir.path(), "a.md", "");
        n.due = None;
        assert!(task(&n, "list").unwrap().is_none());
        n.due = Some("2030-02-30T09:00".into());
        assert!(task(&n, "list").is_err());
        n.raw_markdown = Some("broken".into());
        assert!(task(&n, "list").unwrap_err().contains("frontmatter"));
    }

    #[test]
    fn rename_complete_reopen_and_delete_keep_the_same_owned_reminder() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path().join("vault")).unwrap();
        let links = Links::open(&dir.path().join("links.db"), &vault).unwrap();
        let mut n = note(vault.root(), "a.md", "");
        let mut calls = vec![];
        let mut backend = |payload: Value| {
            calls.push(payload);
            Ok(json!({"identifier": "system-id"}))
        };
        assert_eq!(
            sync_one(&links, &n, "list", false, &mut backend).unwrap(),
            1
        );
        assert_eq!(
            sync_one(&links, &n, "list", false, &mut backend).unwrap(),
            0
        );
        let marker = links.get("a.md").unwrap().unwrap().marker;
        links.rename("a.md", "renamed.md", &mut backend).unwrap();
        n.path = "renamed.md".into();
        n.status = Some("done".into());
        sync_one(&links, &n, "list", false, &mut backend).unwrap();
        n.status = Some("in_progress".into());
        sync_one(&links, &n, "new-list", false, &mut backend).unwrap();
        n.status = Some("cancelled".into());
        sync_one(&links, &n, "new-list", false, &mut backend).unwrap();
        assert!(links.get("a.md").unwrap().is_none());
        assert!(links.get("renamed.md").unwrap().is_none());
        assert_eq!(calls.len(), 4);
        assert!(calls.iter().all(|call| call["marker"] == marker));
        assert_eq!(calls[1]["identifier"], "system-id");
        assert_eq!(calls[1]["completed"], true);
        assert_eq!(calls[2]["completed"], false);
        assert_eq!(calls[2]["calendarId"], "new-list");
        assert_eq!(calls[3]["operation"], "remove");
    }

    #[test]
    fn retries_failed_native_writes_and_removals_without_losing_ownership() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path().join("vault")).unwrap();
        let links = Links::open(&dir.path().join("links.db"), &vault).unwrap();
        let mut n = note(vault.root(), "a.md", "");
        assert!(sync_one(&links, &n, "list", false, &mut |_| Err("denied".into())).is_err());
        let first = links.get("a.md").unwrap().unwrap();
        assert!(first.identifier.is_empty());
        assert!(first.fingerprint.is_empty());
        sync_one(&links, &n, "list", false, &mut |payload| {
            assert_eq!(payload["marker"], first.marker);
            assert_eq!(payload["recover"], true);
            Ok(json!({"identifier": "recovered"}))
        })
        .unwrap();
        n.frontmatter.insert("reminder".into(), json!("none"));
        assert!(sync_one(&links, &n, "list", false, &mut |_| Err("offline".into())).is_err());
        assert_eq!(links.get("a.md").unwrap().unwrap().identifier, "recovered");
        sync_one(&links, &n, "list", false, &mut |_| Ok(json!({}))).unwrap();
        assert!(links.get("a.md").unwrap().is_none());
    }

    #[test]
    fn reconciliation_keeps_invalid_notes_and_other_vaults_and_cleans_only_missing_owned_items() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("links.db");
        let vault = Vault::new(dir.path().join("vault")).unwrap();
        let other = Vault::new(dir.path().join("other")).unwrap();
        let links = Links::open(&db, &vault).unwrap();
        let other_links = Links::open(&db, &other).unwrap();
        links.ensure("missing.md").unwrap();
        links.ensure("invalid.md").unwrap();
        other_links.ensure("missing.md").unwrap();
        let invalid = note(vault.root(), "invalid.md", "reminder: [unsupported]");
        let completed = note(vault.root(), "old.md", "status: done");
        let mut calls = vec![];
        let report = reconcile(&links, &[invalid, completed], "list", &mut |payload| {
            calls.push(payload);
            Ok(json!({}))
        })
        .unwrap();
        assert_eq!(report.updated, 1);
        assert_eq!(report.errors.len(), 1);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["operation"], "remove");
        assert!(links.get("invalid.md").unwrap().is_some());
        assert!(links.get("old.md").unwrap().is_none());
        assert!(other_links.get("missing.md").unwrap().is_some());
    }
}
