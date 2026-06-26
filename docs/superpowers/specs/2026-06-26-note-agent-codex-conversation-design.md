# Note Agent Codex-Style Conversation Design

## Purpose

Upgrade the right-sidebar Note Agent from a stateful workbench into a Codex-style conversation surface.

The current Note Agent already persists per-note sessions, records turns and apply events, shows running stages, builds review plans, and supports undo for the last current-note apply. The next improvement should change the primary experience from a tool panel into a continuous assistant transcript: user command, agent progress, result, inline review plan, apply event, and undo all appear as messages in one flow.

The target style is closest to Codex's middle conversation area: calm incremental status updates, clear assistant replies, expandable details for technical context, and action cards embedded in the conversation.

## Decisions From Brainstorming

- Use the current right sidebar. Do not move the agent into the editor's main center area.
- Use a conversation-first layout, not a control-console layout.
- Default to simple natural-language progress. Keep technical prompt/context/raw-response details behind expandable controls.
- Put the Review Plan inline as an assistant message, not in a sticky footer.
- Show only the latest 5 meaningful history messages by default, with expandable details. Do not turn this into a full global chat archive yet.
- Prefer a complete chat model over a derived UI adapter. Messages should become first-class persisted data.

## Goals

- Make the Note Agent feel like an ongoing conversation about the active note.
- Persist UI-ready agent messages per note so the panel can restore recent context directly.
- Keep existing structured operations, review plans, apply events, and undo snapshots.
- Make every important state transition visible as a message: sent command, progress, result, review, applied, undone, failed.
- Keep the composer always available at the bottom.
- Keep the design local-first and vault-scoped.
- Avoid changing editor behavior or rich-text editing flows.

## Non-Goals

- No global multi-note chat archive.
- No multi-note batch editing.
- No autonomous background agent runs.
- No replacement of existing turn/event/undo audit records in this phase.
- No change to the LLM JSON operation contract unless required by the message model.
- No new cloud or identity layer.

## Architecture

### Persisted Conversation Model

Add a first-class persisted message model under each agent session.

The existing `agent_sessions`, `agent_turns`, `agent_operation_events`, and `agent_undo_snapshots` remain as execution/audit records. A new `agent_messages` table stores UI-ready transcript entries. This avoids reconstructing the conversation from lower-level events every time the user opens a note.

Conceptual schema:

```sql
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
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_note_path_created_at
ON agent_messages(note_path, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session_id_created_at
ON agent_messages(session_id, created_at);
```

`role` should be one of:

- `user`
- `assistant`
- `system`

`kind` should be one of:

- `user_command`
- `assistant_status`
- `assistant_result`
- `review_plan`
- `operation_event`
- `error`

`payload_json` carries structured details for rich message rendering. For example, review messages store a serialized `ReviewPlan`; operation messages store event ids, operation types, changed fields, created note paths, and undo availability.

### TypeScript Types

Add shared types beside the existing session types:

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

The initial implementation keeps `payloadJson` as a string and parses it at the component boundary. Typed payload unions are explicitly out of scope for this implementation and can be introduced in a separate refactor.

### Rust Commands

Add or extend Tauri commands:

- `load_agent_conversation(vaultRoot, notePath)` returns `AgentConversation`.
- `record_agent_message(input)` upserts one message by `id`.
- `record_agent_messages(input)` appends a small batch for one turn.
- `update_agent_message(input)` updates streaming/status messages.

Existing commands remain:

- `record_agent_turn`
- `record_agent_operation_event`
- `load_last_agent_undo_snapshot`
- `clear_last_agent_undo_snapshot`

Message commands should use the same vault-local database:

```text
<vault>/.inote/agent.sqlite3
```

## User Experience

### Sidebar Structure

The Note Agent remains in the right sidebar.

Top-level layout:

1. Conversation scroll area.
2. Inline message cards.
3. Bottom composer.

The old timeline section should stop being the primary UI. Recent history appears as compact conversation summary messages instead.

### Message Types

`user_command`:

- Shows the user's command text.
- Uses a compact neutral bubble.
- Includes quick-action label if one was used.

`assistant_status`:

- Shows natural-language progress such as:
  - "Reading current note context..."
  - "Asking the model..."
  - "Parsing response..."
  - "Building review plan..."
- Status messages may update in place during one run.
- Technical details stay hidden by default.

`assistant_result`:

- Shows the agent's natural-language response summary.
- Includes an expandable "Details" area with prompt, context, and raw response.
- Does not expose raw JSON by default.

`review_plan`:

- Renders inline after the result message.
- Shows grouped changes with checkboxes.
- Keeps before/after metadata rows and markdown previews.
- Shows high-risk warnings for body replacement and title/category path changes.
- Contains Apply/Create/Discard buttons for that specific review card.

`operation_event`:

- Shows "Applied", "Created", or "Undone" as a message in the transcript.
- Includes changed fields or created note path.
- Shows Undo when available.

