# Note Agent Codex-Style Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Note Agent's tool-panel presentation with a right-sidebar Codex-style persisted conversation stream.

**Architecture:** Add first-class `AgentMessage` persistence beside existing agent session/turn/event records, then render the sidebar from `AgentConversation.messages`. Existing turns, review plans, operation events, and undo snapshots stay in place as execution records while messages become the UI transcript.

**Tech Stack:** Rust/Tauri commands with SQLite via `rusqlite`, React/TypeScript, Vitest, existing CSS in `src/app/styles.css`.

---

## File Structure

Create or modify these files:

- Modify `src-tauri/src/agent_session.rs`: add `AgentMessage`, `AgentConversation`, message schema, load/upsert/batch/update helpers, retention.
- Modify `src-tauri/src/commands.rs`: add Tauri inputs/commands for conversation and messages.
- Modify `src-tauri/src/lib.rs`: register new commands.
- Modify `src/shared/types.ts`: add `AgentMessage*` and `AgentConversation` types.
- Modify `src/shared/api.ts`: add frontend wrappers for new commands.
- Create `src/features/agent/agentMessagePayloads.ts`: encode/decode review and operation payloads.
- Create `src/features/agent/agentMessagePayloads.test.ts`: payload round-trip tests.
- Create `src/features/agent/agentConversation.ts`: message factories, sorting, history slicing helpers.
- Create `src/features/agent/agentConversation.test.ts`: pure message helper tests.
- Create `src/features/agent/AgentConversationView.tsx`: scrollable message list.
- Create `src/features/agent/AgentMessageBubble.tsx`: user/status/result/error/event bubble renderer.
- Create `src/features/agent/AgentReviewMessage.tsx`: inline review plan message with actions.
- Create `src/features/agent/AgentComposer.tsx`: command input, quick actions, send button.
- Modify `src/features/agent/NoteAgent.tsx`: orchestrate load/run/apply/create/undo through conversation messages.
- Modify `src/app/App.tsx`: record operation event messages after apply/create/undo.
- Modify `src/app/styles.css`: Codex-style conversation sidebar styling.
- Modify `src/app/noteAgentIntegration.test.ts`: static integration coverage for the new layout.

---

### Task 1: Persist Agent Messages In Rust Store

**Files:**
- Modify: `src-tauri/src/agent_session.rs`

- [ ] **Step 1: Add failing Rust tests for message round trip and retention**

Append these tests inside the existing `#[cfg(test)] mod tests` in `src-tauri/src/agent_session.rs`:

```rust
#[test]
fn agent_messages_round_trip_and_update_by_note_path() {
    let store = temp_store();
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
    let store = temp_store();
    let session_id = "session-conversation";
    let note_path = "journal/conversation.md";
    store
        .upsert_session(session_id, note_path, "Conversation", "2026-06-26T10:00:00Z")
        .unwrap();

    let turn = sample_turn("turn-conversation", session_id, note_path, "2026-06-26T10:01:00Z");
    store.record_turn(&turn).unwrap();
    let event = sample_event(session_id, &turn.id, note_path);
    store.record_operation_event(&event).unwrap();
    let snapshot = sample_snapshot("undo-conversation", session_id, &event.id, note_path);
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
    let store = temp_store();
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
    assert_eq!(messages.len(), 60);
    assert_eq!(messages.first().unwrap().id, "message-05");
    assert_eq!(messages.last().unwrap().id, "message-64");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_messages -- --nocapture
```

Expected: FAIL because `AgentMessage`, `load_conversation`, `record_message`, and `load_messages` do not exist.

- [ ] **Step 3: Add Rust types and SQLite schema**

In `src-tauri/src/agent_session.rs`, add these types near the existing agent structs:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversation {
    pub session: Option<AgentSession>,
    pub messages: Vec<AgentMessage>,
    pub last_undo_snapshot: Option<AgentUndoSnapshot>,
}

const DEFAULT_MESSAGE_RETENTION: usize = 60;
```

Inside the schema initialization block, add:

```rust
connection
    .execute_batch(
        "
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
        ",
    )
    .map_err(|error| error.to_string())?;
```

- [ ] **Step 4: Implement message store methods**

Add these methods to `impl AgentSessionStore`:

```rust
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

pub fn load_messages(
    &self,
    note_path: &str,
    limit: usize,
) -> Result<Vec<AgentMessage>, String> {
    let limit = limit.max(1) as i64;
    let connection = self.connection.lock().map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "
            SELECT id, session_id, note_path, turn_id, role, kind, text, payload_json, status, created_at, updated_at
            FROM agent_messages
            WHERE note_path = ?1
            ORDER BY created_at DESC, id DESC
            LIMIT ?2
            ",
        )
        .map_err(|error| error.to_string())?;
    let mut messages = statement
        .query_map(params![note_path, limit], map_agent_message)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    messages.reverse();
    Ok(messages)
}

