# Stateful Note Agent Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin vertical slice of a stateful Note Agent workbench with per-note persisted sessions, grouped review plans, reviewed apply, and undo for the last current-note agent apply.

**Architecture:** Store per-note agent sessions in `<vault>/.inote/agent.sqlite3` through a focused Rust `AgentSessionStore`. Keep LLM operation parsing in `src/features/agent`, add pure TypeScript review/session helpers, and keep all note writes in `App.tsx`. The UI becomes a right-sidebar workbench that loads the active note session, runs turns with staged progress, previews grouped changes, records applied events, and restores the last current-note snapshot on undo.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri 2, Rust, rusqlite, existing vault APIs, existing OpenAI-compatible LLM plumbing, lucide-react, DaisyUI/Tailwind utility classes.

---

## File Structure

- Create `src-tauri/src/agent_session.rs`
  Owns the SQLite schema, serializable Rust data types, session loading, turn recording, operation event recording, undo snapshot storage, and retention cleanup.

- Modify `src-tauri/src/commands.rs`
  Adds Tauri command input types and command functions that open `<vault>/.inote/agent.sqlite3` through `AgentSessionStore`.

- Modify `src-tauri/src/lib.rs`
  Registers the new module and commands.

- Modify `src/shared/types.ts`
  Adds TypeScript session, turn, event, undo snapshot, and review plan types shared by the app and agent feature.

- Modify `src/shared/api.ts`
  Adds frontend wrappers for the new Tauri agent-session commands.

- Create `src/features/agent/agentReviewPlan.ts`
  Builds a grouped, UI-ready `ReviewPlan` from the active note and parsed `AgentResult`.

- Create `src/features/agent/agentReviewPlan.test.ts`
  Tests metadata before/after rows, body append/replace groups, create-note groups, suggestion groups, and risk flags.

- Create `src/features/agent/agentSessionSummary.ts`
  Builds compact session context for prompts from recent turns and operation events.

- Create `src/features/agent/agentSessionSummary.test.ts`
  Tests summary truncation and that raw responses are not copied wholesale into prompt context.

- Modify `src/features/agent/agentPrompts.ts`
  Accepts optional session summary and includes it in context before the current note body.

- Modify `src/features/agent/agentPrompts.test.ts`
  Covers session summary inclusion and existing JSON-only instructions.

- Modify `src/features/agent/applyAgentOperations.ts`
  Adds filtering for selected review groups and exposes helpers needed by `App.tsx` to apply selected operations.

- Modify `src/features/agent/applyAgentOperations.test.ts`
  Covers selected operation filtering and existing current-note operation behavior.

- Modify `src/features/agent/NoteAgent.tsx`
  Refactors the sidebar into a workbench with timeline, running stages, review plan, composer, apply selected, discard, and undo last apply.

- Modify `src/app/App.tsx`
  Wires session command callbacks, shared save/move behavior for agent apply, operation event recording, undo snapshot creation, and undo restore.

- Modify `src/app/noteAgentIntegration.test.ts`
  Extends static integration checks for the new workbench wiring and the shared save helper.

- Modify `src/app/styles.css`
  Adds compact workbench styles for timeline, stages, review groups, risk warnings, and undo footer while preserving the existing DaisyUI look.

---

### Task 1: Rust Agent Session Store

**Files:**
- Create: `src-tauri/src/agent_session.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/agent_session.rs`

- [ ] **Step 1: Write failing store tests**

Create `src-tauri/src/agent_session.rs` with the public types and tests first. The implementation methods can return `Err("not implemented".to_string())` in this step so the tests compile and fail on behavior.

```rust
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

const DEFAULT_TURN_RETENTION: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub note_path: String,
    pub note_title: String,
    pub created_at: String,
    pub updated_at: String,
    pub turns: Vec<AgentTurn>,
    pub operation_events: Vec<AgentOperationEvent>,
    pub last_undo_snapshot: Option<AgentUndoSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurn {
    pub id: String,
    pub session_id: String,
    pub note_path: String,
    pub command: String,
    pub action: Option<String>,
    pub prompt: String,
    pub context_summary: String,
    pub raw_response: String,
    pub parsed_result_json: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentOperationEvent {
    pub id: String,
    pub session_id: String,
    pub turn_id: String,
    pub note_path: String,
    pub operation_types: Vec<String>,
    pub changed_fields: Vec<String>,
    pub created_note_path: Option<String>,
    pub applied_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentUndoSnapshot {
    pub id: String,
    pub session_id: String,
    pub event_id: String,
    pub note_path: String,
    pub note_before_markdown: String,
    pub note_before_path: String,
    pub active_path_after_apply: String,
    pub created_note_path: Option<String>,
    pub created_at: String,
}

pub struct AgentSessionStore {
    conn: Connection,
}

impl AgentSessionStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create agent session folder: {error}"))?;
        }
        let conn = Connection::open(path)
            .map_err(|error| format!("failed to open agent session store: {error}"))?;
        let store = Self { conn };
        store.create_schema()?;
        Ok(store)
    }

    fn create_schema(&self) -> Result<(), String> {
        Err("not implemented".to_string())
    }

    pub fn load_session(&self, note_path: &str) -> Result<Option<AgentSession>, String> {
        let _ = note_path;
        Err("not implemented".to_string())
    }

    pub fn upsert_session(&self, id: &str, note_path: &str, note_title: &str, now: &str) -> Result<(), String> {
        let _ = (id, note_path, note_title, now);
        Err("not implemented".to_string())
    }

    pub fn update_session_note_target(&self, id: &str, note_path: &str, note_title: &str, now: &str) -> Result<(), String> {
        let _ = (id, note_path, note_title, now);
        Err("not implemented".to_string())
    }

    pub fn record_turn(&self, turn: &AgentTurn) -> Result<(), String> {
        let _ = turn;
        Err("not implemented".to_string())
    }

    pub fn record_operation_event(&self, event: &AgentOperationEvent) -> Result<(), String> {
        let _ = event;
        Err("not implemented".to_string())
    }

    pub fn store_undo_snapshot(&self, snapshot: &AgentUndoSnapshot) -> Result<(), String> {
        let _ = snapshot;
        Err("not implemented".to_string())
    }

    pub fn load_last_undo_snapshot(&self, note_path: &str) -> Result<Option<AgentUndoSnapshot>, String> {
        let _ = note_path;
        Err("not implemented".to_string())
    }

    pub fn clear_last_undo_snapshot(&self, note_path: &str) -> Result<(), String> {
        let _ = note_path;
        Err("not implemented".to_string())
    }

    pub fn enforce_turn_retention(&self, session_id: &str, keep: usize) -> Result<(), String> {
        let _ = (session_id, keep);
        Err("not implemented".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> AgentSessionStore {
        let dir = tempfile::tempdir().unwrap();
        AgentSessionStore::open(dir.path().join(".inote").join("agent.sqlite3")).unwrap()
    }

    fn sample_turn(id: &str, session_id: &str, note_path: &str, created_at: &str) -> AgentTurn {
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

    fn sample_event(session_id: &str, turn_id: &str, note_path: &str) -> AgentOperationEvent {
        AgentOperationEvent {
            id: "event-1".to_string(),
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            note_path: note_path.to_string(),
            operation_types: vec!["update_current_note".to_string()],
            changed_fields: vec!["summary".to_string(), "tags".to_string()],
            created_note_path: None,
            applied_at: "2026-06-20T10:00:00Z".to_string(),
        }
    }

    fn sample_snapshot(session_id: &str, event_id: &str, note_path: &str, body: &str) -> AgentUndoSnapshot {
        AgentUndoSnapshot {
            id: format!("snapshot-{body}"),
            session_id: session_id.to_string(),
            event_id: event_id.to_string(),
            note_path: note_path.to_string(),
            note_before_markdown: body.to_string(),
            note_before_path: note_path.to_string(),
            active_path_after_apply: note_path.to_string(),
            created_note_path: None,
            created_at: "2026-06-20T10:00:01Z".to_string(),
        }
    }

    #[test]
    fn loads_none_for_missing_session() {
        let store = store();
        assert_eq!(store.load_session("journal/missing.md").unwrap(), None);
    }

    #[test]
    fn round_trips_session_turn_event_and_snapshot() {
        let store = store();
        store.upsert_session("session-1", "journal/example.md", "Example", "2026-06-20T10:00:00Z").unwrap();
        let turn = sample_turn("turn-1", "session-1", "journal/example.md", "2026-06-20T10:00:00Z");
        store.record_turn(&turn).unwrap();
        let event = sample_event("session-1", "turn-1", "journal/example.md");
        store.record_operation_event(&event).unwrap();
        let snapshot = sample_snapshot("session-1", "event-1", "journal/example.md", "---\ntitle: Example\n---\n\nBefore");
        store.store_undo_snapshot(&snapshot).unwrap();

        let loaded = store.load_session("journal/example.md").unwrap().unwrap();
        assert_eq!(loaded.id, "session-1");
        assert_eq!(loaded.note_title, "Example");
        assert_eq!(loaded.turns, vec![turn]);
        assert_eq!(loaded.operation_events, vec![event]);
        assert_eq!(loaded.last_undo_snapshot, Some(snapshot));
    }

    #[test]
    fn keeps_only_latest_undo_snapshot_per_note() {
        let store = store();
        store.upsert_session("session-1", "journal/example.md", "Example", "2026-06-20T10:00:00Z").unwrap();
        let turn = sample_turn("turn-1", "session-1", "journal/example.md", "2026-06-20T10:00:00Z");
        store.record_turn(&turn).unwrap();
        let event = sample_event("session-1", "turn-1", "journal/example.md");
        store.record_operation_event(&event).unwrap();
        store.store_undo_snapshot(&sample_snapshot("session-1", "event-1", "journal/example.md", "first")).unwrap();
        store.store_undo_snapshot(&sample_snapshot("session-1", "event-1", "journal/example.md", "second")).unwrap();

        let snapshot = store.load_last_undo_snapshot("journal/example.md").unwrap().unwrap();
        assert_eq!(snapshot.note_before_markdown, "second");

        store.clear_last_undo_snapshot("journal/example.md").unwrap();
        assert_eq!(store.load_last_undo_snapshot("journal/example.md").unwrap(), None);
    }

    #[test]
    fn retention_keeps_latest_twenty_turns() {
        let store = store();
        store.upsert_session("session-1", "journal/example.md", "Example", "2026-06-20T10:00:00Z").unwrap();
        for i in 0..25 {
            let id = format!("turn-{i:02}");
            let created_at = format!("2026-06-20T10:{i:02}:00Z");
            store.record_turn(&sample_turn(&id, "session-1", "journal/example.md", &created_at)).unwrap();
        }
        store.enforce_turn_retention("session-1", DEFAULT_TURN_RETENTION).unwrap();

        let loaded = store.load_session("journal/example.md").unwrap().unwrap();
        assert_eq!(loaded.turns.len(), 20);
        assert_eq!(loaded.turns[0].id, "turn-05");
        assert_eq!(loaded.turns[19].id, "turn-24");
    }

    #[test]
    fn updates_session_note_path_after_agent_rename_or_move() {
        let store = store();
        store.upsert_session("session-1", "journal/example.md", "Example", "2026-06-20T10:00:00Z").unwrap();
        store
            .update_session_note_target("session-1", "projects/renamed.md", "Renamed", "2026-06-20T10:10:00Z")
            .unwrap();

        assert_eq!(store.load_session("journal/example.md").unwrap(), None);
        let loaded = store.load_session("projects/renamed.md").unwrap().unwrap();
        assert_eq!(loaded.id, "session-1");
        assert_eq!(loaded.note_title, "Renamed");
        assert_eq!(loaded.updated_at, "2026-06-20T10:10:00Z");
    }
}
```