`error`:

- Shows model, parse, apply, or undo errors in the conversation stream.
- Top-level alert remains only for system-level blocking issues, such as missing API key.

### Composer

The composer remains fixed at the bottom:

- Multi-line text input.
- Quick action menu.
- Send button.
- Disabled state while applying.

The composer should not be displaced by review cards. Users should be able to scroll the transcript and still send a follow-up.

### Expandable Technical Details

Each assistant result message can expose:

- prompt
- context
- raw response
- parsed result JSON

Default state: collapsed.

This keeps the main experience friendly while preserving debuggability.

## Data Flow

### Run Agent

1. User submits a command.
2. Frontend creates a turn id and session id if needed.
3. Frontend optimistically appends a `user_command` message.
4. Frontend appends or updates an `assistant_status` message as the run progresses.
5. LLM response streams into local state.
6. Parser produces an `AgentResult`.
7. `buildReviewPlan(note, result, turnId)` produces a `ReviewPlan`.
8. Frontend records:
   - `AgentTurn`
   - `assistant_result` message
   - `review_plan` message
9. Conversation reloads or reconciles with persisted messages.

### Apply Current Note Changes

1. User clicks Apply on a review plan message.
2. App filters selected current-note operations.
3. App applies note changes through existing save/move path logic.
4. App records `AgentOperationEvent` and undo snapshot.
5. App records an `operation_event` message.
6. The review message status updates to `applied`.

### Create Note

1. User clicks Create on a review plan message.
2. App filters selected create-note operation.
3. App creates and writes the new note.
4. App records `AgentOperationEvent`.
5. App records an `operation_event` message with created path.
6. Undo for created notes can remain unavailable in this phase, matching current behavior.

### Undo

1. User clicks Undo from an operation event message.
2. App loads last undo snapshot for active note.
3. App restores the note markdown and path as needed.
4. App clears the snapshot.
5. App records an `operation_event` message describing the undo.

## Component Design

Split `NoteAgent.tsx` into smaller units:

```text
src/features/agent/
  NoteAgent.tsx
  AgentConversationView.tsx
  AgentMessageBubble.tsx
  AgentReviewMessage.tsx
  AgentComposer.tsx
  agentConversation.ts
  agentMessagePayloads.ts
```

Responsibilities:

- `NoteAgent.tsx`: orchestration, command submission, persistence calls.
- `AgentConversationView.tsx`: scroll area and message list.
- `AgentMessageBubble.tsx`: common message frame and assistant/user/status/error rendering.
- `AgentReviewMessage.tsx`: inline review plan card and action buttons.
- `AgentComposer.tsx`: text input, quick actions, send button.
- `agentConversation.ts`: pure helpers for creating message objects and parsing payloads.
- `agentMessagePayloads.ts`: payload encode/decode helpers.

This split is important because the current `NoteAgent.tsx` is already carrying orchestration, rendering, status, timeline, review, and composer responsibilities in one file.

## Error Handling

- Missing API key: top-level blocking error near composer.
- Model/network failure: `error` message in transcript.
- Parse failure: `error` message with expandable raw response.
- Apply failure: `error` message after the review card.
- Undo failure: `error` message after the operation event.

Failed messages should be persisted where useful so the user can understand what happened after reopening the note.

## Retention

Keep the message history bounded.

Initial retention:

- Store the latest 60 messages per note session.
- Show the latest 5 meaningful messages by default when opening a note.
- Provide an affordance to reveal more recent messages in the same sidebar.

This keeps the UI light and avoids turning Note Agent into a full chat archive.

## Testing Strategy

Rust tests:

- `agent_messages` schema creation.
- Message insert, update, batch insert, and load by note path.
- Retention keeps newest messages in chronological display order.
- Conversation load returns session, messages, and last undo snapshot.

TypeScript pure tests:

- Message factory creates user/status/result/review/event/error messages.
- Review payload encode/decode round trips.
- Conversation helpers sort and group messages correctly.

Frontend static/integration tests:

- `NoteAgent` imports and renders conversation components.
- The old timeline is no longer the primary UI marker.
- Review Plan still appears inline.
- Expandable Details exists for assistant result messages.
- Apply/Create/Undo callbacks still receive selected operation indexes and ids.

Build verification:

- `npm test -- --run`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run build`

## Migration And Compatibility

Existing sessions without `agent_messages` should still load.

Initial compatibility behavior:

- If messages exist, render messages.
- If messages do not exist but turns/events exist, render a compact "Recent history" summary from current session data.
- New agent runs write both existing execution records and new messages.

This avoids needing to backfill all old data immediately.

## Open Implementation Notes

- The first implementation should not delete existing timeline code until message rendering is verified.
- Message persistence should be introduced behind tests before the UI switches over.
- The final UI should remove stale CSS for `.agent-timeline` only after no component uses it.
- Avoid changing editor layout or note save behavior.