pub fn record_message(&self, message: &AgentMessage) -> Result<(), String> {
    let mut connection = self.connection.lock().map_err(|error| error.to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute(
            "
            INSERT INTO agent_messages (
              id, session_id, note_path, turn_id, role, kind, text, payload_json, status, created_at, updated_at
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
                message.updated_at,
            ],
        )
        .map_err(|error| error.to_string())?;
    self.enforce_message_retention_tx(&transaction, &message.note_path, DEFAULT_MESSAGE_RETENTION)?;
    transaction.commit().map_err(|error| error.to_string())
}

pub fn record_messages(&self, messages: &[AgentMessage]) -> Result<(), String> {
    for message in messages {
        self.record_message(message)?;
    }
    Ok(())
}

fn enforce_message_retention_tx(
    &self,
    transaction: &rusqlite::Transaction<'_>,
    note_path: &str,
    retention: usize,
) -> Result<(), String> {
    transaction
        .execute(
            "
            DELETE FROM agent_messages
            WHERE note_path = ?1
              AND id NOT IN (
                SELECT id FROM agent_messages
                WHERE note_path = ?1
                ORDER BY created_at DESC, id DESC
                LIMIT ?2
              )
            ",
            params![note_path, retention as i64],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
```

Add this row mapper near existing mapper helpers:

```rust
fn map_agent_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentMessage> {
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
```

- [ ] **Step 5: Run targeted Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_messages -- --nocapture
```

Expected: PASS for the three new message tests.

- [ ] **Step 6: Run full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/agent_session.rs
git commit -m "feat(agent): persist conversation messages"
```

---

### Task 2: Expose Conversation Commands To Frontend

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/api.ts`

- [ ] **Step 1: Add failing Rust command tests**

Append these tests inside `src-tauri/src/commands.rs` tests:

```rust
#[test]
fn command_records_and_loads_agent_conversation_messages() {
    let temp_dir = tempfile::tempdir().unwrap();
    let vault_root = temp_dir.path().to_string_lossy().to_string();
    let note_path = "journal/conversation.md";
    let session_id = "session-command-message";
    let turn = sample_agent_turn("turn-command-message", session_id, note_path);
    record_agent_turn(RecordAgentTurnInput {
        vault_root: vault_root.clone(),
        note_title: "Conversation".to_string(),
        turn,
    })
    .unwrap();

    record_agent_message(RecordAgentMessageInput {
        vault_root: vault_root.clone(),
        message: AgentMessage {
            id: "message-command-1".to_string(),
            session_id: session_id.to_string(),
            note_path: note_path.to_string(),
            turn_id: Some("turn-command-message".to_string()),
            role: "user".to_string(),
            kind: "user_command".to_string(),
            text: "Summarize".to_string(),
            payload_json: None,
            status: "ready".to_string(),
            created_at: "2026-06-26T12:00:00Z".to_string(),
            updated_at: "2026-06-26T12:00:00Z".to_string(),
        },
    })
    .unwrap();

    let conversation = load_agent_conversation(LoadAgentConversationInput {
        vault_root,
        note_path: note_path.to_string(),
        message_limit: Some(10),
    })
    .unwrap();

    assert_eq!(conversation.session.unwrap().id, session_id);
    assert_eq!(conversation.messages.len(), 1);
    assert_eq!(conversation.messages[0].text, "Summarize");
}

#[test]
fn command_records_agent_message_batch() {
    let temp_dir = tempfile::tempdir().unwrap();
    let vault_root = temp_dir.path().to_string_lossy().to_string();
    let note_path = "journal/batch.md";
    let session_id = "session-command-batch";
    record_agent_turn(RecordAgentTurnInput {
        vault_root: vault_root.clone(),
        note_title: "Batch".to_string(),
        turn: sample_agent_turn("turn-command-batch", session_id, note_path),
    })
    .unwrap();

    record_agent_messages(RecordAgentMessagesInput {
        vault_root: vault_root.clone(),
        messages: vec![
            AgentMessage {
                id: "message-batch-1".to_string(),
                session_id: session_id.to_string(),
                note_path: note_path.to_string(),
                turn_id: Some("turn-command-batch".to_string()),
                role: "assistant".to_string(),
                kind: "assistant_status".to_string(),
                text: "Reading current note context...".to_string(),
                payload_json: None,
                status: "ready".to_string(),
                created_at: "2026-06-26T13:00:00Z".to_string(),
                updated_at: "2026-06-26T13:00:00Z".to_string(),
            },
            AgentMessage {
                id: "message-batch-2".to_string(),
                session_id: session_id.to_string(),
                note_path: note_path.to_string(),
                turn_id: Some("turn-command-batch".to_string()),
                role: "assistant".to_string(),
                kind: "assistant_result".to_string(),
                text: "Ready to review.".to_string(),
                payload_json: Some("{\"ok\":true}".to_string()),
                status: "ready".to_string(),
                created_at: "2026-06-26T13:00:01Z".to_string(),
                updated_at: "2026-06-26T13:00:01Z".to_string(),
            },
        ],
    })
    .unwrap();

    let conversation = load_agent_conversation(LoadAgentConversationInput {
        vault_root,
        note_path: note_path.to_string(),
        message_limit: Some(10),
    })
    .unwrap();
    assert_eq!(conversation.messages.len(), 2);
    assert_eq!(conversation.messages[1].kind, "assistant_result");
}

#[test]
fn command_updates_agent_message() {
    let temp_dir = tempfile::tempdir().unwrap();
    let vault_root = temp_dir.path().to_string_lossy().to_string();
    let note_path = "journal/update.md";
    let session_id = "session-command-update";
    record_agent_turn(RecordAgentTurnInput {
        vault_root: vault_root.clone(),
        note_title: "Update".to_string(),
        turn: sample_agent_turn("turn-command-update", session_id, note_path),
    })
    .unwrap();

    let mut message = AgentMessage {
        id: "message-update-1".to_string(),
        session_id: session_id.to_string(),
        note_path: note_path.to_string(),
        turn_id: Some("turn-command-update".to_string()),
        role: "assistant".to_string(),
        kind: "assistant_status".to_string(),
        text: "Reading current note context...".to_string(),
        payload_json: None,
        status: "streaming".to_string(),
        created_at: "2026-06-26T14:00:00Z".to_string(),
        updated_at: "2026-06-26T14:00:00Z".to_string(),
    };
    record_agent_message(RecordAgentMessageInput {
        vault_root: vault_root.clone(),
        message: message.clone(),
    })
    .unwrap();

    message.text = "Ready to review.".to_string();
    message.status = "ready".to_string();
    message.updated_at = "2026-06-26T14:00:01Z".to_string();
    update_agent_message(UpdateAgentMessageInput {
        vault_root: vault_root.clone(),
        message,
    })
    .unwrap();

    let conversation = load_agent_conversation(LoadAgentConversationInput {
        vault_root,
        note_path: note_path.to_string(),
        message_limit: Some(10),
    })
    .unwrap();
    assert_eq!(conversation.messages.len(), 1);
    assert_eq!(conversation.messages[0].text, "Ready to review.");
    assert_eq!(conversation.messages[0].status, "ready");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml command_records_agent -- --nocapture
```

Expected: FAIL because command structs and functions are missing.

- [ ] **Step 3: Add Rust command inputs and functions**

In `src-tauri/src/commands.rs`, import the new types:

```rust
use crate::agent_session::{AgentConversation, AgentMessage, AgentOperationEvent, AgentSession, AgentSessionStore, AgentTurn, AgentUndoSnapshot};
```

Add command input structs:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAgentConversationInput {
    pub vault_root: String,
    pub note_path: String,
    pub message_limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordAgentMessageInput {
    pub vault_root: String,
    pub message: AgentMessage,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordAgentMessagesInput {
    pub vault_root: String,
    pub messages: Vec<AgentMessage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentMessageInput {
    pub vault_root: String,
    pub message: AgentMessage,
}
```

Add Tauri command functions:

```rust
#[tauri::command]
pub fn load_agent_conversation(
    input: LoadAgentConversationInput,
) -> Result<AgentConversation, String> {
    let store = AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?;
    store.load_conversation(&input.note_path, input.message_limit.unwrap_or(60))
}

#[tauri::command]
pub fn record_agent_message(input: RecordAgentMessageInput) -> Result<(), String> {
    let store = AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?;
    store.record_message(&input.message)
}

#[tauri::command]
pub fn record_agent_messages(input: RecordAgentMessagesInput) -> Result<(), String> {
    let store = AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?;
    store.record_messages(&input.messages)
}

#[tauri::command]
pub fn update_agent_message(input: UpdateAgentMessageInput) -> Result<(), String> {
    let store = AgentSessionStore::open(agent_session_db_path(&input.vault_root)?)?;
    store.record_message(&input.message)
}
```

- [ ] **Step 4: Register commands**

In `src-tauri/src/lib.rs`, add these commands to the existing `invoke_handler` list:

```rust
commands::load_agent_conversation,
commands::record_agent_message,
commands::record_agent_messages,
commands::update_agent_message,
```

- [ ] **Step 5: Add TypeScript shared types**

In `src/shared/types.ts`, add:

```ts
export type AgentMessageRole = 'user' | 'assistant' | 'system'

export type AgentMessageKind =
  | 'user_command'
  | 'assistant_status'
  | 'assistant_result'
  | 'review_plan'
  | 'operation_event'
  | 'error'

export type AgentMessageStatus = 'pending' | 'streaming' | 'ready' | 'applied' | 'failed'

export interface AgentMessage {
  id: string
  sessionId: string
  notePath: string
  turnId?: string | null
  role: AgentMessageRole
  kind: AgentMessageKind
  text: string
  payloadJson?: string | null
  status: AgentMessageStatus
  createdAt: string
  updatedAt: string
}

export interface AgentConversation {
  session: AgentSession | null
  messages: AgentMessage[]
  lastUndoSnapshot?: AgentUndoSnapshot | null
}
```

- [ ] **Step 6: Add TypeScript API wrappers**

In `src/shared/api.ts`, import the new types and add input interfaces:

```ts
interface LoadAgentConversationInput {
  vaultRoot: string
  notePath: string
  messageLimit?: number
}

interface RecordAgentMessageInput {
  vaultRoot: string
  message: AgentMessage
}

interface RecordAgentMessagesInput {
  vaultRoot: string
  messages: AgentMessage[]
}

interface UpdateAgentMessageInput {
  vaultRoot: string
  message: AgentMessage
}
```

Add wrappers:

```ts
export async function loadAgentConversation(input: LoadAgentConversationInput): Promise<AgentConversation> {
  return invoke<AgentConversation>('load_agent_conversation', { input })
}

export async function recordAgentMessage(input: RecordAgentMessageInput): Promise<void> {
  return invoke<void>('record_agent_message', { input })
}

export async function recordAgentMessages(input: RecordAgentMessagesInput): Promise<void> {
  return invoke<void>('record_agent_messages', { input })
}

export async function updateAgentMessage(input: UpdateAgentMessageInput): Promise<void> {
  return invoke<void>('update_agent_message', { input })
}
```

- [ ] **Step 7: Run Rust and build checks**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml command_records_agent -- --nocapture
npm run build
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src/shared/types.ts src/shared/api.ts
git commit -m "feat(agent): expose conversation messages"
```

---

### Task 3: Add Agent Message Payload And Conversation Helpers

**Files:**
- Create: `src/features/agent/agentMessagePayloads.ts`
- Create: `src/features/agent/agentMessagePayloads.test.ts`
- Create: `src/features/agent/agentConversation.ts`
- Create: `src/features/agent/agentConversation.test.ts`

- [ ] **Step 1: Write failing payload tests**

Create `src/features/agent/agentMessagePayloads.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AgentOperationEvent, ReviewPlan } from '../../shared/types'
import {
  decodeOperationEventPayload,
  decodeReviewPlanPayload,
  encodeOperationEventPayload,
  encodeReviewPlanPayload,
} from './agentMessagePayloads'

const reviewPlan: ReviewPlan = {
  id: 'turn-1-review',
  turnId: 'turn-1',
  message: 'Review these changes.',
  canApply: true,
  highRisk: false,
  groups: [
    {
      id: 'group-1',
      operationIndexes: [0],
      kind: 'metadata',
      title: 'Metadata',
      summary: '1 field will change.',
      selected: true,
      items: [{ label: 'summary', before: 'Old', after: 'New' }],
    },
  ],
}

const event: AgentOperationEvent = {
  id: 'event-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  notePath: 'journal/example.md',
  operationTypes: ['update_current_note'],
  changedFields: ['summary'],
  createdNotePath: null,
  appliedAt: '2026-06-26T12:00:00Z',
}

describe('agentMessagePayloads', () => {
  it('round trips review plan payloads', () => {
    const encoded = encodeReviewPlanPayload(reviewPlan)
    expect(decodeReviewPlanPayload(encoded)).toEqual(reviewPlan)
  })

  it('round trips operation event payloads with undo availability', () => {
    const encoded = encodeOperationEventPayload({ event, canUndo: true, action: 'applied' })
    expect(decodeOperationEventPayload(encoded)).toEqual({ event, canUndo: true, action: 'applied' })
  })

  it('returns null for invalid payloads', () => {
    expect(decodeReviewPlanPayload('{bad')).toBeNull()
    expect(decodeOperationEventPayload('{"event":null}')).toBeNull()
  })
})
```

- [ ] **Step 2: Write failing conversation helper tests**

Create `src/features/agent/agentConversation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '../../shared/types'
import {
  buildAssistantResultMessage,
  buildErrorMessage,
  buildReviewPlanMessage,
  buildStatusMessage,
  buildUserCommandMessage,
  getRecentMeaningfulMessages,
  sortConversationMessages,
} from './agentConversation'

const base = {
  sessionId: 'session-1',
  notePath: 'journal/example.md',
  turnId: 'turn-1',
  now: '2026-06-26T12:00:00Z',
}

describe('agentConversation', () => {
  it('builds user, status, result, review, and error messages', () => {
    expect(buildUserCommandMessage({ ...base, id: 'm1', command: 'Summarize', action: 'summarize' })).toMatchObject({
      id: 'm1',
      role: 'user',
      kind: 'user_command',
      text: 'Summarize',
      status: 'ready',
    })
    expect(buildStatusMessage({ ...base, id: 'm2', text: 'Reading current note context...', status: 'streaming' })).toMatchObject({
      kind: 'assistant_status',
      status: 'streaming',
    })
    expect(buildAssistantResultMessage({ ...base, id: 'm3', text: 'Ready to review.', details: { prompt: 'p', context: 'c', rawResponse: 'r', parsedResultJson: '{}' } })).toMatchObject({
      kind: 'assistant_result',
      payloadJson: JSON.stringify({ prompt: 'p', context: 'c', rawResponse: 'r', parsedResultJson: '{}' }),
    })
    expect(buildReviewPlanMessage({ ...base, id: 'm4', text: 'Review ready.', reviewPlan: { id: 'review', turnId: 'turn-1', message: 'Review ready.', groups: [], canApply: false, highRisk: false } })).toMatchObject({
      kind: 'review_plan',
    })
    expect(buildErrorMessage({ ...base, id: 'm5', text: 'Parse failed' })).toMatchObject({
      role: 'system',
      kind: 'error',
      status: 'failed',
    })
  })

  it('sorts messages chronologically and keeps the latest meaningful messages', () => {
    const messages: AgentMessage[] = Array.from({ length: 8 }, (_, index) => ({
      id: `message-${index}`,
      sessionId: 'session-1',
      notePath: 'journal/example.md',
      turnId: null,
      role: index % 2 === 0 ? 'assistant' : 'user',
      kind: index === 1 ? 'assistant_status' : 'assistant_result',
      text: `Message ${index}`,
      payloadJson: null,
      status: 'ready',
      createdAt: `2026-06-26T12:0${7 - index}:00Z`,
      updatedAt: `2026-06-26T12:0${7 - index}:00Z`,
    }))

    expect(sortConversationMessages(messages).map((message) => message.id)[0]).toBe('message-7')
    expect(getRecentMeaningfulMessages(messages, 5)).toHaveLength(5)
    expect(getRecentMeaningfulMessages(messages, 5).some((message) => message.kind === 'assistant_status')).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/features/agent/agentMessagePayloads.test.ts src/features/agent/agentConversation.test.ts --run
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement payload helpers**

Create `src/features/agent/agentMessagePayloads.ts`:

```ts
import type { AgentOperationEvent, ReviewPlan } from '../../shared/types'

export interface OperationEventMessagePayload {
  event: AgentOperationEvent
  canUndo: boolean
  action: 'applied' | 'created' | 'undone'
}

export function encodeReviewPlanPayload(reviewPlan: ReviewPlan): string {
  return JSON.stringify(reviewPlan)
}

export function decodeReviewPlanPayload(value?: string | null): ReviewPlan | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed?.id !== 'string' || typeof parsed?.turnId !== 'string' || !Array.isArray(parsed?.groups)) {
      return null
    }
    return parsed as ReviewPlan
  } catch {
    return null
  }
}

export function encodeOperationEventPayload(payload: OperationEventMessagePayload): string {
  return JSON.stringify(payload)
}

export function decodeOperationEventPayload(value?: string | null): OperationEventMessagePayload | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (!parsed?.event || typeof parsed.event.id !== 'string' || typeof parsed.canUndo !== 'boolean') {
      return null
    }
    if (parsed.action !== 'applied' && parsed.action !== 'created' && parsed.action !== 'undone') {
      return null
    }
    return parsed as OperationEventMessagePayload
  } catch {
    return null
  }
}
```

- [ ] **Step 5: Implement conversation helpers**

Create `src/features/agent/agentConversation.ts`:

```ts
import type { AgentMessage, AgentMessageStatus, ReviewPlan } from '../../shared/types'
import type { QuickAgentAction } from './agentTypes'
import { encodeReviewPlanPayload } from './agentMessagePayloads'

interface MessageBaseInput {
  id: string
  sessionId: string
  notePath: string
  turnId?: string | null
  now: string
}

export interface AssistantResultDetails {
  prompt: string
  context: string
  rawResponse: string
  parsedResultJson: string
}

export function buildUserCommandMessage(input: MessageBaseInput & { command: string, action?: QuickAgentAction | null }): AgentMessage {
  return {
    id: input.id,
    sessionId: input.sessionId,
    notePath: input.notePath,
    turnId: input.turnId ?? null,
    role: 'user',
    kind: 'user_command',
    text: input.command,
    payloadJson: input.action ? JSON.stringify({ action: input.action }) : null,
    status: 'ready',
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function buildStatusMessage(input: MessageBaseInput & { text: string, status: Extract<AgentMessageStatus, 'pending' | 'streaming' | 'ready'> }): AgentMessage {
  return {
    id: input.id,
    sessionId: input.sessionId,
    notePath: input.notePath,
    turnId: input.turnId ?? null,
    role: 'assistant',
    kind: 'assistant_status',
    text: input.text,
    payloadJson: null,
    status: input.status,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function buildAssistantResultMessage(input: MessageBaseInput & { text: string, details: AssistantResultDetails }): AgentMessage {
  return {
    id: input.id,
    sessionId: input.sessionId,
    notePath: input.notePath,
    turnId: input.turnId ?? null,
    role: 'assistant',
    kind: 'assistant_result',
    text: input.text,
    payloadJson: JSON.stringify(input.details),
    status: 'ready',
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function buildReviewPlanMessage(input: MessageBaseInput & { text: string, reviewPlan: ReviewPlan }): AgentMessage {
  return {
    id: input.id,
    sessionId: input.sessionId,
    notePath: input.notePath,
    turnId: input.turnId ?? null,
    role: 'assistant',
    kind: 'review_plan',
    text: input.text,
    payloadJson: encodeReviewPlanPayload(input.reviewPlan),
    status: 'ready',
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function buildErrorMessage(input: MessageBaseInput & { text: string, payloadJson?: string | null }): AgentMessage {
  return {
    id: input.id,
    sessionId: input.sessionId,
    notePath: input.notePath,
    turnId: input.turnId ?? null,
    role: 'system',
    kind: 'error',
    text: input.text,
    payloadJson: input.payloadJson ?? null,
    status: 'failed',
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function sortConversationMessages(messages: AgentMessage[]): AgentMessage[] {
  return [...messages].sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt)
    return byTime === 0 ? left.id.localeCompare(right.id) : byTime
  })
}

export function getRecentMeaningfulMessages(messages: AgentMessage[], limit = 5): AgentMessage[] {
  return sortConversationMessages(messages)
    .filter((message) => message.kind !== 'assistant_status')
    .slice(-limit)
}
```

- [ ] **Step 6: Run helper tests**

Run:

```bash
npm test -- src/features/agent/agentMessagePayloads.test.ts src/features/agent/agentConversation.test.ts --run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/agent/agentMessagePayloads.ts src/features/agent/agentMessagePayloads.test.ts src/features/agent/agentConversation.ts src/features/agent/agentConversation.test.ts
git commit -m "feat(agent): add conversation message helpers"
```

---

### Task 4: Build Conversation UI Components

**Files:**
- Create: `src/features/agent/AgentComposer.tsx`
- Create: `src/features/agent/AgentConversationView.tsx`
- Create: `src/features/agent/AgentMessageBubble.tsx`
- Create: `src/features/agent/AgentReviewMessage.tsx`
- Modify: `src/app/noteAgentIntegration.test.ts`

- [ ] **Step 1: Add static failing integration test**

Append this test to `src/app/noteAgentIntegration.test.ts`:

```ts
it('uses Codex-style conversation components for NoteAgent', () => {
  const view = readFileSync(resolve(__dirname, '../features/agent/AgentConversationView.tsx'), 'utf8')
  const bubble = readFileSync(resolve(__dirname, '../features/agent/AgentMessageBubble.tsx'), 'utf8')
  const review = readFileSync(resolve(__dirname, '../features/agent/AgentReviewMessage.tsx'), 'utf8')
  const composer = readFileSync(resolve(__dirname, '../features/agent/AgentComposer.tsx'), 'utf8')

  expect(view).toContain('agent-conversation-stream')
  expect(bubble).toContain('agent-message-bubble')
  expect(review).toContain('Review Plan')
  expect(review).toContain('decodeReviewPlanPayload')
  expect(composer).toContain('agent-composer')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/app/noteAgentIntegration.test.ts --run
```

Expected: FAIL because new component files do not exist.

- [ ] **Step 3: Create AgentComposer**

Create `src/features/agent/AgentComposer.tsx`:

```tsx
import { FilePlus2, ListChecks, RefreshCw, Send, Sparkles, Tags, Wand2, Zap } from 'lucide-react'
import type { QuickAgentAction } from './agentTypes'

interface AgentComposerProps {
  command: string
  activeAction?: QuickAgentAction
  disabled: boolean
  onCommandChange: (value: string) => void
  onActionSelect: (action: QuickAgentAction, command: string) => void
  onSubmit: () => void
}

const quickActions: Array<{ action: QuickAgentAction, label: string, icon: typeof Sparkles, command: string }> = [
  { action: 'summarize', label: 'Summary', icon: Sparkles, command: 'Update the summary for the current note.' },
  { action: 'suggest_tags', label: 'Tags', icon: Tags, command: 'Suggest and apply concise tags for the current note.' },
  { action: 'clean_metadata', label: 'YAML', icon: Wand2, command: 'Clean the current note metadata.' },
  { action: 'extract_tasks', label: 'Tasks', icon: ListChecks, command: 'Extract action items and append them to the current note.' },
  { action: 'continue_writing', label: 'Continue', icon: RefreshCw, command: 'Continue writing the current note.' },
  { action: 'create_related', label: 'Related', icon: FilePlus2, command: 'Create a related note that links back to the current note.' },
]

export function AgentComposer({ command, activeAction, disabled, onCommandChange, onActionSelect, onSubmit }: AgentComposerProps) {
  return (
    <div className="agent-composer border-t border-base-300 bg-base-100 p-3">
      <textarea
        className="agent-command textarea textarea-bordered min-h-24 w-full resize-none text-sm"
        aria-label="Note agent command"
        value={command}
        onChange={(event) => onCommandChange(event.target.value)}
        placeholder="Ask the agent to update this note or create a new one."
      />
      <div className="agent-input-toolbar mt-2 flex items-center justify-between">
        <details className="agent-quick-action-dropdown dropdown dropdown-top" data-no-drag>
          <summary className="agent-quick-action-btn btn btn-ghost btn-sm btn-square" title="Quick Actions">
            <Zap size={16} />
          </summary>
          <div className="agent-quick-action-menu dropdown-content menu z-20 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
            {quickActions.map(({ action, label, icon: Icon, command: quickCommand }) => (
              <button
                key={action}
                className={activeAction === action ? 'active bg-primary/10 text-primary' : ''}
                type="button"
                onClick={(event) => {
                  onActionSelect(action, quickCommand)
                  const details = event.currentTarget.closest('details')
                  if (details) details.open = false
                }}
                title={label}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </details>
        <button className="agent-run-btn btn btn-primary btn-sm btn-square" title="Run agent" type="button" onClick={onSubmit} disabled={disabled}>
          {disabled ? <RefreshCw size={15} /> : <Send size={15} />}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create AgentReviewMessage**

Create `src/features/agent/AgentReviewMessage.tsx`:

```tsx
import type { AgentMessage, ReviewPlan } from '../../shared/types'
import { decodeReviewPlanPayload } from './agentMessagePayloads'

interface AgentReviewMessageProps {
  message: AgentMessage
  disabled: boolean
  onToggleGroup: (messageId: string, groupId: string) => void
  onApply: (message: AgentMessage, plan: ReviewPlan) => void
  onCreate: (message: AgentMessage, plan: ReviewPlan) => void
  onDiscard: (message: AgentMessage) => void
}

export function AgentReviewMessage({ message, disabled, onToggleGroup, onApply, onCreate, onDiscard }: AgentReviewMessageProps) {
  const plan = decodeReviewPlanPayload(message.payloadJson)
  if (!plan) {
    return <div className="agent-review-plan invalid">Review Plan could not be loaded.</div>
  }

  const hasCurrentNoteOperation = plan.groups.some((group) => group.selected && group.operationIndexes.length > 0 && group.kind !== 'create_note')
  const hasCreateOperation = plan.groups.some((group) => group.selected && group.kind === 'create_note')

  return (
    <div className="agent-review-plan">
      <p className="panel-title compact">Review Plan</p>
      <p>{plan.message || message.text || 'Review the proposed changes before applying.'}</p>
      {plan.groups.map((group) => (
        <div key={group.id} className={`agent-review-group ${group.kind}`}>
          <label>
            <input
              type="checkbox"
              checked={group.selected}
              disabled={disabled || group.kind === 'risk' || group.kind === 'suggestion'}
              onChange={() => onToggleGroup(message.id, group.id)}
            />
            <strong>{group.title}</strong>
          </label>
          <small>{group.summary}</small>
          {group.items.map((item) => (
            <div className="agent-review-item" key={`${group.id}-${item.label}`}>
              <span>{item.label}</span>
              {item.before !== undefined || item.after !== undefined ? <code>{item.before ?? ''} -&gt; {item.after ?? ''}</code> : null}
              {item.previewMarkdown ? <pre>{item.previewMarkdown}</pre> : null}
            </div>
          ))}
        </div>
      ))}
      <div className="agent-review-actions">
        <button className="btn btn-primary btn-sm" type="button" disabled={disabled || !hasCurrentNoteOperation} onClick={() => onApply(message, plan)}>Apply</button>
        <button className="btn btn-outline btn-sm" type="button" disabled={disabled || !hasCreateOperation} onClick={() => onCreate(message, plan)}>Create</button>
        <button className="btn btn-ghost btn-sm" type="button" disabled={disabled} onClick={() => onDiscard(message)}>Discard</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create AgentMessageBubble**

Create `src/features/agent/AgentMessageBubble.tsx`:

```tsx
import type { AgentMessage } from '../../shared/types'
import { decodeOperationEventPayload } from './agentMessagePayloads'

interface AgentMessageBubbleProps {
  message: AgentMessage
  onUndo: (message: AgentMessage) => void
}

export function AgentMessageBubble({ message, onUndo }: AgentMessageBubbleProps) {
  if (message.kind === 'operation_event') {
    const payload = decodeOperationEventPayload(message.payloadJson)
    return (
      <div className={`agent-message-bubble ${message.role} ${message.kind}`}>
        <p>{message.text}</p>
        {payload?.event.changedFields.length ? <small>Changed: {payload.event.changedFields.join(', ')}</small> : null}
        {payload?.event.createdNotePath ? <small>Created: {payload.event.createdNotePath}</small> : null}
        {payload?.canUndo ? <button className="btn btn-ghost btn-xs" type="button" onClick={() => onUndo(message)}>Undo</button> : null}
      </div>
    )
  }

  if (message.kind === 'assistant_result') {
    return (
      <div className={`agent-message-bubble ${message.role} ${message.kind}`}>
        <p>{message.text}</p>
        {message.payloadJson ? (
          <details>
            <summary>Details</summary>
            <pre>{message.payloadJson}</pre>
          </details>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`agent-message-bubble ${message.role} ${message.kind}`}>
      <p>{message.text}</p>
    </div>
  )
}
```

- [ ] **Step 6: Create AgentConversationView**

Create `src/features/agent/AgentConversationView.tsx`:

```tsx
import type { AgentMessage, ReviewPlan } from '../../shared/types'
import { sortConversationMessages } from './agentConversation'
import { AgentMessageBubble } from './AgentMessageBubble'
import { AgentReviewMessage } from './AgentReviewMessage'

interface AgentConversationViewProps {
  messages: AgentMessage[]
  disabled: boolean
  onToggleReviewGroup: (messageId: string, groupId: string) => void
  onApplyReview: (message: AgentMessage, plan: ReviewPlan) => void
  onCreateReview: (message: AgentMessage, plan: ReviewPlan) => void
  onDiscardReview: (message: AgentMessage) => void
  onUndo: (message: AgentMessage) => void
}

export function AgentConversationView({
  messages,
  disabled,
  onToggleReviewGroup,
  onApplyReview,
  onCreateReview,
  onDiscardReview,
  onUndo,
}: AgentConversationViewProps) {
  const sorted = sortConversationMessages(messages)
  if (sorted.length === 0) {
    return <p className="agent-empty text-sm text-base-content/60">No saved agent conversation for this note yet.</p>
  }

  return (
    <div className="agent-conversation-stream">
      {sorted.map((message) => (
        message.kind === 'review_plan'
          ? (
            <AgentReviewMessage
              key={message.id}
              message={message}
              disabled={disabled}
              onToggleGroup={onToggleReviewGroup}
              onApply={onApplyReview}
              onCreate={onCreateReview}
              onDiscard={onDiscardReview}
            />
          )
          : <AgentMessageBubble key={message.id} message={message} onUndo={onUndo} />
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Run static integration test**

Run:

```bash
npm test -- src/app/noteAgentIntegration.test.ts --run
```

Expected: PASS.

- [ ] **Step 8: Commit components**

```bash
git add src/features/agent/AgentComposer.tsx src/features/agent/AgentConversationView.tsx src/features/agent/AgentMessageBubble.tsx src/features/agent/AgentReviewMessage.tsx src/app/noteAgentIntegration.test.ts
git commit -m "feat(agent): add conversation components"
```

---

### Task 5: Rewire NoteAgent To Load And Render Conversations

**Files:**
- Modify: `src/features/agent/NoteAgent.tsx`
- Modify: `src/app/noteAgentIntegration.test.ts`

- [ ] **Step 1: Add static test that old timeline is no longer primary**

Append to `src/app/noteAgentIntegration.test.ts`:

```ts
it('does not use timeline as the primary NoteAgent experience', () => {
  const agent = readFileSync(resolve(__dirname, '../features/agent/NoteAgent.tsx'), 'utf8')

  expect(agent).toContain('loadAgentConversation')
  expect(agent).toContain('recordAgentMessages')
  expect(agent).toContain('AgentConversationView')
  expect(agent).not.toContain('renderSessionTimeline(session)')
  expect(agent).not.toContain('renderStage(stage)')
})
```

- [ ] **Step 2: Run integration test to verify it fails**

Run:

```bash
npm test -- src/app/noteAgentIntegration.test.ts --run
```

Expected: FAIL because `NoteAgent.tsx` still uses `loadAgentSession`, `recordAgentTurn`, `renderSessionTimeline`, and `renderStage`.

- [ ] **Step 3: Replace NoteAgent imports**

In `src/features/agent/NoteAgent.tsx`, replace the current API imports with:

```ts
import {
  executeLlmChatStream,
  loadAgentConversation,
  recordAgentMessages,
  recordAgentTurn,
} from '../../shared/api'
```

Import new components/helpers:

```ts
import type { AgentConversation, AgentMessage, LlmProviderSettings, Note, ReviewPlan } from '../../shared/types'
import {
  buildAssistantResultMessage,
  buildErrorMessage,
  buildReviewPlanMessage,
  buildStatusMessage,
  buildUserCommandMessage,
  getRecentMeaningfulMessages,
} from './agentConversation'
import { encodeReviewPlanPayload } from './agentMessagePayloads'
import { AgentConversationView } from './AgentConversationView'
import { AgentComposer } from './AgentComposer'
```

- [ ] **Step 4: Replace local state**

Replace session/timeline/review-plan display state with:

```ts
const [conversation, setConversation] = useState<AgentConversation | null>(null)
const [messages, setMessages] = useState<AgentMessage[]>([])
const [activeReviewResult, setActiveReviewResult] = useState<AgentResult | null>(null)
const [activeTurnSessionId, setActiveTurnSessionId] = useState('')
const [status, setStatus] = useState<'idle' | 'running' | 'applying' | 'error'>('idle')
const [error, setError] = useState('')
```

Keep:

```ts
const [command, setCommand] = useState('Update tags and summary for this note.')
const [activeAction, setActiveAction] = useState<QuickAgentAction | undefined>()
```

- [ ] **Step 5: Load conversation instead of session**

Replace the current `useEffect` body with:

```ts
useEffect(() => {
  let cancelled = false
  setConversation(null)
  setMessages([])
  setActiveReviewResult(null)
  if (!vaultRoot.trim()) return
  loadAgentConversation({ vaultRoot, notePath: note.path, messageLimit: 60 })
    .then((loaded) => {
      if (cancelled) return
      setConversation(loaded)
      setMessages(getRecentMeaningfulMessages(loaded.messages, 5))
    })
    .catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })
  return () => {
    cancelled = true
  }
}, [vaultRoot, note.path])
```

- [ ] **Step 6: Add message update helpers inside component**

Add inside `NoteAgent`:

```ts
function appendLocalMessages(nextMessages: AgentMessage[]) {
  setMessages((current) => [...current, ...nextMessages])
}

function upsertLocalMessage(nextMessage: AgentMessage) {
  setMessages((current) => {
    const index = current.findIndex((message) => message.id === nextMessage.id)
    if (index === -1) return [...current, nextMessage]
    return current.map((message) => message.id === nextMessage.id ? nextMessage : message)
  })
}

function getCurrentSessionId(): string {
  return conversation?.session?.id ?? makeId('session')
}
```

- [ ] **Step 7: Rewrite `runAgent` to append conversation messages**

Replace the body of `runAgent` with this structure:

```ts
async function runAgent(nextAction = activeAction, nextCommand = command) {
  setError('')
  if (!settings.apiKey.trim()) {
    setStatus('error')
    setError('Add an LLM API key in Settings first.')
    return
  }

  const turnId = makeId('turn')
  const sessionId = getCurrentSessionId()
  const createdAt = nowIso()
  const userMessage = buildUserCommandMessage({
    id: makeId('message'),
    sessionId,
    notePath: note.path,
    turnId,
    now: createdAt,
    command: nextCommand,
    action: nextAction ?? null,
  })
  const statusMessageId = makeId('message')
  let statusMessage = buildStatusMessage({
    id: statusMessageId,
    sessionId,
    notePath: note.path,
    turnId,
    now: createdAt,
    text: 'Reading current note context...',
    status: 'streaming',
  })

  appendLocalMessages([userMessage, statusMessage])
  await recordAgentMessages({ vaultRoot, messages: [userMessage, statusMessage] })

  try {
    setStatus('running')
    setActiveTurnSessionId(sessionId)
    const request = buildAgentPrompt({
      command: nextCommand,
      note,
      notes,
      action: nextAction,
      maxContextLength: settings.maxContextLength,
      sessionSummary: buildAgentSessionSummary(conversation?.session ?? null),
    })

    statusMessage = { ...statusMessage, text: 'Asking the model...', updatedAt: nowIso() }
    upsertLocalMessage(statusMessage)
    await recordAgentMessages({ vaultRoot, messages: [statusMessage] })

    let fullResponse = ''
    await executeLlmChatStream({ settings, prompt: request.prompt, context: request.context }, (chunk) => {
      fullResponse += chunk
      const receiving = { ...statusMessage, text: 'Receiving response...', updatedAt: nowIso() }
      statusMessage = receiving
      upsertLocalMessage(receiving)
    })

    const parsing = { ...statusMessage, text: 'Parsing response...', updatedAt: nowIso() }
    statusMessage = parsing
    upsertLocalMessage(parsing)
    await recordAgentMessages({ vaultRoot, messages: [parsing] })

    const parsed = parseAgentResult(fullResponse)
    const plan = buildReviewPlan(note, parsed, turnId)
    const completedAt = nowIso()
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
        createdAt,
        completedAt,
      },
    })

    const readyStatus = { ...statusMessage, text: 'Review plan ready.', status: 'ready' as const, updatedAt: completedAt }
    const resultMessage = buildAssistantResultMessage({
      id: makeId('message'),
      sessionId,
      notePath: note.path,
      turnId,
      now: completedAt,
      text: parsed.message || 'I prepared a review plan for this note.',
      details: {
        prompt: request.prompt,
        context: request.context,
        rawResponse: fullResponse,
        parsedResultJson: JSON.stringify(parsed),
      },
    })
    const reviewMessage = buildReviewPlanMessage({
      id: makeId('message'),
      sessionId,
      notePath: note.path,
      turnId,
      now: completedAt,
      text: plan.message || 'Review the proposed changes before applying.',
      reviewPlan: plan,
    })

    setActiveReviewResult(parsed)
    upsertLocalMessage(readyStatus)
    appendLocalMessages([resultMessage, reviewMessage])
    await recordAgentMessages({ vaultRoot, messages: [readyStatus, resultMessage, reviewMessage] })
    setConversation(await loadAgentConversation({ vaultRoot, notePath: note.path, messageLimit: 60 }))
    setStatus('idle')
  } catch (err) {
    const message = buildErrorMessage({
      id: makeId('message'),
      sessionId,
      notePath: note.path,
      turnId,
      now: nowIso(),
      text: err instanceof Error ? err.message : String(err),
    })
    appendLocalMessages([message])
    await recordAgentMessages({ vaultRoot, messages: [message] })
    setStatus('error')
    setError(err instanceof Error ? err.message : String(err))
  }
}
```

- [ ] **Step 8: Replace returned JSX**

Replace the render body inside `.note-agent` with:

```tsx
<div className="agent-scroll-area flex-1 space-y-3 overflow-y-auto p-3">
  {error ? <p className="agent-error alert alert-error py-2 text-sm">{error}</p> : null}
  <AgentConversationView
    messages={messages}
    disabled={status === 'running' || status === 'applying'}
    onToggleReviewGroup={toggleReviewGroup}
    onApplyReview={applyCurrent}
    onCreateReview={createNote}
    onDiscardReview={discardReview}
    onUndo={undoFromMessage}
  />
</div>
<AgentComposer
  command={command}
  activeAction={activeAction}
  disabled={status === 'running' || status === 'applying'}
  onCommandChange={setCommand}
  onActionSelect={(action, nextCommand) => {
    setActiveAction(action)
    setCommand(nextCommand)
  }}
  onSubmit={() => runAgent()}
/>
```

- [ ] **Step 9: Replace review actions**

Add handlers that operate on inline review messages:

```ts
function getSelectedIndexes(plan: ReviewPlan, kind: 'current' | 'create'): number[] {
  return plan.groups
    .filter((group) => group.selected)
    .filter((group) => kind === 'create' ? group.kind === 'create_note' : group.kind !== 'create_note' && group.kind !== 'risk' && group.kind !== 'suggestion')
    .flatMap((group) => group.operationIndexes)
}

function toggleReviewGroup(messageId: string, groupId: string) {
  setMessages((current) => current.map((message) => {
    if (message.id !== messageId || message.kind !== 'review_plan') return message
    const plan = decodeReviewPlanPayload(message.payloadJson)
    if (!plan) return message
    const nextPlan = {
      ...plan,
      groups: plan.groups.map((group) => group.id === groupId ? { ...group, selected: !group.selected } : group),
    }
    return { ...message, payloadJson: encodeReviewPlanPayload(nextPlan), updatedAt: nowIso() }
  }))
}

async function applyCurrent(message: AgentMessage, plan: ReviewPlan) {
  if (!activeReviewResult) return
  setStatus('applying')
  try {
    await onApplyCurrentNote(activeReviewResult, getSelectedIndexes(plan, 'current'), plan.turnId, activeTurnSessionId || conversation?.session?.id || '')
    setStatus('idle')
  } catch (err) {
    setStatus('error')
    setError(err instanceof Error ? err.message : String(err))
  }
}

async function createNote(message: AgentMessage, plan: ReviewPlan) {
  if (!activeReviewResult) return
  setStatus('applying')
  try {
    await onCreateNote(activeReviewResult, getSelectedIndexes(plan, 'create'), plan.turnId, activeTurnSessionId || conversation?.session?.id || '')
    setStatus('idle')
  } catch (err) {
    setStatus('error')
    setError(err instanceof Error ? err.message : String(err))
  }
}

function discardReview(message: AgentMessage) {
  setMessages((current) => current.map((item) => item.id === message.id ? { ...item, status: 'applied', text: 'Review discarded.', updatedAt: nowIso() } : item))
}

async function undoFromMessage() {
  await onUndoLastApply()
}
```

Also import `decodeReviewPlanPayload`.

- [ ] **Step 10: Remove old render helpers**

Remove from `NoteAgent.tsx`:

```ts
function renderStage(...)
function renderSessionTimeline(...)
function renderReviewPlan(...)
```

- [ ] **Step 11: Run tests and build**

Run:

```bash
npm test -- src/app/noteAgentIntegration.test.ts src/features/agent/agentConversation.test.ts src/features/agent/agentMessagePayloads.test.ts --run
npm run build
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/features/agent/NoteAgent.tsx src/features/agent/AgentComposer.tsx src/features/agent/AgentConversationView.tsx src/features/agent/AgentMessageBubble.tsx src/features/agent/AgentReviewMessage.tsx src/app/noteAgentIntegration.test.ts
git commit -m "feat(agent): render codex-style conversation"
```

---

### Task 6: Record Operation Messages From App Apply/Create/Undo

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/noteAgentIntegration.test.ts`
- Modify: `src/features/agent/NoteAgent.tsx`

- [ ] **Step 1: Add failing integration test for operation messages**

Append to `src/app/noteAgentIntegration.test.ts`:

```ts
it('records operation event messages after agent apply create and undo', () => {
  const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

  expect(app).toContain('buildOperationEventMessage')
  expect(app).toContain('recordAgentMessages({')
  expect(app).toContain("action: 'applied'")
  expect(app).toContain("action: 'created'")
  expect(app).toContain("action: 'undone'")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/app/noteAgentIntegration.test.ts --run
```

Expected: FAIL because `App.tsx` does not record operation messages.

- [ ] **Step 3: Add operation message factory**

In `src/features/agent/agentConversation.ts`, add:

```ts
import type { AgentOperationEvent } from '../../shared/types'
import { encodeOperationEventPayload } from './agentMessagePayloads'

export function buildOperationEventMessage(input: MessageBaseInput & {
  event: AgentOperationEvent
  action: 'applied' | 'created' | 'undone'
  canUndo: boolean
}): AgentMessage {
  const label = input.action === 'created'
    ? `Created ${input.event.createdNotePath ?? 'note'}.`
    : input.action === 'undone'
      ? `Undid the last agent apply for ${input.event.notePath}.`
      : `Applied ${input.event.operationTypes.join(', ')}.`
  return {
    id: input.id,
    sessionId: input.sessionId,
    notePath: input.notePath,
    turnId: input.turnId ?? null,
    role: 'assistant',
    kind: 'operation_event',
    text: label,
    payloadJson: encodeOperationEventPayload({ event: input.event, action: input.action, canUndo: input.canUndo }),
    status: 'applied',
    createdAt: input.now,
    updatedAt: input.now,
  }
}
```

Update `agentConversation.test.ts` to assert:

```ts
expect(buildOperationEventMessage({
  ...base,
  id: 'm6',
  event: {
    id: 'event-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    notePath: 'journal/example.md',
    operationTypes: ['update_current_note'],
    changedFields: ['summary'],
    createdNotePath: null,
    appliedAt: '2026-06-26T12:00:00Z',
  },
  action: 'applied',
  canUndo: true,
})).toMatchObject({ kind: 'operation_event', status: 'applied' })
```

- [ ] **Step 4: Import message APIs in App**

In `src/app/App.tsx`, add imports:

```ts
import { buildOperationEventMessage } from '../features/agent/agentConversation'
```

Add `recordAgentMessages` to the shared API import list.

- [ ] **Step 5: Record apply operation message**

After `recordAgentOperationEvent` in `applyAgentCurrentNote`, add:

```ts
await recordAgentMessages({
  vaultRoot: vaultRoot.trim(),
  messages: [
    buildOperationEventMessage({
      id: makeAgentId("message"),
      sessionId,
      notePath: saved.path,
      turnId,
      now,
      event: savedEvent,
      action: 'applied',
      canUndo: true,
    }),
  ],
});
```

- [ ] **Step 6: Record create operation message**

After `recordAgentOperationEvent` in `createAgentNote`, assign the event to a variable and record the message:

```ts
const event: AgentOperationEvent = {
  id: makeAgentId("event"),
  sessionId,
  turnId,
  notePath: activeNote?.path ?? saved.path,
  operationTypes: selectedOperations.map((operation) => operation.type),
  changedFields: [],
  createdNotePath: saved.path,
  appliedAt: nowIsoString(),
};
await recordAgentOperationEvent({
  vaultRoot: vaultRoot.trim(),
  noteTitle: activeNote?.title ?? saved.title,
  event,
  undoSnapshot: null,
});
await recordAgentMessages({
  vaultRoot: vaultRoot.trim(),
  messages: [
    buildOperationEventMessage({
      id: makeAgentId("message"),
      sessionId,
      notePath: event.notePath,
      turnId,
      now: event.appliedAt,
      event,
      action: 'created',
      canUndo: false,
    }),
  ],
});
```

- [ ] **Step 7: Record undo operation message**

After successful restore and snapshot clearing in `undoLastAgentApply`, add:

```ts
const event: AgentOperationEvent = {
  id: makeAgentId("event"),
  sessionId: snapshot.sessionId,
  turnId: "",
  notePath: restored.path,
  operationTypes: ["undo_agent_apply"],
  changedFields: ["body"],
  createdNotePath: null,
  appliedAt: nowIsoString(),
};
await recordAgentMessages({
  vaultRoot: vaultRoot.trim(),
  messages: [
    buildOperationEventMessage({
      id: makeAgentId("message"),
      sessionId: snapshot.sessionId,
      notePath: restored.path,
      turnId: null,
      now: event.appliedAt,
      event,
      action: 'undone',
      canUndo: false,
    }),
  ],
});
```

- [ ] **Step 8: Run tests and build**

Run:

```bash
npm test -- src/app/noteAgentIntegration.test.ts src/features/agent/agentConversation.test.ts --run
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/App.tsx src/app/noteAgentIntegration.test.ts src/features/agent/agentConversation.ts src/features/agent/agentConversation.test.ts
git commit -m "feat(agent): record operation messages"
```

---

### Task 7: Style The Codex-Style Conversation Sidebar

**Files:**
- Modify: `src/app/styles.css`
- Modify: `src/app/noteAgentIntegration.test.ts`

- [ ] **Step 1: Add static style test**

Append to `src/app/noteAgentIntegration.test.ts`:

```ts
it('has Codex-style conversation sidebar styles', () => {
  const styles = readFileSync(resolve(__dirname, './styles.css'), 'utf8')

  expect(styles).toContain('.agent-conversation-stream')
  expect(styles).toContain('.agent-message-bubble.user')
  expect(styles).toContain('.agent-message-bubble.assistant')
  expect(styles).toContain('.agent-review-actions')
  expect(styles).toContain('.agent-composer')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/app/noteAgentIntegration.test.ts --run
```

Expected: FAIL because new style markers are absent.

- [ ] **Step 3: Add conversation styles**

Append near existing agent styles in `src/app/styles.css`:

```css
.agent-conversation-stream {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.agent-message-bubble {
  border: 1px solid var(--color-base-300);
  border-radius: 10px;
  display: grid;
  gap: 6px;
  font-size: var(--font-size-13);
  line-height: 1.45;
  max-width: 94%;
  padding: 10px;
}

.agent-message-bubble p {
  margin: 0;
}

.agent-message-bubble.user {
  align-self: flex-start;
  background: var(--color-base-100);
}

.agent-message-bubble.assistant {
  align-self: flex-end;
  background: color-mix(in srgb, var(--color-success) 8%, var(--color-base-100));
  border-color: color-mix(in srgb, var(--color-success) 32%, var(--color-base-300));
}

.agent-message-bubble.system,
.agent-message-bubble.error {
  align-self: stretch;
  background: color-mix(in srgb, var(--color-error) 8%, var(--color-base-100));
  border-color: color-mix(in srgb, var(--color-error) 42%, var(--color-base-300));
}

.agent-message-bubble.assistant_status {
  align-self: center;
  background: transparent;
  border-style: dashed;
  color: var(--text-secondary);
  max-width: 100%;
}

.agent-message-bubble details {
  border-top: 1px solid var(--color-base-300);
  padding-top: 6px;
}

.agent-message-bubble pre {
  background: var(--color-base-200);
  border-radius: var(--radius-field, 0.5rem);
  font-size: 11px;
  margin: 6px 0 0;
  max-height: 220px;
  overflow: auto;
  padding: 8px;
  white-space: pre-wrap;
}

.agent-review-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.agent-composer {
  flex-shrink: 0;
}
```

- [ ] **Step 4: Remove stale styles only after components stop using them**

If `rg "agent-stage-list|agent-timeline|agent-input-wrapper" src` returns no live usage for a selector, remove that selector from `src/app/styles.css`.

Run:

```bash
rg "agent-stage-list|agent-timeline|agent-input-wrapper" src
```

Expected after Task 5: no `agent-stage-list` or `agent-timeline` in `.tsx` files.

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm test -- src/app/noteAgentIntegration.test.ts --run
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/styles.css src/app/noteAgentIntegration.test.ts
git commit -m "style(agent): polish conversation sidebar"
```

---

### Task 8: Full Verification And Handoff

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run full frontend tests**

Run:

```bash
npm test -- --run
```

Expected: PASS with all Vitest files passing.

- [ ] **Step 2: Run full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS with all Rust tests passing.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS. Existing Vite large chunk warnings are acceptable if no new errors appear.

- [ ] **Step 4: Inspect final status**

Run:

```bash
git status --short
git log --oneline -10
```

Expected: working tree clean after task commits; recent commits include message persistence, commands, helpers, conversation UI, operation messages, and styles.

- [ ] **Step 5: Manual smoke test**

Run:

```bash
npm run dev
```

Expected:

- Open the app in the displayed local URL.
- Open a real vault and select a note.
- Run a Note Agent command.
- See a `user_command` bubble, status bubble, assistant result bubble, and inline Review Plan card.
- Expand Details on the assistant result.
- Apply a safe metadata change.
- See an operation event message.
- Use Undo from the operation event or existing undo control and confirm a transcript message appears.

- [ ] **Step 6: Stop dev server**

If the dev server was started by this task, stop it before final response.

- [ ] **Step 7: Final response**

Report:

- branch/commit status,
- verification commands and pass counts,
- any remaining warnings,
- local URL only if the server is still intentionally running.