- [ ] **Step 2: Register the module so the tests compile**

Modify `src-tauri/src/lib.rs` near the existing module declarations:

```rust
pub mod agent_session;
pub mod commands;
pub mod indexer;
pub mod llm;
pub mod markdown;
pub mod menu;
pub mod settings;
pub mod vault;
pub mod watcher;
```

- [ ] **Step 3: Run the failing tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_session
```

Expected: FAIL with `not implemented` errors from `create_schema` or the store methods.

- [ ] **Step 4: Implement schema and store methods**

Replace the stubbed methods in `src-tauri/src/agent_session.rs` with:

```rust
    fn create_schema(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS agent_sessions (
                  id TEXT PRIMARY KEY,
                  note_path TEXT NOT NULL,
                  note_title TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_agent_sessions_note_path
                ON agent_sessions(note_path);

                CREATE TABLE IF NOT EXISTS agent_turns (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  note_path TEXT NOT NULL,
                  command TEXT NOT NULL,
                  action TEXT,
                  prompt TEXT NOT NULL,
                  context_summary TEXT NOT NULL,
                  raw_response TEXT NOT NULL,
                  parsed_result_json TEXT,
                  status TEXT NOT NULL,
                  error TEXT,
                  created_at TEXT NOT NULL,
                  completed_at TEXT,
                  FOREIGN KEY(session_id) REFERENCES agent_sessions(id)
                );

                CREATE TABLE IF NOT EXISTS agent_operation_events (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  turn_id TEXT NOT NULL,
                  note_path TEXT NOT NULL,
                  operation_types_json TEXT NOT NULL,
                  changed_fields_json TEXT NOT NULL,
                  created_note_path TEXT,
                  applied_at TEXT NOT NULL,
                  FOREIGN KEY(session_id) REFERENCES agent_sessions(id),
                  FOREIGN KEY(turn_id) REFERENCES agent_turns(id)
                );

                CREATE TABLE IF NOT EXISTS agent_undo_snapshots (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  event_id TEXT NOT NULL,
                  note_path TEXT NOT NULL,
                  note_before_markdown TEXT NOT NULL,
                  note_before_path TEXT NOT NULL,
                  active_path_after_apply TEXT NOT NULL,
                  created_note_path TEXT,
                  created_at TEXT NOT NULL,
                  FOREIGN KEY(session_id) REFERENCES agent_sessions(id),
                  FOREIGN KEY(event_id) REFERENCES agent_operation_events(id)
                );
                CREATE INDEX IF NOT EXISTS idx_agent_undo_snapshots_note_path
                ON agent_undo_snapshots(note_path);
                ",
            )
            .map_err(|error| format!("failed to create agent session schema: {error}"))
    }

    pub fn load_session(&self, note_path: &str) -> Result<Option<AgentSession>, String> {
        let session_row = self.conn
            .query_row(
                "
                SELECT id, note_path, note_title, created_at, updated_at
                FROM agent_sessions
                WHERE note_path = ?1
                ORDER BY updated_at DESC
                LIMIT 1
                ",
                params![note_path],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("failed to load agent session: {error}"))?;

        let Some((id, note_path, note_title, created_at, updated_at)) = session_row else {
            return Ok(None);
        };

        let mut turn_stmt = self.conn
            .prepare(
                "
                SELECT id, session_id, note_path, command, action, prompt, context_summary,
                       raw_response, parsed_result_json, status, error, created_at, completed_at
                FROM agent_turns
                WHERE session_id = ?1
                ORDER BY created_at ASC
                ",
            )
            .map_err(|error| format!("failed to prepare agent turn query: {error}"))?;
        let turns = turn_stmt
            .query_map(params![&id], |row| {
                Ok(AgentTurn {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    note_path: row.get(2)?,
                    command: row.get(3)?,
                    action: row.get(4)?,
                    prompt: row.get(5)?,
                    context_summary: row.get(6)?,
                    raw_response: row.get(7)?,
                    parsed_result_json: row.get(8)?,
                    status: row.get(9)?,
                    error: row.get(10)?,
                    created_at: row.get(11)?,
                    completed_at: row.get(12)?,
                })
            })
            .map_err(|error| format!("failed to load agent turns: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to read agent turn row: {error}"))?;

        let mut event_stmt = self.conn
            .prepare(
                "
                SELECT id, session_id, turn_id, note_path, operation_types_json,
                       changed_fields_json, created_note_path, applied_at
                FROM agent_operation_events
                WHERE session_id = ?1
                ORDER BY applied_at ASC
                ",
            )
            .map_err(|error| format!("failed to prepare agent event query: {error}"))?;
        let operation_events = event_stmt
            .query_map(params![&id], |row| {
                let operation_types_json: String = row.get(4)?;
                let changed_fields_json: String = row.get(5)?;
                Ok(AgentOperationEvent {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    turn_id: row.get(2)?,
                    note_path: row.get(3)?,
                    operation_types: serde_json::from_str(&operation_types_json)
                        .unwrap_or_else(|_| Vec::new()),
                    changed_fields: serde_json::from_str(&changed_fields_json)
                        .unwrap_or_else(|_| Vec::new()),
                    created_note_path: row.get(6)?,
                    applied_at: row.get(7)?,
                })
            })
            .map_err(|error| format!("failed to load agent operation events: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to read agent event row: {error}"))?;

        Ok(Some(AgentSession {
            id,
            note_path: note_path.clone(),
            note_title,
            created_at,
            updated_at,
            turns,
            operation_events,
            last_undo_snapshot: self.load_last_undo_snapshot(&note_path)?,
        }))
    }

    pub fn upsert_session(&self, id: &str, note_path: &str, note_title: &str, now: &str) -> Result<(), String> {
        self.conn
            .execute(
                "
                INSERT INTO agent_sessions (id, note_path, note_title, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?4)
                ON CONFLICT(id) DO UPDATE SET
                  note_path = excluded.note_path,
                  note_title = excluded.note_title,
                  updated_at = excluded.updated_at
                ",
                params![id, note_path, note_title, now],
            )
            .map_err(|error| format!("failed to upsert agent session: {error}"))?;
        Ok(())
    }

    pub fn update_session_note_target(&self, id: &str, note_path: &str, note_title: &str, now: &str) -> Result<(), String> {
        self.conn
            .execute(
                "
                UPDATE agent_sessions
                SET note_path = ?2,
                    note_title = ?3,
                    updated_at = ?4
                WHERE id = ?1
                ",
                params![id, note_path, note_title, now],
            )
            .map_err(|error| format!("failed to update agent session note target: {error}"))?;
        Ok(())
    }

    pub fn record_turn(&self, turn: &AgentTurn) -> Result<(), String> {
        self.conn
            .execute(
                "
                INSERT INTO agent_turns (
                  id, session_id, note_path, command, action, prompt, context_summary,
                  raw_response, parsed_result_json, status, error, created_at, completed_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                ON CONFLICT(id) DO UPDATE SET
                  raw_response = excluded.raw_response,
                  parsed_result_json = excluded.parsed_result_json,
                  status = excluded.status,
                  error = excluded.error,
                  completed_at = excluded.completed_at
                ",
                params![
                    turn.id,
                    turn.session_id,
                    turn.note_path,
                    turn.command,
                    turn.action,
                    turn.prompt,
                    turn.context_summary,
                    turn.raw_response,
                    turn.parsed_result_json,
                    turn.status,
                    turn.error,
                    turn.created_at,
                    turn.completed_at,
                ],
            )
            .map_err(|error| format!("failed to record agent turn: {error}"))?;
        self.enforce_turn_retention(&turn.session_id, DEFAULT_TURN_RETENTION)?;
        Ok(())
    }

    pub fn record_operation_event(&self, event: &AgentOperationEvent) -> Result<(), String> {
        let operation_types_json = serde_json::to_string(&event.operation_types)
            .map_err(|error| format!("failed to serialize operation types: {error}"))?;
        let changed_fields_json = serde_json::to_string(&event.changed_fields)
            .map_err(|error| format!("failed to serialize changed fields: {error}"))?;
        self.conn
            .execute(
                "
                INSERT INTO agent_operation_events (
                  id, session_id, turn_id, note_path, operation_types_json,
                  changed_fields_json, created_note_path, applied_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ",
                params![
                    event.id,
                    event.session_id,
                    event.turn_id,
                    event.note_path,
                    operation_types_json,
                    changed_fields_json,
                    event.created_note_path,
                    event.applied_at,
                ],
            )
            .map_err(|error| format!("failed to record agent operation event: {error}"))?;
        Ok(())
    }

    pub fn store_undo_snapshot(&self, snapshot: &AgentUndoSnapshot) -> Result<(), String> {
        self.clear_last_undo_snapshot(&snapshot.note_path)?;
        self.conn
            .execute(
                "
                INSERT INTO agent_undo_snapshots (
                  id, session_id, event_id, note_path, note_before_markdown,
                  note_before_path, active_path_after_apply, created_note_path, created_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ",
                params![
                    snapshot.id,
                    snapshot.session_id,
                    snapshot.event_id,
                    snapshot.note_path,
                    snapshot.note_before_markdown,
                    snapshot.note_before_path,
                    snapshot.active_path_after_apply,
                    snapshot.created_note_path,
                    snapshot.created_at,
                ],
            )
            .map_err(|error| format!("failed to store agent undo snapshot: {error}"))?;
        Ok(())
    }

    pub fn load_last_undo_snapshot(&self, note_path: &str) -> Result<Option<AgentUndoSnapshot>, String> {
        self.conn
            .query_row(
                "
                SELECT id, session_id, event_id, note_path, note_before_markdown,
                       note_before_path, active_path_after_apply, created_note_path, created_at
                FROM agent_undo_snapshots
                WHERE note_path = ?1
                ORDER BY created_at DESC
                LIMIT 1
                ",
                params![note_path],
                |row| {
                    Ok(AgentUndoSnapshot {
                        id: row.get(0)?,
                        session_id: row.get(1)?,
                        event_id: row.get(2)?,
                        note_path: row.get(3)?,
                        note_before_markdown: row.get(4)?,
                        note_before_path: row.get(5)?,
                        active_path_after_apply: row.get(6)?,
                        created_note_path: row.get(7)?,
                        created_at: row.get(8)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("failed to load agent undo snapshot: {error}"))
    }

    pub fn clear_last_undo_snapshot(&self, note_path: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM agent_undo_snapshots WHERE note_path = ?1", params![note_path])
            .map_err(|error| format!("failed to clear agent undo snapshot: {error}"))?;
        Ok(())
    }

    pub fn enforce_turn_retention(&self, session_id: &str, keep: usize) -> Result<(), String> {
        self.conn
            .execute(
                "
                DELETE FROM agent_turns
                WHERE session_id = ?1
                  AND id NOT IN (
                    SELECT id
                    FROM agent_turns
                    WHERE session_id = ?1
                    ORDER BY created_at DESC
                    LIMIT ?2
                  )
                ",
                params![session_id, keep as i64],
            )
            .map_err(|error| format!("failed to enforce agent turn retention: {error}"))?;
        Ok(())
    }
```

- [ ] **Step 5: Run store tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_session
```

Expected: PASS for all `agent_session` tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent_session.rs src-tauri/src/lib.rs
git commit -m "feat(agent): add session store"
```

---

### Task 2: Tauri Commands and Frontend API

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/api.ts`
- Test: `src-tauri/src/commands.rs`

- [ ] **Step 1: Add command input types and path helper tests**

Modify `src-tauri/src/commands.rs` imports:

```rust
use crate::agent_session::{
    AgentOperationEvent, AgentSession, AgentSessionStore, AgentTurn, AgentUndoSnapshot,
};
```

Add these input types near the other command input structs:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAgentSessionInput {
    pub vault_root: String,
    pub note_path: String,
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
```

Add the path helper below `settings_db_path`:

```rust
pub(crate) fn agent_session_db_path(vault_root: &str) -> Result<PathBuf, String> {
    let vault = crate::vault::Vault::new(vault_root)?;
    Ok(vault.root().join(".inote").join("agent.sqlite3"))
}
```

Add tests in the existing `#[cfg(test)] mod tests` in `commands.rs`:

```rust
#[test]
fn agent_session_db_path_points_inside_vault_inote_folder() {
    let dir = tempfile::tempdir().unwrap();
    let path = agent_session_db_path(dir.path().to_str().unwrap()).unwrap();
    assert_eq!(path, dir.path().join(".inote").join("agent.sqlite3"));
}

#[test]
fn agent_session_db_path_rejects_missing_vault() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("missing");
    let error = agent_session_db_path(missing.to_str().unwrap()).unwrap_err();
    assert!(error.contains("vault") || error.contains("No such file") || error.contains("not found"));
}
```

- [ ] **Step 2: Run command tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_session_db_path
```

Expected: PASS if `Vault::new` accepts existing temp directories and rejects missing ones. If the missing-vault assertion message differs, update only the assertion string alternatives to match the actual error text.

- [ ] **Step 3: Add Tauri command functions**

Add these functions in `src-tauri/src/commands.rs` near the settings commands:

```rust
#[tauri::command]
pub fn load_agent_session(input: LoadAgentSessionInput) -> Result<Option<AgentSession>, String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?
        .load_session(&input.note_path)
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
pub fn load_last_agent_undo_snapshot(input: AgentUndoSnapshotInput) -> Result<Option<AgentUndoSnapshot>, String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?
        .load_last_undo_snapshot(&input.note_path)
}

#[tauri::command]
pub fn clear_last_agent_undo_snapshot(input: AgentUndoSnapshotInput) -> Result<(), String> {
    AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?
        .clear_last_undo_snapshot(&input.note_path)
}
```

- [ ] **Step 4: Register commands in lib.rs**

Modify `src-tauri/src/lib.rs` command registration to include:

```rust
commands::load_agent_session,
commands::record_agent_turn,
commands::record_agent_operation_event,
commands::load_last_agent_undo_snapshot,
commands::clear_last_agent_undo_snapshot,
```

- [ ] **Step 5: Add shared TypeScript types**

Append these types to `src/shared/types.ts`:

```ts
export type AgentTurnStatus = 'running' | 'ready' | 'applied' | 'discarded' | 'failed'

export interface AgentSession {
  id: string
  notePath: string
  noteTitle: string
  createdAt: string
  updatedAt: string
  turns: AgentTurn[]
  operationEvents: AgentOperationEvent[]
  lastUndoSnapshot?: AgentUndoSnapshot | null
}

export interface AgentTurn {
  id: string
  sessionId: string
  notePath: string
  command: string
  action?: string | null
  prompt: string
  contextSummary: string
  rawResponse: string
  parsedResultJson?: string | null
  status: AgentTurnStatus
  error?: string | null
  createdAt: string
  completedAt?: string | null
}

export interface AgentOperationEvent {
  id: string
  sessionId: string
  turnId: string
  notePath: string
  operationTypes: string[]
  changedFields: string[]
  createdNotePath?: string | null
  appliedAt: string
}

export interface AgentUndoSnapshot {
  id: string
  sessionId: string
  eventId: string
  notePath: string
  noteBeforeMarkdown: string
  noteBeforePath: string
  activePathAfterApply: string
  createdNotePath?: string | null
  createdAt: string
}
```

- [ ] **Step 6: Add frontend API wrappers**

Modify `src/shared/api.ts` type import:

```ts
import type {
  AgentOperationEvent,
  AgentSession,
  AgentTurn,
  AgentUndoSnapshot,
  LlmChatResponse,
  LlmProviderSettings,
  Note,
  NoteLinks,
  SearchResult,
  UserSettings,
} from './types'
```

Add interfaces and functions near the LLM/settings functions:

```ts
interface LoadAgentSessionInput {
  vaultRoot: string
  notePath: string
}

interface RecordAgentTurnInput {
  vaultRoot: string
  noteTitle: string
  turn: AgentTurn
}

interface RecordAgentOperationEventInput {
  vaultRoot: string
  noteTitle?: string | null
  event: AgentOperationEvent
  undoSnapshot?: AgentUndoSnapshot | null
}

interface AgentUndoSnapshotInput {
  vaultRoot: string
  notePath: string
}

export async function loadAgentSession(input: LoadAgentSessionInput): Promise<AgentSession | null> {
  return invoke<AgentSession | null>('load_agent_session', { input })
}

export async function recordAgentTurn(input: RecordAgentTurnInput): Promise<void> {
  return invoke<void>('record_agent_turn', { input })
}

export async function recordAgentOperationEvent(input: RecordAgentOperationEventInput): Promise<void> {
  return invoke<void>('record_agent_operation_event', { input })
}

export async function loadLastAgentUndoSnapshot(input: AgentUndoSnapshotInput): Promise<AgentUndoSnapshot | null> {
  return invoke<AgentUndoSnapshot | null>('load_last_agent_undo_snapshot', { input })
}

export async function clearLastAgentUndoSnapshot(input: AgentUndoSnapshotInput): Promise<void> {
  return invoke<void>('clear_last_agent_undo_snapshot', { input })
}
```

- [ ] **Step 7: Run backend and frontend type checks**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_session
npm run build
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src/shared/types.ts src/shared/api.ts
git commit -m "feat(agent): expose session persistence commands"
```

---

### Task 3: Review Plan Builder

**Files:**
- Create: `src/features/agent/agentReviewPlan.ts`
- Create: `src/features/agent/agentReviewPlan.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add ReviewPlan types**

Append these types to `src/shared/types.ts`:

```ts
export type ReviewGroupKind = 'metadata' | 'body_append' | 'body_replace' | 'create_note' | 'suggestion' | 'risk'

export interface ReviewPlan {
  id: string
  turnId: string
  message: string
  groups: ReviewGroup[]
  canApply: boolean
  highRisk: boolean
}

export interface ReviewGroup {
  id: string
  operationIndexes: number[]
  kind: ReviewGroupKind
  title: string
  summary: string
  items: ReviewItem[]
  selected: boolean
  requiresConfirmation?: boolean
}

export interface ReviewItem {
  label: string
  before?: string
  after?: string
  previewMarkdown?: string
}
```

- [ ] **Step 2: Write failing review plan tests**

Create `src/features/agent/agentReviewPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AgentResult } from './agentTypes'
import { buildReviewPlan, getSelectedOperations } from './agentReviewPlan'
import type { Note } from '../../shared/types'

const note: Note = {
  path: 'journal/example.md',
  title: 'Example',
  category: 'journal',
  tags: ['old'],
  createdAt: '2026-06-20',
  updatedAt: '2026-06-20',
  summary: 'Old summary',
  body: 'Original body',
  wordCount: 2,
}

describe('buildReviewPlan', () => {
  it('groups metadata changes with before and after values', () => {
    const result: AgentResult = {
      message: 'Updated metadata.',
      operations: [
        { type: 'update_current_note', patch: { summary: 'New summary', tags: ['new', 'agent'] } },
      ],
    }

    const plan = buildReviewPlan(note, result, 'turn-1')

    expect(plan.canApply).toBe(true)
    expect(plan.highRisk).toBe(false)
    expect(plan.groups).toEqual([
      {
        id: 'turn-1-metadata-0',
        operationIndexes: [0],
        kind: 'metadata',
        title: 'Metadata changes',
        summary: '2 fields will change.',
        selected: true,
        items: [
          { label: 'summary', before: 'Old summary', after: 'New summary' },
          { label: 'tags', before: 'old', after: 'new, agent' },
        ],
      },
    ])
  })

  it('marks title and category metadata changes with a path warning', () => {
    const result: AgentResult = {
      message: 'Move note.',
      operations: [
        { type: 'update_current_note', patch: { title: 'Renamed', category: 'projects' } },
      ],
    }

    const plan = buildReviewPlan(note, result, 'turn-2')

    expect(plan.highRisk).toBe(true)
    expect(plan.groups.map((group) => group.kind)).toEqual(['metadata', 'risk'])
    expect(plan.groups[1].summary).toContain('file path may change')
  })

  it('creates body append and body replace groups with replacement requiring confirmation', () => {
    const result: AgentResult = {
      message: 'Body edits.',
      operations: [
        { type: 'append_to_current_note', markdown: 'Appended text' },
        { type: 'replace_current_note_body', markdown: 'Replacement text' },
      ],
    }

    const plan = buildReviewPlan(note, result, 'turn-3')

    expect(plan.canApply).toBe(true)
    expect(plan.highRisk).toBe(true)
    expect(plan.groups[0]).toMatchObject({
      kind: 'body_append',
      selected: true,
      requiresConfirmation: false,
    })
    expect(plan.groups[1]).toMatchObject({
      kind: 'body_replace',
      selected: false,
      requiresConfirmation: true,
    })
  })

  it('creates create-note and suggestion groups', () => {
    const result: AgentResult = {
      message: 'Drafts.',
      operations: [
        { type: 'create_note', note: { title: 'Related', category: 'journal', tags: ['agent'], body: 'Body' } },
        { type: 'suggest_only', markdown: '- Try a clearer title' },
      ],
    }

    const plan = buildReviewPlan(note, result, 'turn-4')

    expect(plan.groups.map((group) => group.kind)).toEqual(['create_note', 'suggestion'])
    expect(plan.groups[0].items).toContainEqual({ label: 'title', after: 'Related' })
    expect(plan.groups[1].selected).toBe(false)
  })

  it('returns operations for selected applyable groups only', () => {
    const result: AgentResult = {
      message: 'Mixed.',
      operations: [
        { type: 'update_current_note', patch: { summary: 'New' } },
        { type: 'suggest_only', markdown: 'Suggestion' },
      ],
    }
    const plan = buildReviewPlan(note, result, 'turn-5')

    expect(getSelectedOperations(result.operations, plan.groups)).toEqual([
      { type: 'update_current_note', patch: { summary: 'New' } },
    ])
  })
})
```

- [ ] **Step 3: Run failing review tests**

Run:

```bash
npm test -- src/features/agent/agentReviewPlan.test.ts --run
```

Expected: FAIL because `agentReviewPlan.ts` does not exist.

- [ ] **Step 4: Implement review plan builder**

Create `src/features/agent/agentReviewPlan.ts`:

```ts
import type { Note, ReviewGroup, ReviewItem, ReviewPlan } from '../../shared/types'
import type { AgentOperation, AgentResult } from './agentTypes'

export function buildReviewPlan(note: Note, result: AgentResult, turnId: string): ReviewPlan {
  const groups: ReviewGroup[] = []

  result.operations.forEach((operation, index) => {
    if (operation.type === 'update_current_note') {
      const items: ReviewItem[] = Object.entries(operation.patch).map(([field, value]) => ({
        label: field,
        before: stringifyValue((note as unknown as Record<string, unknown>)[field]),
        after: stringifyValue(value),
      }))
      groups.push({
        id: `${turnId}-metadata-${index}`,
        operationIndexes: [index],
        kind: 'metadata',
        title: 'Metadata changes',
        summary: `${items.length} ${items.length === 1 ? 'field' : 'fields'} will change.`,
        items,
        selected: true,
      })
      if (operation.patch.title !== undefined || operation.patch.category !== undefined) {
        groups.push({
          id: `${turnId}-risk-path-${index}`,
          operationIndexes: [],
          kind: 'risk',
          title: 'Path may change',
          summary: 'Changing title or category means the file path may change when saved.',
          items: [],
          selected: false,
          requiresConfirmation: true,
        })
      }
      return
    }

    if (operation.type === 'append_to_current_note') {
      groups.push({
        id: `${turnId}-body-append-${index}`,
        operationIndexes: [index],
        kind: 'body_append',
        title: 'Append to note',
        summary: 'Markdown will be appended to the current note.',
        items: [{ label: 'append', previewMarkdown: operation.markdown }],
        selected: true,
        requiresConfirmation: false,
      })
      return
    }

    if (operation.type === 'replace_current_note_body') {
      groups.push({
        id: `${turnId}-body-replace-${index}`,
        operationIndexes: [index],
        kind: 'body_replace',
        title: 'Replace note body',
        summary: 'The current note body will be replaced.',
        items: [
          { label: 'current body', before: note.body },
          { label: 'replacement', previewMarkdown: operation.markdown },
        ],
        selected: false,
        requiresConfirmation: true,
      })
      return
    }

    if (operation.type === 'create_note') {
      groups.push({
        id: `${turnId}-create-note-${index}`,
        operationIndexes: [index],
        kind: 'create_note',
        title: 'Create note',
        summary: `${operation.note.category}/${operation.note.title}`,
        items: [
          { label: 'title', after: operation.note.title },
          { label: 'category', after: operation.note.category },
          { label: 'tags', after: stringifyValue(operation.note.tags ?? []) },
          { label: 'body', previewMarkdown: operation.note.body },
        ],
        selected: true,
      })
      return
    }

    if (operation.type === 'suggest_only') {
      groups.push({
        id: `${turnId}-suggestion-${index}`,
        operationIndexes: [index],
        kind: 'suggestion',
        title: 'Suggestion',
        summary: 'Suggestion only. It will not be applied automatically.',
        items: [{ label: 'suggestion', previewMarkdown: operation.markdown }],
        selected: false,
      })
    }
  })

  return {
    id: `${turnId}-review`,
    turnId,
    message: result.message,
    groups,
    canApply: groups.some((group) => group.selected && group.operationIndexes.length > 0),
    highRisk: groups.some((group) => group.kind === 'risk' || group.requiresConfirmation),
  }
}

export function getSelectedOperations(operations: AgentOperation[], groups: ReviewGroup[]): AgentOperation[] {
  const selectedIndexes = new Set<number>()
  for (const group of groups) {
    if (group.selected && group.kind !== 'suggestion' && group.kind !== 'risk') {
      group.operationIndexes.forEach((index) => selectedIndexes.add(index))
    }
  }
  return operations.filter((_, index) => selectedIndexes.has(index))
}

function stringifyValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (value === undefined || value === null || value === '') return 'empty'
  return String(value)
}
```

- [ ] **Step 5: Run review tests**

Run:

```bash
npm test -- src/features/agent/agentReviewPlan.test.ts --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/features/agent/agentReviewPlan.ts src/features/agent/agentReviewPlan.test.ts
git commit -m "feat(agent): build review plans"
```

---

### Task 4: Session Summary and Prompt Context

**Files:**
- Create: `src/features/agent/agentSessionSummary.ts`
- Create: `src/features/agent/agentSessionSummary.test.ts`
- Modify: `src/features/agent/agentPrompts.ts`
- Modify: `src/features/agent/agentPrompts.test.ts`

- [ ] **Step 1: Write failing session summary tests**

Create `src/features/agent/agentSessionSummary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AgentSession } from '../../shared/types'
import { buildAgentSessionSummary } from './agentSessionSummary'

const session: AgentSession = {
  id: 'session-1',
  notePath: 'journal/example.md',
  noteTitle: 'Example',
  createdAt: '2026-06-20T10:00:00Z',
  updatedAt: '2026-06-20T10:05:00Z',
  turns: [
    {
      id: 'turn-1',
      sessionId: 'session-1',
      notePath: 'journal/example.md',
      command: 'Summarize this note',
      action: 'summarize',
      prompt: 'large prompt',
      contextSummary: 'Title: Example',
      rawResponse: 'x'.repeat(2000),
      parsedResultJson: '{"message":"Added summary","operations":[]}',
      status: 'ready',
      createdAt: '2026-06-20T10:01:00Z',
      completedAt: '2026-06-20T10:02:00Z',
    },
    {
      id: 'turn-2',
      sessionId: 'session-1',
      notePath: 'journal/example.md',
      command: 'Add tags',
      action: 'suggest_tags',
      prompt: 'large prompt',
      contextSummary: 'Title: Example',
      rawResponse: 'raw response should not appear',
      parsedResultJson: '{"message":"Added tags","operations":[]}',
      status: 'applied',
      createdAt: '2026-06-20T10:03:00Z',
      completedAt: '2026-06-20T10:04:00Z',
    },
  ],
  operationEvents: [
    {
      id: 'event-1',
      sessionId: 'session-1',
      turnId: 'turn-2',
      notePath: 'journal/example.md',
      operationTypes: ['update_current_note'],
      changedFields: ['tags'],
      appliedAt: '2026-06-20T10:05:00Z',
    },
  ],
  lastUndoSnapshot: null,
}

describe('buildAgentSessionSummary', () => {
  it('summarizes recent commands and applied changes without raw response bloat', () => {
    const summary = buildAgentSessionSummary(session)

    expect(summary).toContain('Recent agent session for Example')
    expect(summary).toContain('Summarize this note')
    expect(summary).toContain('Add tags')
    expect(summary).toContain('Applied update_current_note: tags')
    expect(summary).not.toContain('raw response should not appear')
    expect(summary.length).toBeLessThan(900)
  })

  it('returns empty text for missing session', () => {
    expect(buildAgentSessionSummary(null)).toBe('')
  })
})
```

- [ ] **Step 2: Run failing session summary tests**

Run:

```bash
npm test -- src/features/agent/agentSessionSummary.test.ts --run
```

Expected: FAIL because `agentSessionSummary.ts` does not exist.

- [ ] **Step 3: Implement session summary**

Create `src/features/agent/agentSessionSummary.ts`:

```ts
import type { AgentSession } from '../../shared/types'

export function buildAgentSessionSummary(session: AgentSession | null | undefined): string {
  if (!session) return ''

  const lines = [`Recent agent session for ${session.noteTitle}:`]
  const recentTurns = session.turns.slice(-3)
  for (const turn of recentTurns) {
    const resultMessage = extractMessage(turn.parsedResultJson)
    lines.push(`- ${turn.status}: ${turn.command}${resultMessage ? ` -> ${resultMessage}` : ''}`)
  }

  const recentEvents = session.operationEvents.slice(-3)
  for (const event of recentEvents) {
    lines.push(`- Applied ${event.operationTypes.join(', ')}: ${event.changedFields.join(', ') || 'note'}`)
  }

  return trimToLength(lines.join('\n'), 800)
}

function extractMessage(parsedResultJson?: string | null): string {
  if (!parsedResultJson) return ''
  try {
    const parsed = JSON.parse(parsedResultJson)
    return typeof parsed.message === 'string' ? parsed.message : ''
  } catch {
    return ''
  }
}

function trimToLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}
```

- [ ] **Step 4: Extend prompt builder tests**

Modify `src/features/agent/agentPrompts.test.ts` by adding this case:

```ts
it('includes compact session summary when provided', () => {
  const request = buildAgentPrompt({
    command: 'Follow up',
    note,
    notes: [note],
    sessionSummary: 'Recent agent session for Example:\n- ready: Summarize -> Added summary',
  })

  expect(request.context).toContain('Recent agent session for Example')
  expect(request.context.indexOf('Recent agent session')).toBeLessThan(request.context.indexOf('Current note:'))
})
```

If the test file uses a differently named note fixture, use that existing fixture name.

- [ ] **Step 5: Update prompt builder signature**

Modify `src/features/agent/agentPrompts.ts`:

```ts
interface BuildAgentPromptInput {
  command: string
  note: Note
  notes: Note[]
  action?: QuickAgentAction
  maxContextLength?: number
  sessionSummary?: string
}

export function buildAgentPrompt({ command, note, notes, action, maxContextLength, sessionSummary }: BuildAgentPromptInput): { prompt: string, context: string } {
  return {
    prompt: [
      'You are iNote Note Agent. Return only valid JSON and no Markdown wrapper.',
      'The JSON shape must be: {"message":"summary","operations":[{"type":"operation_name", ...}]}',
      'Allowed operation types: update_current_note, append_to_current_note, replace_current_note_body, create_note, suggest_only.',
      'For append/replace/suggest, include a "markdown" string field. For update, include a "patch" object. For create, include a "note" object.',
      'Allowed patch fields: title, category, tags, summary, due, status, priority, project.',
      actionInstruction(action),
      `User command: ${command.trim() || actionInstruction(action)}`,
    ].filter(Boolean).join('\n'),
    context: [
      sessionSummary?.trim() ? sessionSummary.trim() : '',
      sessionSummary?.trim() ? '' : '',
      'Current note:',
      `Title: ${note.title}`,
      `Path: ${note.path}`,
      `Category: ${note.category}`,
      `Tags: ${note.tags.join(', ') || 'none'}`,
      `Created: ${note.createdAt}`,
      `Updated: ${note.updatedAt}`,
      note.summary ? `Summary: ${note.summary}` : '',
      `Existing categories: ${unique(notes.map((item) => item.category)).join(', ') || 'none'}`,
      `Existing tags: ${unique(notes.flatMap((item) => item.tags)).join(', ') || 'none'}`,
      '',
      note.body.slice(0, maxContextLength ?? 10000),
    ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n'),
  }
}
```

- [ ] **Step 6: Run prompt/session tests**

Run:

```bash
npm test -- src/features/agent/agentSessionSummary.test.ts src/features/agent/agentPrompts.test.ts --run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/agent/agentSessionSummary.ts src/features/agent/agentSessionSummary.test.ts src/features/agent/agentPrompts.ts src/features/agent/agentPrompts.test.ts
git commit -m "feat(agent): summarize session context"
```

---

### Task 5: Selected Operation Apply and Shared Save Path

**Files:**
- Modify: `src/features/agent/applyAgentOperations.ts`
- Modify: `src/features/agent/applyAgentOperations.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/noteAgentIntegration.test.ts`

- [ ] **Step 1: Add selected operation helper tests**

Modify `src/features/agent/applyAgentOperations.test.ts` by adding:

```ts
import { filterOperationsByIndexes } from './applyAgentOperations'

it('filters operations by selected indexes while preserving order', () => {
  const operations = [
    { type: 'update_current_note', patch: { summary: 'New' } },
    { type: 'suggest_only', markdown: 'Suggestion' },
    { type: 'append_to_current_note', markdown: 'Appendix' },
  ] as const

  expect(filterOperationsByIndexes([...operations], [2, 0])).toEqual([
    { type: 'update_current_note', patch: { summary: 'New' } },
    { type: 'append_to_current_note', markdown: 'Appendix' },
  ])
})
```

- [ ] **Step 2: Run failing apply helper test**

Run:

```bash
npm test -- src/features/agent/applyAgentOperations.test.ts --run
```

Expected: FAIL because `filterOperationsByIndexes` is not exported.

- [ ] **Step 3: Implement selected operation helper**

Add to `src/features/agent/applyAgentOperations.ts`:

```ts
export function filterOperationsByIndexes<T extends AgentOperation>(operations: T[], indexes: number[]): T[] {
  const selected = new Set(indexes)
  return operations.filter((_, index) => selected.has(index))
}
```

- [ ] **Step 4: Add integration static test for shared save helper**

Modify `src/app/noteAgentIntegration.test.ts`:

```ts
it('shares save path behavior between manual save and agent apply', () => {
  const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

  expect(app).toContain('async function saveNoteWithPathSync')
  expect(app).toContain('await saveNoteWithPathSync(applied.note')
  expect(app).toContain('moveNote({')
})
```

- [ ] **Step 5: Extract shared save helper in App.tsx**

In `src/app/App.tsx`, add this helper near `saveActiveNote`:

```ts
async function saveNoteWithPathSync(note: Note): Promise<Note> {
  let noteToSave = { ...note };

  const expectedFilename = `${getFilenameForTitle(noteToSave.title)}.md`;
  let expectedPath = noteToSave.category
    ? `${noteToSave.category}/${expectedFilename}`
    : expectedFilename;
  expectedPath = expectedPath.replace(/\/+/g, "/");

  let finalPath = noteToSave.path;

  if (noteToSave.path !== expectedPath) {
    try {
      const moved = await moveNote({
        vaultRoot: vaultRoot.trim(),
        from: noteToSave.path,
        to: expectedPath,
      });
      finalPath = moved.path;
    } catch {
      const newExpectedPath = expectedPath.replace(
        /\.md$/,
        `-${Math.floor(1000 + Math.random() * 9000)}.md`,
      );
      const moved = await moveNote({
        vaultRoot: vaultRoot.trim(),
        from: noteToSave.path,
        to: newExpectedPath,
      });
      finalPath = moved.path;
    }
    noteToSave.path = finalPath;
  }

  return writeNote({
    vaultRoot: vaultRoot.trim(),
    path: finalPath,
    content: noteToMarkdown(noteToSave),
  });
}
```

Then replace the duplicated path move/write block in `saveActiveNote` with:

```ts
const saved = await saveNoteWithPathSync(noteToSave);
```

Then replace the direct `writeNote` call in `applyAgentCurrentNote` with:

```ts
const saved = await saveNoteWithPathSync(applied.note);
```

- [ ] **Step 6: Run apply and integration tests**

Run:

```bash
npm test -- src/features/agent/applyAgentOperations.test.ts src/app/noteAgentIntegration.test.ts --run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/agent/applyAgentOperations.ts src/features/agent/applyAgentOperations.test.ts src/app/App.tsx src/app/noteAgentIntegration.test.ts
git commit -m "fix(agent): reuse save path behavior"
```

---

### Task 6: Workbench UI with Persisted Session Loading

**Files:**
- Modify: `src/features/agent/NoteAgent.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/styles.css`
- Modify: `src/app/noteAgentIntegration.test.ts`

- [ ] **Step 1: Extend NoteAgent props**

Modify `NoteAgentProps` in `src/features/agent/NoteAgent.tsx`:

```ts
interface NoteAgentProps {
  note: Note
  notes: Note[]
  vaultRoot: string
  settings: LlmProviderSettings
  onApplyCurrentNote: (result: AgentResult, selectedOperationIndexes: number[], turnId: string, sessionId: string) => Promise<void>
  onCreateNote: (result: AgentResult, selectedOperationIndexes: number[], turnId: string, sessionId: string) => Promise<void>
  onUndoLastApply: () => Promise<void>
}
```

- [ ] **Step 2: Add session loading state and stage model**

In `NoteAgent.tsx`, add imports:

```ts
import { useEffect, useMemo, useState } from 'react'
import type { AgentSession, ReviewPlan } from '../../shared/types'
import { loadAgentSession, recordAgentTurn } from '../../shared/api'
import { buildReviewPlan } from './agentReviewPlan'
import { buildAgentSessionSummary } from './agentSessionSummary'
```

Replace the existing React import line so `useEffect` is included only once.

Add local state:

```ts
const [session, setSession] = useState<AgentSession | null>(null)
const [reviewPlan, setReviewPlan] = useState<ReviewPlan | null>(null)
const [stage, setStage] = useState<'idle' | 'preparing' | 'requesting' | 'receiving' | 'parsing' | 'ready'>('idle')
const [activeTurnSessionId, setActiveTurnSessionId] = useState('')
```

Add effect:

```ts
useEffect(() => {
  let cancelled = false
  setSession(null)
  setReviewPlan(null)
  if (!vaultRoot.trim()) return
  loadAgentSession({ vaultRoot, notePath: note.path })
    .then((loaded) => {
      if (!cancelled) setSession(loaded)
    })
    .catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })
  return () => {
    cancelled = true
  }
}, [vaultRoot, note.path])
```

- [ ] **Step 3: Generate stable IDs for turns**

Add helper functions in `NoteAgent.tsx` below `quickActions`:

```ts
function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function nowIso(): string {
  return new Date().toISOString()
}
```

- [ ] **Step 4: Update runAgent to record turns and build review plans**

Inside `runAgent`, after settings validation and before building the request:

```ts
const turnId = makeId('turn')
const sessionId = session?.id ?? makeId('session')
setActiveTurnSessionId(sessionId)
setStage('preparing')
```

Change prompt construction to:

```ts
const request = buildAgentPrompt({
  command: nextCommand,
  note,
  notes,
  action: nextAction,
  maxContextLength: settings.maxContextLength,
  sessionSummary: buildAgentSessionSummary(session),
})
```

Before `executeLlmChatStream`, set:

```ts
setStage('requesting')
```

Inside stream callback set:

```ts
setStage('receiving')
```

After streaming completes:

```ts
setStage('parsing')
const parsed = parseAgentResult(fullResponse)
const plan = buildReviewPlan(note, parsed, turnId)
setResult(parsed)
setReviewPlan(plan)
await recordAgentTurn({
  vaultRoot,
  noteTitle: note.title,
  turn: {
    id: turnId,
    sessionId,
    notePath: note.path,
    command: nextCommand,
    action: nextAction ?? null,
    prompt: request.prompt,
    contextSummary: request.context.slice(0, 1200),
    rawResponse: fullResponse,
    parsedResultJson: JSON.stringify(parsed),
    status: 'ready',
    error: null,
    createdAt: nowIso(),
    completedAt: nowIso(),
  },
})
setSession(await loadAgentSession({ vaultRoot, notePath: note.path }))
setStage('ready')
```

In the `catch` block, set:

```ts
setStage('idle')
```

- [ ] **Step 5: Add static integration test for workbench UI markers**

Modify `src/app/noteAgentIntegration.test.ts`:

```ts
it('wires persisted NoteAgent workbench props', () => {
  const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
  const agent = readFileSync(resolve(__dirname, '../features/agent/NoteAgent.tsx'), 'utf8')

  expect(app).toContain('vaultRoot={vaultRoot}')
  expect(app).toContain('onUndoLastApply={undoLastAgentApply}')
  expect(agent).toContain('loadAgentSession')
  expect(agent).toContain('buildReviewPlan')
  expect(agent).toContain('Review Plan')
})
```

- [ ] **Step 6: Wire App props with a temporary undo stub**

Modify the `<NoteAgent />` call in `src/app/App.tsx`:

```tsx
<NoteAgent
  note={activeNote}
  notes={notes}
  vaultRoot={vaultRoot}
  settings={llmSettings}
  onApplyCurrentNote={applyAgentCurrentNote}
  onCreateNote={createAgentNote}
  onUndoLastApply={undoLastAgentApply}
/>
```

Add the temporary stub function near `createAgentNote`:

```ts
async function undoLastAgentApply() {
  setStatus("Agent undo will be available after operation snapshots are wired.");
}
```

Task 7 replaces this stub with snapshot-backed undo.

- [ ] **Step 7: Render timeline, stage bar, and review plan**

In `NoteAgent.tsx`, add these render helpers below `renderOperationDetails`:

```tsx
function renderStage(stage: string) {
  const stages = ['preparing', 'requesting', 'receiving', 'parsing', 'ready']
  return (
    <div className="agent-stage-list">
      {stages.map((item) => (
        <span key={item} className={stage === item ? 'active' : ''}>{item}</span>
      ))}
    </div>
  )
}

function renderSessionTimeline(session: AgentSession | null) {
  if (!session || (session.turns.length === 0 && session.operationEvents.length === 0)) {
    return <p className="agent-empty text-sm text-base-content/60">No saved agent session for this note yet.</p>
  }
  return (
    <div className="agent-timeline">
      {session.turns.slice(-5).map((turn) => (
        <details key={turn.id} className="agent-timeline-item">
          <summary>{turn.command}</summary>
          <p>{turn.status}{turn.error ? `: ${turn.error}` : ''}</p>
        </details>
      ))}
      {session.operationEvents.slice(-3).map((event) => (
        <div key={event.id} className="agent-timeline-item applied">
          Applied {event.operationTypes.join(', ')}: {event.changedFields.join(', ') || 'note'}
        </div>
      ))}
    </div>
  )
}

function renderReviewPlan(plan: ReviewPlan | null, onToggleGroup: (id: string) => void) {
  if (!plan) return null
  return (
    <>
      <p className="panel-title compact">Review Plan</p>
      <div className="agent-review-plan">
        <p>{plan.message || 'Review the proposed changes before applying.'}</p>
        {plan.groups.map((group) => (
          <div key={group.id} className={`agent-review-group ${group.kind}`}>
            <label>
              <input
                type="checkbox"
                checked={group.selected}
                disabled={group.kind === 'risk' || group.kind === 'suggestion'}
                onChange={() => onToggleGroup(group.id)}
              />
              <strong>{group.title}</strong>
            </label>
            <small>{group.summary}</small>
            {group.items.map((item) => (
              <div className="agent-review-item" key={`${group.id}-${item.label}`}>
                <span>{item.label}</span>
                {item.before !== undefined || item.after !== undefined ? (
                  <code>{item.before ?? ''} -> {item.after ?? ''}</code>
                ) : null}
                {item.previewMarkdown ? <pre>{item.previewMarkdown}</pre> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
```

Add toggle function in component:

```ts
function toggleReviewGroup(groupId: string) {
  setReviewPlan((current) => current
    ? { ...current, groups: current.groups.map((group) => group.id === groupId ? { ...group, selected: !group.selected } : group) }
    : current)
}
```

Replace the old proposed changes block with:

```tsx
{renderSessionTimeline(session)}
{stage !== 'idle' ? renderStage(stage) : null}
{renderReviewPlan(reviewPlan, toggleReviewGroup)}
```

Update `applyCurrent` and `createNote` to pass selected operation indexes:

```ts
const selectedIndexes = reviewPlan?.groups
  .filter((group) => group.selected)
  .flatMap((group) => group.operationIndexes) ?? []
await onApplyCurrentNote(result, selectedIndexes, reviewPlan?.turnId ?? '', activeTurnSessionId || session?.id || '')
```

Use the same `selectedIndexes` and `activeTurnSessionId || session?.id || ''` pattern for `onCreateNote`.

- [ ] **Step 8: Add styles**

Append to `src/app/styles.css` near existing agent styles:

```css
.agent-stage-list {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.agent-stage-list span {
  border: 1px solid var(--color-base-300);
  border-radius: var(--radius-field, 0.5rem);
  color: var(--color-base-content);
  font-size: 10px;
  overflow: hidden;
  padding: 5px 4px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-stage-list span.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-primary-content);
}

.agent-timeline {
  display: grid;
  gap: 8px;
}

.agent-timeline-item {
  border: 1px solid var(--color-base-300);
  border-radius: var(--radius-box, 0.5rem);
  background: var(--color-base-100);
  font-size: var(--font-size-12);
  padding: 8px;
}

.agent-timeline-item summary {
  cursor: pointer;
  font-weight: 700;
}

.agent-timeline-item.applied {
  color: var(--color-success);
}

.agent-review-plan {
  display: grid;
  gap: 10px;
}

.agent-review-group {
  border: 1px solid var(--color-base-300);
  border-radius: var(--radius-box, 0.5rem);
  background: var(--color-base-100);
  display: grid;
  gap: 6px;
  padding: 10px;
}

.agent-review-group.risk,
.agent-review-group.body_replace {
  border-color: color-mix(in srgb, var(--color-warning) 65%, var(--color-base-300));
}

.agent-review-group label {
  align-items: center;
  display: flex;
  gap: 8px;
}

.agent-review-group small {
  color: var(--color-base-content);
  opacity: 0.7;
}

.agent-review-item {
  display: grid;
  gap: 4px;
  font-size: var(--font-size-12);
}

.agent-review-item code,
.agent-review-item pre {
  background: var(--color-base-200);
  border-radius: var(--radius-field, 0.5rem);
  font-size: 11px;
  margin: 0;
  max-height: 160px;
  overflow: auto;
  padding: 8px;
  white-space: pre-wrap;
}
```

- [ ] **Step 9: Run UI-related tests and build**

Run:

```bash
npm test -- src/app/noteAgentIntegration.test.ts src/features/agent/agentReviewPlan.test.ts --run
npm run build
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/features/agent/NoteAgent.tsx src/app/App.tsx src/app/styles.css src/app/noteAgentIntegration.test.ts
git commit -m "feat(agent): add stateful workbench UI"
```

---

### Task 7: Apply Event Recording and Undo Current-Note Apply

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/features/agent/NoteAgent.tsx`
- Modify: `src/app/noteAgentIntegration.test.ts`

- [ ] **Step 1: Extend integration tests for operation events and undo**

Modify `src/app/noteAgentIntegration.test.ts`:

```ts
it('records agent operation events and supports current-note undo wiring', () => {
  const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

  expect(app).toContain('recordAgentOperationEvent')
  expect(app).toContain('loadLastAgentUndoSnapshot')
  expect(app).toContain('clearLastAgentUndoSnapshot')
  expect(app).toContain('noteBeforeMarkdown: noteToMarkdown(activeNote)')
  expect(app).toContain('noteTitle: saved.title')
  expect(app).toContain('Undo is not available for created notes yet.')
})
```

- [ ] **Step 2: Run failing integration test**

Run:

```bash
npm test -- src/app/noteAgentIntegration.test.ts --run
```

Expected: FAIL because App is not wired to operation event and undo commands yet.

- [ ] **Step 3: Import persistence APIs and selected operation helper**

Modify `src/app/App.tsx` imports from `../shared/api`:

```ts
  clearLastAgentUndoSnapshot,
  loadLastAgentUndoSnapshot,
  recordAgentOperationEvent,
```

Modify `applyAgentOperations` import:

```ts
import {
  applyCurrentNoteOperations,
  filterOperationsByIndexes,
  getCreateNoteDraft,
} from "../features/agent/applyAgentOperations";
```

Modify shared type import:

```ts
  AgentOperationEvent,
  AgentUndoSnapshot,
```

- [ ] **Step 4: Add ID helpers in App.tsx**

Add near `localDateString`:

```ts
function makeAgentId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function nowIsoString(): string {
  return new Date().toISOString();
}
```

- [ ] **Step 5: Update applyAgentCurrentNote signature and implementation**

Replace `applyAgentCurrentNote(result: AgentResult)` with:

```ts
async function applyAgentCurrentNote(
  result: AgentResult,
  selectedOperationIndexes: number[],
  turnId: string,
  sessionId: string,
) {
  if (!activeNote || !vaultRoot.trim()) {
    setStatus("Open a real vault before applying agent changes.");
    return;
  }

  const selectedOperations = selectedOperationIndexes.length
    ? filterOperationsByIndexes(result.operations, selectedOperationIndexes)
    : result.operations;
  const applied = applyCurrentNoteOperations(
    activeNote,
    selectedOperations,
    lockUpdateTime ? activeNote.updatedAt : localDateString(),
  );
  const eventId = makeAgentId("event");
  const now = nowIsoString();
  const event: AgentOperationEvent = {
    id: eventId,
    sessionId,
    turnId,
    notePath: activeNote.path,
    operationTypes: selectedOperations.map((operation) => operation.type),
    changedFields: applied.changedFields,
    createdNotePath: null,
    appliedAt: now,
  };
  const undoSnapshot: AgentUndoSnapshot = {
    id: makeAgentId("undo"),
    sessionId: event.sessionId,
    eventId,
    notePath: activeNote.path,
    noteBeforeMarkdown: noteToMarkdown(activeNote),
    noteBeforePath: activeNote.path,
    activePathAfterApply: activeNote.path,
    createdNotePath: null,
    createdAt: now,
  };

  setIsSaving(true);
  try {
    const saved = await saveNoteWithPathSync(applied.note);
    const savedEvent = { ...event, notePath: saved.path };
    const savedSnapshot = { ...undoSnapshot, activePathAfterApply: saved.path };
    await recordAgentOperationEvent({
      vaultRoot: vaultRoot.trim(),
      noteTitle: saved.title,
      event: savedEvent,
      undoSnapshot: savedSnapshot,
    });
    setLinkVersion((current) => current + 1);
    setNotes((current) =>
      current.map((note) => (note.path === activeNote.path ? saved : note)),
    );
    if (activeNote.path !== saved.path) {
      setActivePath(saved.path);
    }
    setActiveCategory(saved.category);
    setSaveError(false);
    setStatus(`Agent updated ${applied.changedFields.join(", ") || "note"}.`);
  } catch (error) {
    setSaveError(true);
    setStatus(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    setIsSaving(false);
  }
}
```

`NoteAgent` must pass the same `sessionId` that was used when recording the turn. `recordAgentOperationEvent` relies on that id matching the stored session row.

- [ ] **Step 6: Update createAgentNote signature and record create event**

Replace `createAgentNote(result: AgentResult)` with:

```ts
async function createAgentNote(
  result: AgentResult,
  selectedOperationIndexes: number[],
  turnId: string,
  sessionId: string,
) {
  if (!vaultRoot.trim()) {
    setStatus("Open a real vault before creating notes.");
    return;
  }

  const selectedOperations = selectedOperationIndexes.length
    ? filterOperationsByIndexes(result.operations, selectedOperationIndexes)
    : result.operations;
  const draft = getCreateNoteDraft(selectedOperations);
  try {
    const created = await createNote({
      vaultRoot: vaultRoot.trim(),
      title: draft.title,
      category: draft.category,
    });
    const backlink =
      draft.linkBackToCurrent && activeNote
        ? `\n\nRelated: [[${activeNote.title}]]`
        : "";
    const noteToSave = {
      ...created,
      tags: draft.tags ?? [],
      summary: draft.summary,
      body: `${draft.body.trimEnd()}${backlink}`,
      updatedAt: localDateString(),
    };
    const saved = await writeNote({
      vaultRoot: vaultRoot.trim(),
      path: created.path,
      content: noteToMarkdown(noteToSave),
    });
    await recordAgentOperationEvent({
      vaultRoot: vaultRoot.trim(),
      noteTitle: activeNote?.title ?? saved.title,
      event: {
        id: makeAgentId("event"),
        sessionId,
        turnId,
        notePath: activeNote?.path ?? saved.path,
        operationTypes: selectedOperations.map((operation) => operation.type),
        changedFields: [],
        createdNotePath: saved.path,
        appliedAt: nowIsoString(),
      },
      undoSnapshot: null,
    });
    setLinkVersion((current) => current + 1);
    setNotes((current) => [
      saved,
      ...current.filter((note) => note.path !== saved.path),
    ]);
    setActivePath(saved.path);
    setActiveCategory(saved.category);
    setActiveView("category");
    setSaveError(false);
    setStatus(`Agent created ${saved.path}.`);
  } catch (error) {
    setSaveError(true);
    setStatus(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
```

- [ ] **Step 7: Implement undoLastAgentApply**

Replace the temporary `undoLastAgentApply` stub with:

```ts
async function undoLastAgentApply() {
  if (!activeNote || !vaultRoot.trim()) {
    setStatus("Open a real vault before undoing agent changes.");
    return;
  }
  try {
    const snapshot = await loadLastAgentUndoSnapshot({
      vaultRoot: vaultRoot.trim(),
      notePath: activeNote.path,
    });
    if (!snapshot) {
      setStatus("No agent apply snapshot is available for this note.");
      return;
    }
    if (snapshot.createdNotePath) {
      setStatus("Undo is not available for created notes yet.");
      return;
    }

    let restorePath = snapshot.noteBeforePath;
    if (activeNote.path !== snapshot.noteBeforePath) {
      const moved = await moveNote({
        vaultRoot: vaultRoot.trim(),
        from: activeNote.path,
        to: snapshot.noteBeforePath,
      });
      restorePath = moved.path;
    }
    const restored = await writeNote({
      vaultRoot: vaultRoot.trim(),
      path: restorePath,
      content: snapshot.noteBeforeMarkdown,
    });
    await clearLastAgentUndoSnapshot({
      vaultRoot: vaultRoot.trim(),
      notePath: activeNote.path,
    });
    if (restorePath !== activeNote.path) {
      await clearLastAgentUndoSnapshot({
        vaultRoot: vaultRoot.trim(),
        notePath: restorePath,
      });
    }
    setLinkVersion((current) => current + 1);
    setNotes((current) =>
      current.map((note) => (note.path === activeNote.path ? restored : note)),
    );
    setActivePath(restored.path);
    setActiveCategory(restored.category);
    setSaveError(false);
    setStatus(`Undid last agent apply for ${restored.path}.`);
  } catch (error) {
    setSaveError(true);
    setStatus(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
```

- [ ] **Step 8: Run integration tests and build**

Run:

```bash
npm test -- src/app/noteAgentIntegration.test.ts src/features/agent/applyAgentOperations.test.ts --run
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/App.tsx src/features/agent/NoteAgent.tsx src/app/noteAgentIntegration.test.ts
git commit -m "feat(agent): record apply events and undo"
```

---

### Task 8: Final Verification

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run full TypeScript tests**

Run:

```bash
npm test -- --run
```

Expected: PASS.

- [ ] **Step 2: Run full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: working tree clean after the task commits; recent commits should include the agent session store, session commands, review plan, session summary, save path fix, workbench UI, and undo wiring.

- [ ] **Step 5: Manual smoke test**

Run the app:

```bash
npm run dev
```

Expected:

- Open a real vault.
- Open a note.
- Run Note Agent with a simple metadata request.
- See staged progress.
- See a Review Plan.
- Apply selected metadata changes.
- Switch away and back to the note.
- See the saved timeline.
- Use Undo last apply.
- Confirm the note content and path are restored for current-note changes.

- [ ] **Step 6: Commit verification-only documentation changes if any**

If the implementation changed a documented command name or user-visible behavior in the spec, update the spec with the exact final name and commit:

```bash
git add docs/superpowers/specs/2026-06-20-note-agent-stateful-workbench-design.md
git commit -m "docs(agent): align stateful workbench spec"
```

If the spec still matches implementation, do not create a commit in this step.
