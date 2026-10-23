//! Two-way, opt-in synchronization of committed note tasks to Apple Reminders.
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
pub async fn sync_reminders(
    app: AppHandle,
    vault_root: String,
    linked_only: Option<bool>,
) -> Result<SyncReport, String> {
    on_worker(move || sync_reminders_impl(app, vault_root, linked_only.unwrap_or(false))).await
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
    baseline_json: Option<String>,
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
            identifier TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL DEFAULT '', baseline_json TEXT,
            PRIMARY KEY (vault, path)
        )",
        )
        .map_err(|e| e.to_string())?;
        let columns = {
            let mut statement = conn
                .prepare("PRAGMA table_info(reminder_links)")
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|error| error.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?
        };
        if !columns.iter().any(|name| name == "baseline_json") {
            conn.execute(
                "ALTER TABLE reminder_links ADD COLUMN baseline_json TEXT",
                [],
            )
            .map_err(|error| error.to_string())?;
        }
        Ok(Self {
            conn,
            vault: vault.root().to_string_lossy().into_owned(),
        })
    }

    fn get(&self, path: &str) -> Result<Option<Link>, String> {
        self.conn.query_row("SELECT path, marker, identifier, fingerprint, baseline_json FROM reminder_links WHERE vault=?1 AND path=?2",
            params![self.vault, path], |row| Ok(Link { path: row.get(0)?, marker: row.get(1)?, identifier: row.get(2)?, fingerprint: row.get(3)?, baseline_json: row.get(4)? }))
            .optional().map_err(|e| e.to_string())
    }

    fn all(&self) -> Result<Vec<Link>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT path, marker, identifier, fingerprint, baseline_json FROM reminder_links WHERE vault=?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&self.vault], |row| {
                Ok(Link {
                    path: row.get(0)?,
                    marker: row.get(1)?,
                    identifier: row.get(2)?,
                    fingerprint: row.get(3)?,
                    baseline_json: row.get(4)?,
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

#[cfg(test)]
fn task(note: &NoteMetadata, calendar_id: &str) -> Result<Option<Value>, String> {
    task_payload(note, calendar_id, false)
}

fn task_payload(
    note: &NoteMetadata,
    calendar_id: &str,
    allow_undated: bool,
) -> Result<Option<Value>, String> {
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
    let due = note
        .due
        .as_deref()
        .filter(|due| !due.is_empty())
        .map(due_timestamp)
        .transpose()?;
    if due.is_none() && !allow_undated {
        return Ok(None);
    }
    let (timestamp, all_day) = due.unwrap_or((0, false));
    let completed = note.status.as_deref() == Some("done");
    Ok(Some(json!({
        "operation": "upsert", "calendarId": calendar_id, "title": note.title,
        "dueTimestamp": due.map(|value| value.0), "allDay": all_day, "alarmTimestamp": if completed || due.is_none() { None } else { Some(timestamp - offset) },
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
    let Some(mut payload) = task_payload(note, calendar, existing.is_some())? else {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedFields {
    due: Option<String>,
    completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteState {
    #[serde(flatten)]
    fields: SharedFields,
    identifier: String,
    modified_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Baseline {
    fields: SharedFields,
    open_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    path: String,
    fields: Vec<String>,
    local: SharedFields,
    local_revision: String,
    remote: RemoteState,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictChoice {
    Local,
    Remote,
}

#[derive(Debug, Deserialize)]
pub struct ConflictResolution {
    conflict: SyncConflict,
    choice: ConflictChoice,
}

pub fn install_change_observer(app: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
        extern "C" fn changed() {
            use tauri::Emitter;
            if let Some(app) = APP.get() {
                let _ = app.emit("reminders://changed", ());
            }
        }
        unsafe extern "C" {
            fn inote_reminders_set_change_callback(callback: extern "C" fn());
        }
        if APP.set(app).is_ok() {
            unsafe { inote_reminders_set_change_callback(changed) };
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

fn canonical_due(due: Option<&str>) -> Result<Option<String>, String> {
    due.filter(|due| !due.is_empty())
        .map(|due| {
            let (timestamp, all_day) = due_timestamp(due)?;
            let date = Local
                .timestamp_opt(timestamp, 0)
                .single()
                .ok_or("Invalid due date timestamp.")?;
            Ok(date
                .format(if all_day {
                    "%Y-%m-%d"
                } else {
                    "%Y-%m-%dT%H:%M:%S"
                })
                .to_string())
        })
        .transpose()
}

fn local_fields(note: &NoteMetadata) -> Result<SharedFields, String> {
    Ok(SharedFields {
        due: canonical_due(note.due.as_deref())?,
        completed: note.status.as_deref() == Some("done"),
    })
}

fn merge_field<T: PartialEq + Clone>(
    base: Option<&T>,
    local: &T,
    remote: &T,
    choice: Option<ConflictChoice>,
) -> Result<T, ()> {
    if local == remote || base == Some(remote) {
        return Ok(local.clone());
    }
    if base == Some(local) {
        return Ok(remote.clone());
    }
    match choice {
        Some(ConflictChoice::Local) => Ok(local.clone()),
        Some(ConflictChoice::Remote) => Ok(remote.clone()),
        None => Err(()),
    }
}

fn merge_fields(
    base: Option<&SharedFields>,
    local: &SharedFields,
    remote: &SharedFields,
    choice: Option<ConflictChoice>,
) -> Result<SharedFields, Vec<String>> {
    let due = merge_field(base.map(|base| &base.due), &local.due, &remote.due, choice);
    let completed = merge_field(
        base.map(|base| &base.completed),
        &local.completed,
        &remote.completed,
        choice,
    );
    let mut conflicts = Vec::new();
    if due.is_err() {
        conflicts.push("due".into());
    }
    if completed.is_err() {
        conflicts.push("completed".into());
    }
    if conflicts.is_empty() {
        Ok(SharedFields {
            due: due.unwrap(),
            completed: completed.unwrap(),
        })
    } else {
        Err(conflicts)
    }
}

fn remember(links: &Links, path: &str, baseline: &Baseline) -> Result<(), String> {
    links
        .conn
        .execute(
            "UPDATE reminder_links SET baseline_json=?1 WHERE vault=?2 AND path=?3",
            params![
                serde_json::to_string(baseline).map_err(|error| error.to_string())?,
                links.vault,
                path
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn read_remote(
    link: &Link,
    backend: &mut impl FnMut(Value) -> Result<Value, String>,
) -> Result<Option<RemoteState>, String> {
    let value = backend(
        json!({"operation": "read", "marker": link.marker, "identifier": link.identifier}),
    )?;
    if value["missing"] == true {
        return Ok(None);
    }
    let mut remote: RemoteState = serde_json::from_value(value)
        .map_err(|error| format!("Invalid system reminder: {error}"))?;
    remote.fields.due = canonical_due(remote.fields.due.as_deref())?;
    Ok(Some(remote))
}

fn apply_fields(
    vault: &Vault,
    note: &NoteMetadata,
    desired: &SharedFields,
    open_status: &str,
) -> Result<Option<NoteMetadata>, String> {
    let current = local_fields(note)?;
    let mut fields = Vec::new();
    if current.due != desired.due {
        fields.push(("due", desired.due.clone()));
    }
    if current.completed != desired.completed {
        fields.push((
            "status",
            Some(
                if desired.completed {
                    "done"
                } else {
                    open_status
                }
                .to_string(),
            ),
        ));
    } else if desired.due.is_none() && note.status.as_deref().unwrap_or("").is_empty() {
        fields.push(("status", Some("todo".to_string())));
    }
    if fields.is_empty() {
        return Ok(None);
    }
    let source = vault.read_note_source(&note.path)?;
    if crate::markdown::source_revision(&source) != note.source_revision {
        return Err("The note changed during sync. Retry to merge the latest version.".into());
    }
    let content = crate::reminder_markdown::patch(&source, &fields)?;
    crate::persistence::commit_note_change(crate::persistence::NoteCommitInput {
        vault_root: vault.root().to_string_lossy().into_owned(),
        path: note.path.clone(),
        target_path: None,
        content,
        expected_revision: Some(note.source_revision.clone()),
        create: false,
        agent: None,
        source_check: None,
        content_path: None,
        undo_snapshot_id: None,
    })
    .map(Some)
}

#[derive(Debug, Default)]
struct PairOutcome {
    updated: usize,
    note: Option<NoteMetadata>,
    conflict: Option<SyncConflict>,
}

fn collect_outcome(report: &mut SyncReport, outcome: PairOutcome) {
    report.updated += outcome.updated;
    if let Some(note) = outcome.note {
        report.notes.push(note);
    }
    if let Some(conflict) = outcome.conflict {
        report.conflicts.push(conflict);
    }
}

fn sync_pair(
    links: &Links,
    vault: &Vault,
    note: &NoteMetadata,
    calendar: &str,
    resolution: Option<&ConflictResolution>,
    backend: &mut impl FnMut(Value) -> Result<Value, String>,
) -> Result<PairOutcome, String> {
    let existing = links.get(&note.path)?;
    let payload = task_payload(note, calendar, existing.is_some())?;
    if payload.is_none() || (existing.is_none() && note.status.as_deref() == Some("done")) {
        return Ok(PairOutcome {
            updated: sync_one(links, note, calendar, false, backend)?,
            ..Default::default()
        });
    }
    let local = local_fields(note)?;
    let mut baseline = existing
        .as_ref()
        .and_then(|link| link.baseline_json.as_deref())
        .map(serde_json::from_str::<Baseline>)
        .transpose()
        .map_err(|error| error.to_string())?;
    // Migrate the old one-way cache without overwriting system changes made since its last push.
    if baseline.is_none()
        && existing.as_ref().is_some_and(|link| {
            link.fingerprint
                == crate::markdown::source_revision(&payload.as_ref().unwrap().to_string())
        })
    {
        baseline = Some(Baseline {
            fields: local.clone(),
            open_status: note
                .status
                .clone()
                .filter(|status| status != "done")
                .unwrap_or_else(|| "todo".into()),
        });
    }
    let remote = existing
        .as_ref()
        .map(|link| read_remote(link, backend))
        .transpose()?
        .flatten();
    if let Some(resolution) = resolution {
        if note.source_revision != resolution.conflict.local_revision
            || remote.as_ref() != Some(&resolution.conflict.remote)
        {
            return Err("The note or system reminder changed since this conflict was shown. Sync again before choosing a version.".into());
        }
    }
    let open_status = note
        .status
        .as_deref()
        .filter(|status| !status.is_empty() && *status != "done")
        .map(str::to_string)
        .or_else(|| baseline.as_ref().map(|base| base.open_status.clone()))
        .unwrap_or_else(|| "todo".into());
    let desired = if let Some(remote) = &remote {
        match merge_fields(
            baseline.as_ref().map(|base| &base.fields),
            &local,
            &remote.fields,
            resolution.map(|resolution| resolution.choice),
        ) {
            Ok(desired) => desired,
            Err(fields) => {
                return Ok(PairOutcome {
                    conflict: Some(SyncConflict {
                        path: note.path.clone(),
                        fields,
                        local,
                        local_revision: note.source_revision.clone(),
                        remote: remote.clone(),
                    }),
                    ..Default::default()
                })
            }
        }
    } else {
        local.clone()
    };
    let changed = apply_fields(vault, note, &desired, &open_status)?;
    let merged = changed.as_ref().unwrap_or(note);
    // Record only fields already shared with the observed remote version. Pending local
    // changes retain their old baseline if a later native write fails.
    if let (Some(link), Some(remote), Some(base)) = (&existing, &remote, &baseline) {
        let common = SharedFields {
            due: if desired.due == remote.fields.due {
                desired.due.clone()
            } else {
                base.fields.due.clone()
            },
            completed: if desired.completed == remote.fields.completed {
                desired.completed
            } else {
                base.fields.completed
            },
        };
        remember(
            links,
            &link.path,
            &Baseline {
                fields: common,
                open_status: open_status.clone(),
            },
        )?;
    }
    let force = remote
        .as_ref()
        .is_some_and(|remote| remote.fields != desired)
        || (existing.is_some() && remote.is_none());
    let expected = remote
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|error| error.to_string())?;
    let mut guarded_backend = |mut payload: Value| {
        if payload["operation"] == "upsert" {
            if let Some(expected) = &expected {
                payload["expectedRemote"] = expected.clone();
            } else {
                payload["expectedMissing"] = json!(true);
            }
        }
        backend(payload)
    };
    let pushed = sync_one(links, merged, calendar, force, &mut guarded_backend)?;
    remember(
        links,
        &merged.path,
        &Baseline {
            fields: desired,
            open_status,
        },
    )?;
    Ok(PairOutcome {
        updated: pushed + usize::from(changed.is_some()),
        note: changed,
        conflict: None,
    })
}

#[tauri::command]
pub async fn resolve_reminder_conflict(
    app: AppHandle,
    vault_root: String,
    resolution: ConflictResolution,
) -> Result<SyncReport, String> {
    on_worker(move || {
        let _guard = SYNC_LOCK.lock().map_err(|error| error.to_string())?;
        let db = crate::commands::settings_db_path(&app)?;
        let config = settings(&db)?;
        if !config.supported || !config.enabled {
            return Err("Enable Reminders sync before resolving a conflict.".into());
        }
        let vault = Vault::new(vault_root)?;
        let note = vault.read_note(&resolution.conflict.path)?;
        let links = Links::open(&db.with_file_name("reminders.sqlite3"), &vault)?;
        if links.get(&note.path)?.is_none() {
            return Err("This task is no longer linked to a system reminder.".into());
        }
        let mut report = SyncReport::default();
        collect_outcome(
            &mut report,
            sync_pair(
                &links,
                &vault,
                &note,
                &config.calendar_id,
                Some(&resolution),
                &mut native,
            )?,
        );
        Ok(report)
    })
    .await
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub updated: usize,
    pub errors: Vec<String>,
    pub conflicts: Vec<SyncConflict>,
    pub notes: Vec<NoteMetadata>,
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
    let mut report = SyncReport::default();
    if let Some(path) = path {
        vault.note_path(&path)?;
        links.rename(&old_path, &path, &mut native)?;
        collect_outcome(
            &mut report,
            sync_pair(
                &links,
                &vault,
                &vault.read_note(&path)?,
                &config.calendar_id,
                None,
                &mut native,
            )?,
        );
    } else if let Some(link) = links.get(&old_path)? {
        links.remove(&link, &mut native)?;
        report.updated += 1;
    }
    Ok(report)
}

fn sync_reminders_impl(
    app: AppHandle,
    vault_root: String,
    linked_only: bool,
) -> Result<SyncReport, String> {
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
    let links = Links::open(&db.with_file_name("reminders.sqlite3"), &vault)?;
    let notes = {
        let _guard = crate::persistence::mutation_lock()?;
        if linked_only {
            // System notifications and periodic checks only visit already linked tasks.
            let mut notes = Vec::new();
            for link in links.all()? {
                if vault
                    .note_path(&link.path)?
                    .try_exists()
                    .map_err(|error| error.to_string())?
                {
                    notes.push(vault.read_note(&link.path)?);
                }
            }
            notes
        } else {
            vault.scan()?
        }
    };
    reconcile(&links, &vault, &notes, &config.calendar_id, &mut native)
}

fn reconcile(
    links: &Links,
    vault: &Vault,
    notes: &[NoteMetadata],
    calendar: &str,
    backend: &mut impl FnMut(Value) -> Result<Value, String>,
) -> Result<SyncReport, String> {
    let mut report = SyncReport::default();
    let present: HashSet<_> = notes.iter().map(|note| note.path.as_str()).collect();
    for note in notes {
        match sync_pair(links, vault, note, calendar, None, backend) {
            Ok(outcome) => collect_outcome(&mut report, outcome),
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
        let report = reconcile(
            &links,
            &vault,
            &[invalid, completed],
            "list",
            &mut |payload| {
                calls.push(payload);
                Ok(json!({}))
            },
        )
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

#[cfg(test)]
mod bidirectional_tests {
    use super::*;
    use std::collections::HashMap;
    use tempfile::{tempdir, TempDir};

    #[derive(Default)]
    struct System {
        items: HashMap<String, RemoteState>,
        writes: usize,
        fail_push: bool,
        concurrent_due: Option<String>,
    }
    impl System {
        fn call(&mut self, payload: Value) -> Result<Value, String> {
            let marker = payload["marker"].as_str().unwrap().to_string();
            match payload["operation"].as_str().unwrap() {
                "read" => Ok(self
                    .items
                    .get(&marker)
                    .map(|state| serde_json::to_value(state).unwrap())
                    .unwrap_or(json!({"missing": true}))),
                "remove" => {
                    self.items.remove(&marker);
                    self.writes += 1;
                    Ok(json!({}))
                }
                "upsert" => {
                    if let Some(due) = self.concurrent_due.take() {
                        let item = self.items.get_mut(&marker).unwrap();
                        item.fields.due = Some(due);
                        item.modified_at += 1;
                    }
                    if self.fail_push {
                        self.fail_push = false;
                        return Err("native write failed".into());
                    }
                    if let Some(expected) = payload.get("expectedRemote") {
                        if self
                            .items
                            .get(&marker)
                            .map(|item| serde_json::to_value(item).unwrap())
                            .as_ref()
                            != Some(expected)
                        {
                            return Err("remote version changed".into());
                        }
                    } else if payload["expectedMissing"] == true && self.items.contains_key(&marker)
                    {
                        return Err("remote already exists".into());
                    }
                    let due = payload["dueTimestamp"].as_i64().map(|timestamp| {
                        Local
                            .timestamp_opt(timestamp, 0)
                            .single()
                            .unwrap()
                            .format(if payload["allDay"] == true {
                                "%Y-%m-%d"
                            } else {
                                "%Y-%m-%dT%H:%M:%S"
                            })
                            .to_string()
                    });
                    let state = RemoteState {
                        fields: SharedFields {
                            due,
                            completed: payload["completed"].as_bool().unwrap(),
                        },
                        identifier: "system-id".into(),
                        modified_at: self
                            .items
                            .get(&marker)
                            .map_or(1, |item| item.modified_at + 1),
                    };
                    self.items.insert(marker, state.clone());
                    self.writes += 1;
                    Ok(serde_json::to_value(state).unwrap())
                }
                operation => panic!("unexpected operation: {operation}"),
            }
        }
        fn edit(&mut self, links: &Links, due: Option<&str>, completed: bool) {
            let marker = links.get("task.md").unwrap().unwrap().marker;
            let item = self.items.get_mut(&marker).unwrap();
            item.fields = SharedFields {
                due: due.map(str::to_string),
                completed,
            };
            item.modified_at += 1;
        }
    }

    fn fixture() -> (TempDir, Vault, Links, System) {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path().join("vault")).unwrap();
        vault.write_note("task.md", "---\n# Keep comment\ntitle: 测试任务\ndue: 2030-10-23T14:30 # original date\nstatus: in_progress\ncustom: {owner: 张三, values: [one, two]}\n---\n\n# 正文\n- [ ] Keep this checkbox\n").unwrap();
        let links = Links::open(&dir.path().join("links.db"), &vault).unwrap();
        (dir, vault, links, System::default())
    }
    fn run(vault: &Vault, links: &Links, system: &mut System) -> Result<PairOutcome, String> {
        sync_pair(
            links,
            vault,
            &vault.read_note("task.md")?,
            "list",
            None,
            &mut |payload| system.call(payload),
        )
    }
    fn change_local_date(vault: &Vault, value: &str) {
        let source = vault
            .read_note_source("task.md")
            .unwrap()
            .replace("2030-10-23T14:30", value);
        vault.write_note("task.md", &source).unwrap();
    }

    #[test]
    fn pulls_system_date_completion_and_reopening_without_echo_writes() {
        let (_dir, vault, links, mut system) = fixture();
        run(&vault, &links, &mut system).unwrap();
        assert_eq!(system.writes, 1);
        assert_eq!(run(&vault, &links, &mut system).unwrap().updated, 0);
        system.edit(&links, Some("2030-11-24T09:15:00"), true);
        let outcome = run(&vault, &links, &mut system).unwrap();
        let note = outcome.note.unwrap();
        assert_eq!(note.due.as_deref(), Some("2030-11-24T09:15:00"));
        assert_eq!(note.status.as_deref(), Some("done"));
        let source = vault.read_note_source("task.md").unwrap();
        assert!(source.contains("# Keep comment"));
        assert!(source.contains("# original date"));
        assert!(source.contains("custom: {owner: 张三, values: [one, two]}"));
        assert!(source.ends_with("# 正文\n- [ ] Keep this checkbox\n"));
        let writes = system.writes;
        run(&vault, &links, &mut system).unwrap();
        assert_eq!(system.writes, writes);
        system.edit(&links, Some("2030-11-24T09:15:00"), false);
        run(&vault, &links, &mut system).unwrap();
        assert_eq!(
            vault.read_note("task.md").unwrap().status.as_deref(),
            Some("in_progress")
        );
        let index =
            crate::indexer::NoteIndex::open(vault.safe_path(".inote/index.sqlite3").unwrap())
                .unwrap();
        assert_eq!(
            index.get_all_notes().unwrap()[0].due.as_deref(),
            Some("2030-11-24T09:15:00")
        );
    }

    #[test]
    fn merges_local_date_and_remote_completion_independently() {
        let (_dir, vault, links, mut system) = fixture();
        run(&vault, &links, &mut system).unwrap();
        change_local_date(&vault, "2030-10-25T16:00");
        system.edit(&links, Some("2030-10-23T14:30:00"), true);
        let outcome = run(&vault, &links, &mut system).unwrap();
        assert!(outcome.conflict.is_none());
        let note = vault.read_note("task.md").unwrap();
        assert_eq!(note.due.as_deref(), Some("2030-10-25T16:00"));
        assert_eq!(note.status.as_deref(), Some("done"));
        let state = system.items.values().next().unwrap();
        assert_eq!(state.fields.due.as_deref(), Some("2030-10-25T16:00:00"));
        assert!(state.fields.completed);
    }

    #[test]
    fn conflicting_dates_remain_unchanged_until_either_version_is_chosen() {
        for choice in [ConflictChoice::Local, ConflictChoice::Remote] {
            let (_dir, vault, links, mut system) = fixture();
            run(&vault, &links, &mut system).unwrap();
            change_local_date(&vault, "2030-10-25T16:00");
            system.edit(&links, Some("2030-11-01T08:00:00"), false);
            let before = vault.read_note_source("task.md").unwrap();
            let conflict = run(&vault, &links, &mut system).unwrap().conflict.unwrap();
            assert_eq!(conflict.fields, vec!["due"]);
            assert_eq!(vault.read_note_source("task.md").unwrap(), before);
            assert_eq!(system.writes, 1);
            let resolution = ConflictResolution { conflict, choice };
            let note = vault.read_note("task.md").unwrap();
            let outcome = sync_pair(
                &links,
                &vault,
                &note,
                "list",
                Some(&resolution),
                &mut |payload| system.call(payload),
            )
            .unwrap();
            assert!(outcome.conflict.is_none());
            let fields = local_fields(&vault.read_note("task.md").unwrap()).unwrap();
            assert_eq!(fields, system.items.values().next().unwrap().fields);
            assert_eq!(
                fields.due.as_deref(),
                Some(match choice {
                    ConflictChoice::Local => "2030-10-25T16:00:00",
                    ConflictChoice::Remote => "2030-11-01T08:00:00",
                })
            );
        }
    }

    #[test]
    fn refuses_stale_conflict_choices_and_concurrent_local_edits() {
        let (_dir, vault, links, mut system) = fixture();
        run(&vault, &links, &mut system).unwrap();
        change_local_date(&vault, "2030-10-25T16:00");
        system.edit(&links, Some("2030-11-01T08:00:00"), false);
        let conflict = run(&vault, &links, &mut system).unwrap().conflict.unwrap();
        system.edit(&links, Some("2030-11-02T08:00:00"), false);
        let resolution = ConflictResolution {
            conflict,
            choice: ConflictChoice::Local,
        };
        assert!(sync_pair(
            &links,
            &vault,
            &vault.read_note("task.md").unwrap(),
            "list",
            Some(&resolution),
            &mut |payload| system.call(payload)
        )
        .unwrap_err()
        .contains("changed since"));
        let stale = vault.read_note("task.md").unwrap();
        let source = vault.read_note_source("task.md").unwrap() + "New external body edit\n";
        vault.write_note("task.md", &source).unwrap();
        let desired = SharedFields {
            due: Some("2031-01-01".into()),
            completed: true,
        };
        assert!(apply_fields(&vault, &stale, &desired, "todo").is_err());
        assert_eq!(vault.read_note_source("task.md").unwrap(), source);
    }

    #[test]
    fn remote_date_removal_keeps_the_task_and_its_completion_sync() {
        let (_dir, vault, links, mut system) = fixture();
        run(&vault, &links, &mut system).unwrap();
        system.edit(&links, None, false);
        run(&vault, &links, &mut system).unwrap();
        assert!(vault.read_note("task.md").unwrap().due.is_none());
        assert!(links.get("task.md").unwrap().is_some());
        assert_eq!(system.items.len(), 1);
        system.edit(&links, None, true);
        run(&vault, &links, &mut system).unwrap();
        assert_eq!(
            vault.read_note("task.md").unwrap().status.as_deref(),
            Some("done")
        );
    }

    #[test]
    fn imports_date_only_reminders_without_adding_an_unrequested_time() {
        let (_dir, vault, links, mut system) = fixture();
        run(&vault, &links, &mut system).unwrap();
        system.edit(&links, Some("2030-11-01"), false);
        let outcome = run(&vault, &links, &mut system).unwrap();
        assert_eq!(outcome.note.unwrap().due.as_deref(), Some("2030-11-01"));
        assert_eq!(
            system.items.values().next().unwrap().fields.due.as_deref(),
            Some("2030-11-01")
        );
    }

    #[test]
    fn failed_push_keeps_pending_local_changes_and_successfully_imported_fields() {
        let (_dir, vault, links, mut system) = fixture();
        run(&vault, &links, &mut system).unwrap();
        change_local_date(&vault, "2030-10-25T16:00");
        system.edit(&links, Some("2030-10-23T14:30:00"), true);
        system.fail_push = true;
        assert!(run(&vault, &links, &mut system).is_err());
        assert_eq!(
            vault.read_note("task.md").unwrap().status.as_deref(),
            Some("done")
        );
        let outcome = run(&vault, &links, &mut system).unwrap();
        assert!(outcome.conflict.is_none());
        assert_eq!(
            system.items.values().next().unwrap().fields.due.as_deref(),
            Some("2030-10-25T16:00:00")
        );
    }

    #[test]
    fn concurrent_remote_changes_are_retried_without_overwriting_them_or_creating_false_conflicts()
    {
        let (_dir, vault, links, mut system) = fixture();
        run(&vault, &links, &mut system).unwrap();
        system.edit(&links, Some("2030-11-01T08:00:00"), false);
        system.concurrent_due = Some("2030-11-02T08:00:00".into());
        assert!(run(&vault, &links, &mut system)
            .unwrap_err()
            .contains("remote version"));
        let outcome = run(&vault, &links, &mut system).unwrap();
        assert!(outcome.conflict.is_none());
        assert_eq!(
            vault.read_note("task.md").unwrap().due.as_deref(),
            Some("2030-11-02T08:00:00")
        );
    }

    #[test]
    fn migrates_the_previous_one_way_table_and_imports_changes_since_its_last_push() {
        let (dir, vault, links, mut system) = fixture();
        let note = vault.read_note("task.md").unwrap();
        sync_one(&links, &note, "list", false, &mut |payload| {
            system.call(payload)
        })
        .unwrap();
        let row = links.get("task.md").unwrap().unwrap();
        let legacy = dir.path().join("legacy.db");
        let conn = Connection::open(&legacy).unwrap();
        conn.execute_batch("CREATE TABLE reminder_links (vault TEXT, path TEXT, marker TEXT UNIQUE, identifier TEXT, fingerprint TEXT, PRIMARY KEY(vault, path))").unwrap();
        conn.execute(
            "INSERT INTO reminder_links VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                links.vault,
                row.path,
                row.marker,
                row.identifier,
                row.fingerprint
            ],
        )
        .unwrap();
        drop(conn);
        let migrated = Links::open(&legacy, &vault).unwrap();
        system.edit(&migrated, Some("2030-11-01T08:00:00"), true);
        let outcome = run(&vault, &migrated, &mut system).unwrap();
        assert!(outcome.conflict.is_none());
        assert_eq!(
            vault.read_note("task.md").unwrap().status.as_deref(),
            Some("done")
        );
        assert!(migrated
            .get("task.md")
            .unwrap()
            .unwrap()
            .baseline_json
            .is_some());
        assert_eq!(system.items.len(), 1);
    }
}
