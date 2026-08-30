use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const DEFAULT_TURN_RETENTION: usize = 20;
pub const DEFAULT_MESSAGE_RETENTION: usize = 60;

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub session_id: String,
    pub note_path: String,
    pub turn_id: Option<String>,
    pub role: String,
    pub kind: String,
    pub text: String,
    pub payload_json: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversation {
    pub session: Option<AgentSession>,
    pub messages: Vec<AgentMessage>,
    pub last_undo_snapshot: Option<AgentUndoSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPreference {
    pub note_path: String,
    pub content: String,
    pub updated_at: String,
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

                CREATE TABLE IF NOT EXISTS agent_messages (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  note_path TEXT NOT NULL,
                  turn_id TEXT,
                  role TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  text TEXT NOT NULL,
                  payload_json TEXT,
                  status TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY(session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_agent_messages_note_path_created_at
                ON agent_messages(note_path, created_at);

                CREATE INDEX IF NOT EXISTS idx_agent_messages_session_id_created_at
                ON agent_messages(session_id, created_at);

                CREATE TABLE IF NOT EXISTS agent_preferences (
                  note_path TEXT PRIMARY KEY,
                  content TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                ",
            )
            .map_err(|error| format!("failed to create agent session schema: {error}"))
    }

    pub fn load_conversation(
        &self,
        note_path: &str,
        message_limit: usize,
    ) -> Result<AgentConversation, String> {
        let session = self.load_session(note_path)?;
        let messages = self.load_messages(note_path, message_limit)?;
        let last_undo_snapshot = self.load_last_undo_snapshot(note_path)?;
        Ok(AgentConversation {
            session,
            messages,
            last_undo_snapshot,
        })
    }

    pub fn load_preference(&self, note_path: &str) -> Result<Option<AgentPreference>, String> {
        self.conn
            .query_row(
                "SELECT note_path, content, updated_at FROM agent_preferences WHERE note_path = ?1",
                params![note_path],
                |row| Ok(AgentPreference { note_path: row.get(0)?, content: row.get(1)?, updated_at: row.get(2)? }),
            )
            .optional()
            .map_err(|error| format!("failed to load agent preference: {error}"))
    }

    pub fn save_preference(&self, preference: &AgentPreference) -> Result<(), String> {
        if preference.content.trim().is_empty() || preference.content.chars().count() > 2000 {
            return Err("agent preference must contain 1 to 2000 characters".to_string());
        }
        self.conn
            .execute(
                "INSERT INTO agent_preferences (note_path, content, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(note_path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
                params![preference.note_path, preference.content.trim(), preference.updated_at],
            )
            .map_err(|error| format!("failed to save agent preference: {error}"))?;
        Ok(())
    }

    pub fn clear_preference(&self, note_path: &str) -> Result<(), String> {
        self.conn.execute("DELETE FROM agent_preferences WHERE note_path = ?1", params![note_path])
            .map_err(|error| format!("failed to clear agent preference: {error}"))?;
        Ok(())
    }

    pub fn load_session(&self, note_path: &str) -> Result<Option<AgentSession>, String> {
        let session = self
            .conn
            .query_row(
                "
                SELECT id, note_path, note_title, created_at, updated_at
                FROM agent_sessions
                WHERE note_path = ?1
                ORDER BY updated_at DESC, id DESC
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

        let Some((id, note_path, note_title, created_at, updated_at)) = session else {
            return Ok(None);
        };

        let turns = self.load_turns(&id)?;
        let operation_events = self.load_operation_events(&id)?;
        let last_undo_snapshot = self.load_last_undo_snapshot(&note_path)?;

        Ok(Some(AgentSession {
            id,
            note_path,
            note_title,
            created_at,
            updated_at,
            turns,
            operation_events,
            last_undo_snapshot,
        }))
    }

    pub fn upsert_session(
        &self,
        id: &str,
        note_path: &str,
        note_title: &str,
        now: &str,
    ) -> Result<(), String> {
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

    pub fn update_session_note_target(
        &self,
        id: &str,
        note_path: &str,
        note_title: &str,
        now: &str,
    ) -> Result<(), String> {
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

    pub fn move_note_target(
        &self,
        old_path: &str,
        new_path: &str,
        new_title: &str,
    ) -> Result<(), String> {
        let transaction = self
            .conn
            .unchecked_transaction()
            .map_err(|error| format!("failed to start agent note move: {error}"))?;

        transaction
            .execute(
                "UPDATE agent_sessions SET note_path = ?2, note_title = ?3 WHERE note_path = ?1",
                params![old_path, new_path, new_title],
            )
            .map_err(|error| format!("failed to move agent sessions: {error}"))?;

        for table in [
            "agent_turns",
            "agent_operation_events",
            "agent_undo_snapshots",
            "agent_messages",
        ] {
            transaction
                .execute(
                    &format!("UPDATE {table} SET note_path = ?2 WHERE note_path = ?1"),
                    params![old_path, new_path],
                )
                .map_err(|error| format!("failed to move {table}: {error}"))?;
        }

        transaction
            .execute(
                "
                UPDATE agent_operation_events
                SET created_note_path = ?2
                WHERE created_note_path = ?1
                ",
                params![old_path, new_path],
            )
            .map_err(|error| format!("failed to update created note event paths: {error}"))?;
        transaction
            .execute(
                "
                UPDATE agent_undo_snapshots
                SET note_before_path = CASE WHEN note_before_path = ?1 THEN ?2 ELSE note_before_path END,
                    active_path_after_apply = CASE WHEN active_path_after_apply = ?1 THEN ?2 ELSE active_path_after_apply END,
                    created_note_path = CASE WHEN created_note_path = ?1 THEN ?2 ELSE created_note_path END
                WHERE note_before_path = ?1
                   OR active_path_after_apply = ?1
                   OR created_note_path = ?1
                ",
                params![old_path, new_path],
            )
            .map_err(|error| format!("failed to update agent undo paths: {error}"))?;

        transaction
            .commit()
            .map_err(|error| format!("failed to commit agent note move: {error}"))
    }

    pub fn record_turn(&self, turn: &AgentTurn) -> Result<(), String> {
        self.conn
            .execute(
                "
                INSERT INTO agent_turns (
                  id,
                  session_id,
                  note_path,
                  command,
                  action,
                  prompt,
                  context_summary,
                  raw_response,
                  parsed_result_json,
                  status,
                  error,
                  created_at,
                  completed_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                ON CONFLICT(id) DO UPDATE SET
                  session_id = excluded.session_id,
                  note_path = excluded.note_path,
                  command = excluded.command,
                  action = excluded.action,
                  prompt = excluded.prompt,
                  context_summary = excluded.context_summary,
                  raw_response = excluded.raw_response,
                  parsed_result_json = excluded.parsed_result_json,
                  status = excluded.status,
                  error = excluded.error,
                  created_at = excluded.created_at,
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
                    turn.completed_at
                ],
            )
            .map_err(|error| format!("failed to record agent turn: {error}"))?;
        self.enforce_turn_retention(&turn.session_id, DEFAULT_TURN_RETENTION)?;
        Ok(())
    }

    pub fn load_messages(
        &self,
        note_path: &str,
        limit: usize,
    ) -> Result<Vec<AgentMessage>, String> {
        let limit = limit.max(1) as i64;
        let mut statement = self
            .conn
            .prepare(
                "
                SELECT
                  id,
                  session_id,
                  note_path,
                  turn_id,
                  role,
                  kind,
                  text,
                  payload_json,
                  status,
                  created_at,
                  updated_at
                FROM agent_messages
                WHERE note_path = ?1
                ORDER BY created_at DESC, id DESC
                LIMIT ?2
                ",
            )
            .map_err(|error| format!("failed to prepare agent messages query: {error}"))?;

        let mut messages = statement
            .query_map(params![note_path, limit], row_to_message)
            .map_err(|error| format!("failed to load agent messages: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to read agent message: {error}"))?;
        messages.reverse();
        Ok(messages)
    }

    pub fn record_message(&self, message: &AgentMessage) -> Result<(), String> {
        let transaction = self
            .conn
            .unchecked_transaction()
            .map_err(|error| format!("failed to start agent message transaction: {error}"))?;

        transaction
            .execute(
                "
                INSERT INTO agent_messages (
                  id,
                  session_id,
                  note_path,
                  turn_id,
                  role,
                  kind,
                  text,
                  payload_json,
                  status,
                  created_at,
                  updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ON CONFLICT(id) DO UPDATE SET
                  session_id = excluded.session_id,
                  note_path = excluded.note_path,
                  turn_id = excluded.turn_id,
                  role = excluded.role,
                  kind = excluded.kind,
                  text = excluded.text,
                  payload_json = excluded.payload_json,
                  status = excluded.status,
                  updated_at = excluded.updated_at
                ",
                params![
                    message.id,
                    message.session_id,
                    message.note_path,
                    message.turn_id,
                    message.role,
                    message.kind,
                    message.text,
                    message.payload_json,
                    message.status,
                    message.created_at,
                    message.updated_at
                ],
            )
            .map_err(|error| format!("failed to record agent message: {error}"))?;
        Self::enforce_message_retention_tx(
            &transaction,
            &message.note_path,
            DEFAULT_MESSAGE_RETENTION,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("failed to commit agent message: {error}"))?;
        Ok(())
    }

    pub fn record_messages(&self, messages: &[AgentMessage]) -> Result<(), String> {
        for message in messages {
            self.record_message(message)?;
        }
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
                  id,
                  session_id,
                  turn_id,
                  note_path,
                  operation_types_json,
                  changed_fields_json,
                  created_note_path,
                  applied_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ON CONFLICT(id) DO UPDATE SET
                  session_id = excluded.session_id,
                  turn_id = excluded.turn_id,
                  note_path = excluded.note_path,
                  operation_types_json = excluded.operation_types_json,
                  changed_fields_json = excluded.changed_fields_json,
                  created_note_path = excluded.created_note_path,
                  applied_at = excluded.applied_at
                ",
                params![
                    event.id,
                    event.session_id,
                    event.turn_id,
                    event.note_path,
                    operation_types_json,
                    changed_fields_json,
                    event.created_note_path,
                    event.applied_at
                ],
            )
            .map_err(|error| format!("failed to record agent operation event: {error}"))?;
        Ok(())
    }

    pub fn store_undo_snapshot(&self, snapshot: &AgentUndoSnapshot) -> Result<(), String> {
        let transaction = self
            .conn
            .unchecked_transaction()
            .map_err(|error| format!("failed to start agent undo snapshot transaction: {error}"))?;

        transaction
            .execute(
                "
                INSERT INTO agent_undo_snapshots (
                  id,
                  session_id,
                  event_id,
                  note_path,
                  note_before_markdown,
                  note_before_path,
                  active_path_after_apply,
                  created_note_path,
                  created_at
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
                    snapshot.created_at
                ],
            )
            .map_err(|error| format!("failed to store agent undo snapshot: {error}"))?;

        transaction
            .execute(
                "
                DELETE FROM agent_undo_snapshots
                WHERE note_path = ?1
                  AND id NOT IN (
                    SELECT id FROM agent_undo_snapshots
                    WHERE note_path = ?1
                    ORDER BY created_at DESC, id DESC
                    LIMIT 20
                  )
                ",
                params![snapshot.note_path],
            )
            .map_err(|error| format!("failed to enforce undo history retention: {error}"))?;

        transaction
            .commit()
            .map_err(|error| format!("failed to commit agent undo snapshot: {error}"))?;
        Ok(())
    }

    pub fn load_last_undo_snapshot(
        &self,
        note_path: &str,
    ) -> Result<Option<AgentUndoSnapshot>, String> {
        self.conn
            .query_row(
                "
                SELECT
                  id,
                  session_id,
                  event_id,
                  note_path,
                  note_before_markdown,
                  note_before_path,
                  active_path_after_apply,
                  created_note_path,
                  created_at
                FROM agent_undo_snapshots
                WHERE note_path = ?1
                ORDER BY created_at DESC, id DESC
                LIMIT 1
                ",
                params![note_path],
                row_to_undo_snapshot,
            )
            .optional()
            .map_err(|error| format!("failed to load agent undo snapshot: {error}"))
    }

    pub fn clear_last_undo_snapshot(&self, note_path: &str) -> Result<(), String> {
        self.conn
            .execute(
                "
                DELETE FROM agent_undo_snapshots
                WHERE id IN (
                  SELECT id
                  FROM agent_undo_snapshots
                  WHERE note_path = ?1
                  ORDER BY created_at DESC, id DESC
                  LIMIT 1
                )
                ",
                params![note_path],
            )
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
                    ORDER BY created_at DESC, id DESC
                    LIMIT ?2
                  )
                ",
                params![session_id, keep as i64],
            )
            .map_err(|error| format!("failed to enforce agent turn retention: {error}"))?;
        Ok(())
    }

    fn enforce_message_retention_tx(
        transaction: &rusqlite::Transaction<'_>,
        note_path: &str,
        keep: usize,
    ) -> Result<(), String> {
        transaction
            .execute(
                "
                DELETE FROM agent_messages
                WHERE note_path = ?1
                  AND id NOT IN (
                    SELECT id
                    FROM agent_messages
                    WHERE note_path = ?1
                    ORDER BY created_at DESC, id DESC
                    LIMIT ?2
                  )
                ",
                params![note_path, keep as i64],
            )
            .map_err(|error| format!("failed to enforce agent message retention: {error}"))?;
        Ok(())
    }

    fn load_turns(&self, session_id: &str) -> Result<Vec<AgentTurn>, String> {
        let mut statement = self
            .conn
            .prepare(
                "
                SELECT
                  id,
                  session_id,
                  note_path,
                  command,
                  action,
                  prompt,
                  context_summary,
                  raw_response,
                  parsed_result_json,
                  status,
                  error,
                  created_at,
                  completed_at
                FROM agent_turns
                WHERE session_id = ?1
                ORDER BY created_at ASC, id ASC
                ",
            )
            .map_err(|error| format!("failed to prepare agent turns query: {error}"))?;

        let turns = statement
            .query_map(params![session_id], row_to_turn)
            .map_err(|error| format!("failed to load agent turns: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to read agent turn: {error}"))?;
        Ok(turns)
    }

    fn load_operation_events(&self, session_id: &str) -> Result<Vec<AgentOperationEvent>, String> {
        let mut statement = self
            .conn
            .prepare(
                "
                SELECT
                  id,
                  session_id,
                  turn_id,
                  note_path,
                  operation_types_json,
                  changed_fields_json,
                  created_note_path,
                  applied_at
                FROM agent_operation_events
                WHERE session_id = ?1
                ORDER BY applied_at ASC, id ASC
                ",
            )
            .map_err(|error| format!("failed to prepare agent operation events query: {error}"))?;

        let operation_events = statement
            .query_map(params![session_id], row_to_operation_event)
            .map_err(|error| format!("failed to load agent operation events: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to read agent operation event: {error}"))?;
        Ok(operation_events)
    }
}

fn row_to_turn(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentTurn> {
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
}

fn row_to_operation_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentOperationEvent> {
    let operation_types_json: String = row.get(4)?;
    let changed_fields_json: String = row.get(5)?;
    let operation_types = serde_json::from_str(&operation_types_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let changed_fields = serde_json::from_str(&changed_fields_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error))
    })?;

    Ok(AgentOperationEvent {
        id: row.get(0)?,
        session_id: row.get(1)?,
        turn_id: row.get(2)?,
        note_path: row.get(3)?,
        operation_types,
        changed_fields,
        created_note_path: row.get(6)?,
        applied_at: row.get(7)?,
    })
}

fn row_to_undo_snapshot(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentUndoSnapshot> {
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
}

fn row_to_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentMessage> {
    Ok(AgentMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        note_path: row.get(2)?,
        turn_id: row.get(3)?,
        role: row.get(4)?,
        kind: row.get(5)?,
        text: row.get(6)?,
        payload_json: row.get(7)?,
        status: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ops::Deref;

    struct TestStore {
        _dir: tempfile::TempDir,
        store: AgentSessionStore,
    }

    impl Deref for TestStore {
        type Target = AgentSessionStore;

        fn deref(&self) -> &Self::Target {
            &self.store
        }
    }

    fn store() -> TestStore {
        let dir = tempfile::tempdir().unwrap();
        let store =
            AgentSessionStore::open(dir.path().join(".inote").join("agent.sqlite3")).unwrap();
        TestStore { _dir: dir, store }
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

    fn sample_snapshot(
        id: &str,
        session_id: &str,
        event_id: &str,
        note_path: &str,
        body: &str,
        created_at: &str,
    ) -> AgentUndoSnapshot {
        AgentUndoSnapshot {
            id: id.to_string(),
            session_id: session_id.to_string(),
            event_id: event_id.to_string(),
            note_path: note_path.to_string(),
            note_before_markdown: body.to_string(),
            note_before_path: note_path.to_string(),
            active_path_after_apply: note_path.to_string(),
            created_note_path: None,
            created_at: created_at.to_string(),
        }
    }

    #[test]
    fn missing_note_session_returns_none() {
        let store = store();

        let session = store.load_session("knowledge/missing.md").unwrap();

        assert_eq!(session, None);
    }

    #[test]
    fn explicit_note_preference_round_trips_and_clears() {
        let store = store();
        let preference = AgentPreference {
            note_path: "knowledge/example.md".to_string(),
            content: "Keep headings concise.".to_string(),
            updated_at: "2026-08-30T10:00:00Z".to_string(),
        };
        store.save_preference(&preference).unwrap();
        assert_eq!(store.load_preference(&preference.note_path).unwrap(), Some(preference.clone()));
        store.clear_preference(&preference.note_path).unwrap();
        assert_eq!(store.load_preference(&preference.note_path).unwrap(), None);
    }

    #[test]
    fn session_turn_operation_event_and_undo_snapshot_round_trip() {
        let store = store();
        let session_id = "session-1";
        let note_path = "knowledge/example.md";
        let now = "2026-06-20T09:00:00Z";
        let turn = sample_turn("turn-1", session_id, note_path, "2026-06-20T09:05:00Z");
        let event = sample_event(session_id, &turn.id, note_path);
        let snapshot = sample_snapshot(
            "snapshot-1",
            session_id,
            &event.id,
            note_path,
            "---\ntitle: Example\n---\nBefore",
            "2026-06-20T10:01:00Z",
        );

        store
            .upsert_session(session_id, note_path, "Example", now)
            .unwrap();
        store.record_turn(&turn).unwrap();
        store.record_operation_event(&event).unwrap();
        store.store_undo_snapshot(&snapshot).unwrap();

        let session = store.load_session(note_path).unwrap().unwrap();

        assert_eq!(
            session,
            AgentSession {
                id: session_id.to_string(),
                note_path: note_path.to_string(),
                note_title: "Example".to_string(),
                created_at: now.to_string(),
                updated_at: now.to_string(),
                turns: vec![turn],
                operation_events: vec![event],
                last_undo_snapshot: Some(snapshot),
            }
        );
    }

    #[test]
    fn agent_messages_round_trip_and_update_by_note_path() {
        let store = store();
        let session_id = "session-message";
        let note_path = "journal/message.md";
        store
            .upsert_session(session_id, note_path, "Message Note", "2026-06-26T09:00:00Z")
            .unwrap();

        let user_message = AgentMessage {
            id: "message-1".to_string(),
            session_id: session_id.to_string(),
            note_path: note_path.to_string(),
            turn_id: Some("turn-1".to_string()),
            role: "user".to_string(),
            kind: "user_command".to_string(),
            text: "Summarize this note".to_string(),
            payload_json: None,
            status: "ready".to_string(),
            created_at: "2026-06-26T09:01:00Z".to_string(),
            updated_at: "2026-06-26T09:01:00Z".to_string(),
        };
        let mut status_message = AgentMessage {
            id: "message-2".to_string(),
            session_id: session_id.to_string(),
            note_path: note_path.to_string(),
            turn_id: Some("turn-1".to_string()),
            role: "assistant".to_string(),
            kind: "assistant_status".to_string(),
            text: "Reading current note context...".to_string(),
            payload_json: None,
            status: "streaming".to_string(),
            created_at: "2026-06-26T09:01:01Z".to_string(),
            updated_at: "2026-06-26T09:01:01Z".to_string(),
        };

        store.record_message(&user_message).unwrap();
        store.record_message(&status_message).unwrap();
        status_message.text = "Building review plan...".to_string();
        status_message.status = "ready".to_string();
        status_message.updated_at = "2026-06-26T09:01:02Z".to_string();
        store.record_message(&status_message).unwrap();

        let messages = store.load_messages(note_path, 10).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0], user_message);
        assert_eq!(messages[1].text, "Building review plan...");
        assert_eq!(messages[1].status, "ready");
    }

    #[test]
    fn load_conversation_returns_session_messages_and_undo_snapshot() {
        let store = store();
        let session_id = "session-conversation";
        let note_path = "journal/conversation.md";
        store
            .upsert_session(session_id, note_path, "Conversation", "2026-06-26T10:00:00Z")
            .unwrap();

        let turn = sample_turn(
            "turn-conversation",
            session_id,
            note_path,
            "2026-06-26T10:01:00Z",
        );
        store.record_turn(&turn).unwrap();
        let event = sample_event(session_id, &turn.id, note_path);
        store.record_operation_event(&event).unwrap();
        let snapshot = sample_snapshot(
            "undo-conversation",
            session_id,
            &event.id,
            note_path,
            "---\ntitle: Conversation\n---\nBefore",
            "2026-06-26T10:03:00Z",
        );
        store.store_undo_snapshot(&snapshot).unwrap();
        store
            .record_message(&AgentMessage {
                id: "message-conversation".to_string(),
                session_id: session_id.to_string(),
                note_path: note_path.to_string(),
                turn_id: Some(turn.id.clone()),
                role: "assistant".to_string(),
                kind: "assistant_result".to_string(),
                text: "Ready to review changes.".to_string(),
                payload_json: Some("{\"summary\":\"ok\"}".to_string()),
                status: "ready".to_string(),
                created_at: "2026-06-26T10:02:00Z".to_string(),
                updated_at: "2026-06-26T10:02:00Z".to_string(),
            })
            .unwrap();

        let conversation = store.load_conversation(note_path, 5).unwrap();
        assert_eq!(conversation.session.unwrap().id, session_id);
        assert_eq!(conversation.messages.len(), 1);
        assert_eq!(conversation.messages[0].kind, "assistant_result");
        assert_eq!(conversation.last_undo_snapshot.unwrap().id, snapshot.id);
    }

    #[test]
    fn record_message_keeps_latest_sixty_messages_for_note() {
        let store = store();
        let session_id = "session-retention";
        let note_path = "journal/retention.md";
        store
            .upsert_session(session_id, note_path, "Retention", "2026-06-26T11:00:00Z")
            .unwrap();

        for index in 0..65 {
            store
                .record_message(&AgentMessage {
                    id: format!("message-{index:02}"),
                    session_id: session_id.to_string(),
                    note_path: note_path.to_string(),
                    turn_id: None,
                    role: "assistant".to_string(),
                    kind: "assistant_status".to_string(),
                    text: format!("Status {index}"),
                    payload_json: None,
                    status: "ready".to_string(),
                    created_at: format!("2026-06-26T11:{index:02}:00Z"),
                    updated_at: format!("2026-06-26T11:{index:02}:00Z"),
                })
                .unwrap();
        }

        let messages = store.load_messages(note_path, 100).unwrap();
        assert_eq!(messages.len(), DEFAULT_MESSAGE_RETENTION);
        assert_eq!(messages.first().unwrap().id, "message-05");
        assert_eq!(messages.last().unwrap().id, "message-64");
    }

    #[test]
    fn undo_snapshots_form_a_stack_and_clear_pops_only_the_latest() {
        let store = store();
        let session_id = "session-1";
        let note_path = "knowledge/example.md";
        store
            .upsert_session(session_id, note_path, "Example", "2026-06-20T09:00:00Z")
            .unwrap();
        let turn = sample_turn("turn-1", session_id, note_path, "2026-06-20T09:05:00Z");
        store.record_turn(&turn).unwrap();
        let event = sample_event(session_id, &turn.id, note_path);
        store.record_operation_event(&event).unwrap();
        let older = sample_snapshot(
            "snapshot-older",
            session_id,
            &event.id,
            note_path,
            "Older body",
            "2026-06-20T10:00:00Z",
        );
        let latest = sample_snapshot(
            "snapshot-latest",
            session_id,
            &event.id,
            note_path,
            "Latest body",
            "2026-06-20T10:05:00Z",
        );

        store.store_undo_snapshot(&older).unwrap();
        store.store_undo_snapshot(&latest).unwrap();

        assert_eq!(
            store.load_last_undo_snapshot(note_path).unwrap(),
            Some(latest)
        );

        store.clear_last_undo_snapshot(note_path).unwrap();

        assert_eq!(
            store.load_last_undo_snapshot(note_path).unwrap(),
            Some(older)
        );
    }

    #[test]
    fn failed_undo_snapshot_replacement_keeps_existing_snapshot() {
        let store = store();
        let session_id = "session-1";
        let note_path = "knowledge/example.md";
        let other_note_path = "knowledge/other.md";
        store
            .upsert_session(session_id, note_path, "Example", "2026-06-20T09:00:00Z")
            .unwrap();
        let turn = sample_turn("turn-1", session_id, note_path, "2026-06-20T09:05:00Z");
        store.record_turn(&turn).unwrap();
        let event = sample_event(session_id, &turn.id, note_path);
        store.record_operation_event(&event).unwrap();
        let existing = sample_snapshot(
            "snapshot-existing",
            session_id,
            &event.id,
            note_path,
            "Existing body",
            "2026-06-20T10:00:00Z",
        );
        let conflicting_other_note_snapshot = sample_snapshot(
            "snapshot-conflict",
            session_id,
            &event.id,
            other_note_path,
            "Other body",
            "2026-06-20T10:01:00Z",
        );
        let conflicting_replacement = sample_snapshot(
            "snapshot-conflict",
            session_id,
            &event.id,
            note_path,
            "Replacement body",
            "2026-06-20T10:02:00Z",
        );

        store.store_undo_snapshot(&existing).unwrap();
        store
            .store_undo_snapshot(&conflicting_other_note_snapshot)
            .unwrap();

        let error = store
            .store_undo_snapshot(&conflicting_replacement)
            .unwrap_err();

        assert!(error.contains("failed to store agent undo snapshot"));
        assert_eq!(
            store.load_last_undo_snapshot(note_path).unwrap(),
            Some(existing)
        );
    }

    #[test]
    fn record_turn_keeps_latest_twenty_turns_in_ascending_chronological_order() {
        let store = store();
        let session_id = "session-1";
        let note_path = "knowledge/example.md";
        store
            .upsert_session(session_id, note_path, "Example", "2026-06-20T09:00:00Z")
            .unwrap();

        for index in 0..25 {
            let turn = sample_turn(
                &format!("turn-{index:02}"),
                session_id,
                note_path,
                &format!("2026-06-20T09:{index:02}:00Z"),
            );
            store.record_turn(&turn).unwrap();
        }

        let session = store.load_session(note_path).unwrap().unwrap();
        let turn_ids: Vec<_> = session.turns.iter().map(|turn| turn.id.as_str()).collect();

        assert_eq!(session.turns.len(), DEFAULT_TURN_RETENTION);
        assert_eq!(turn_ids.first(), Some(&"turn-05"));
        assert_eq!(turn_ids.last(), Some(&"turn-24"));
    }

    #[test]
    fn updating_session_note_target_moves_load_session_and_updates_title_and_timestamp() {
        let store = store();
        let session_id = "session-1";
        let old_path = "knowledge/old.md";
        let new_path = "projects/new.md";
        store
            .upsert_session(session_id, old_path, "Old title", "2026-06-20T09:00:00Z")
            .unwrap();

        store
            .update_session_note_target(session_id, new_path, "New title", "2026-06-20T10:00:00Z")
            .unwrap();

        assert_eq!(store.load_session(old_path).unwrap(), None);
        let session = store.load_session(new_path).unwrap().unwrap();

        assert_eq!(session.id, session_id);
        assert_eq!(session.note_path, new_path);
        assert_eq!(session.note_title, "New title");
        assert_eq!(session.created_at, "2026-06-20T09:00:00Z");
        assert_eq!(session.updated_at, "2026-06-20T10:00:00Z");
    }

    #[test]
    fn moving_note_target_preserves_the_full_conversation() {
        let store = store();
        let session_id = "session-1";
        let old_path = "knowledge/old.md";
        let new_path = "projects/new.md";
        store
            .upsert_session(session_id, old_path, "Old", "2026-06-20T09:00:00Z")
            .unwrap();
        let turn = sample_turn("turn-1", session_id, old_path, "2026-06-20T09:05:00Z");
        store.record_turn(&turn).unwrap();
        store
            .record_message(&AgentMessage {
                id: "message-1".to_string(),
                session_id: session_id.to_string(),
                note_path: old_path.to_string(),
                turn_id: Some(turn.id.clone()),
                role: "user".to_string(),
                kind: "command".to_string(),
                text: "Summarize".to_string(),
                payload_json: None,
                status: "ready".to_string(),
                created_at: "2026-06-20T09:05:00Z".to_string(),
                updated_at: "2026-06-20T09:05:00Z".to_string(),
            })
            .unwrap();

        store.move_note_target(old_path, new_path, "New").unwrap();

        assert!(store.load_conversation(old_path, 10).unwrap().messages.is_empty());
        let conversation = store.load_conversation(new_path, 10).unwrap();
        assert_eq!(conversation.session.unwrap().note_title, "New");
        assert_eq!(conversation.messages.len(), 1);
        assert_eq!(conversation.messages[0].note_path, new_path);
    }
}
