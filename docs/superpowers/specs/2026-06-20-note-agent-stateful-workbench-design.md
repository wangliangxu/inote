# Stateful Note Agent Workbench Design

## Purpose

Upgrade the current Note Agent from a simple single-turn operation runner into a lightweight stateful workbench for the active note.

The first improved version should make the agent feel less forgetful and much safer to apply. It will persist the recent agent session for each note, show clear running stages, present grouped review plans before writing, and support undoing the last agent-applied change.

This design starts from the existing `src/features/agent/` implementation. The current agent already sends scoped note context to the configured LLM, streams the response, parses structured JSON operations, previews operations, and applies current-note or create-note operations through `App.tsx`. The next step is not a full automation platform. It is a thin vertical slice that completes one trustworthy workflow end to end.

## Selected Approach

Build a thin vertical slice:

1. Load the persisted agent session for the current note.
2. Run one agent turn using the current note and recent session context.
3. Parse the LLM response into existing structured operations.
4. Convert operations into a grouped `ReviewPlan`.
5. Let the user apply selected changes.
6. Persist an operation event and undo snapshot.
7. Restore the most recent per-note session when the note is reopened.

This is preferred over a UI-only polish pass because it solves the "stateless" problem directly. It is preferred over building a full session core first because users get an immediately better review/apply experience.

## Goals

- Persist the latest agent session per note inside the vault.
- Restore the note's recent agent timeline when the note becomes active.
- Keep the existing structured operation model and parser.
- Add a review plan layer that groups and explains proposed changes.
- Improve the right sidebar into a small workbench with timeline, stages, review, and composer.
- Allow undoing the last agent apply for the active note.
- Reuse `App.tsx` as the owner of vault writes and global note state.
- Fix current-note apply so title/category changes follow the normal move/save path.

## Non-Goals

- No batch editing of multiple existing notes.
- No deletion operations.
- No arbitrary file paths from LLM output.
- No proactive background automation.
- No global searchable chat history.
- No cross-device identity or cloud sync beyond the vault files themselves.
- No long-term preference memory beyond recent per-note session context.

## Current Problems

The current Note Agent is useful but still shallow:

- Agent UI state is local React state and disappears when switching context or restarting.
- The sidebar has no real per-note conversation timeline.
- Proposed operations are shown as raw operation cards rather than before/after review plans.
- Apply is coarse: current-note operations are applied together, and create-note operations are separate.
- Risk is not explicit enough for body replacement or title/category changes.
- `applyAgentCurrentNote` writes to the current path directly, while normal save can move the note when title/category changes. Agent apply should use the same path logic.
- Process log is helpful for debugging but too technical to be the primary progress UI.

## Architecture

### Tauri Storage Layer

Add a vault-local agent database:

```text
<vault>/.inote/agent.sqlite3
```

This mirrors the existing search index location at `<vault>/.inote/index.sqlite3`. It keeps agent history with the vault without writing it into Markdown notes.

Add a Rust store module, for example:

```text
src-tauri/src/agent_session.rs
```

The store owns schema creation, migrations, session loading, turn recording, operation event recording, undo snapshot storage, and retention cleanup.

Expose Tauri commands through `commands.rs` and `shared/api.ts`:

- `load_agent_session(vaultRoot, notePath)`
- `record_agent_turn(input)`
- `record_agent_operation_event(input)`
- `load_last_agent_undo_snapshot(vaultRoot, notePath)`
- `clear_last_agent_undo_snapshot(vaultRoot, notePath)`

Use these names unless an implementation conflict requires a small naming adjustment.

### Agent Domain Layer

Extend `src/features/agent/` with session and review helpers:

```text
src/features/agent/
  agentSessionTypes.ts
  agentReviewPlan.ts
  agentReviewPlan.test.ts
  agentSessionSummary.ts
```

Keep the existing files:

- `agentTypes.ts`
- `agentParser.ts`
- `agentPrompts.ts`
- `applyAgentOperations.ts`
- `NoteAgent.tsx`

The existing `AgentOperation` union remains the LLM contract. A new `ReviewPlan` wraps parsed operations with UI-ready before/after details, risk labels, and apply selection metadata.

### App Ownership Boundary

`NoteAgent.tsx` may load and render sessions, run the LLM, and build review plans. It must not write notes directly.

`App.tsx` remains responsible for:

- applying current-note changes to note state,
- creating notes,
- moving notes when title/category changes,
- writing Markdown to disk,
- updating `notes`, `activePath`, `activeCategory`, `activeView`, `linkVersion`, and status.

This preserves the current local-first state model and avoids split-brain vault writes.

## Data Model

### TypeScript Types

```ts
export interface AgentSession {
  id: string
  notePath: string
  noteTitle: string
  createdAt: string
  updatedAt: string
  turns: AgentTurn[]
  operationEvents: AgentOperationEvent[]
  lastUndoSnapshot?: AgentUndoSnapshot
}

export interface AgentTurn {
  id: string
  sessionId: string
  notePath: string
  command: string
  action?: QuickAgentAction
  prompt: string
  contextSummary: string
  rawResponse: string
  parsedResult?: AgentResult
  status: 'running' | 'ready' | 'applied' | 'discarded' | 'failed'
  error?: string
  createdAt: string
  completedAt?: string
}

export interface AgentOperationEvent {
  id: string
  sessionId: string
  turnId: string
  notePath: string
  operationTypes: string[]
  changedFields: string[]
  createdNotePath?: string
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
  createdNotePath?: string
  createdAt: string
}
```

### Review Plan

```ts
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
  kind: 'metadata' | 'body_append' | 'body_replace' | 'create_note' | 'suggestion' | 'risk'
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

The review plan is derived from the active note and parsed `AgentResult`. It should not mutate note data.

### SQLite Tables

Use a small schema with text JSON where it keeps migrations simple:

```sql
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
```

Retention: keep the latest 20 turns per note session by default. Keep only the latest undo snapshot per note.

## Prompt and Context

`buildAgentPrompt` should include a compact session summary in addition to current note context:

- recent user commands,
- latest agent result summary,
- latest applied changes,
- current note metadata and body excerpt,
- existing categories and tags.

The prompt must still require JSON-only output using the existing `AgentResult` shape. The session summary should be short and should not include full previous raw responses unless needed.

## User Experience

### Right Sidebar Layout

The right sidebar becomes `Note Agent` workbench:

1. Session timeline
   - Shows recent turns and applied events for the active note.
   - Keeps entries compact: command, short result, status, timestamp.
   - Allows expanding a turn to inspect prompt/context/raw response for debugging.

2. Running stages
   - `Preparing context`
   - `Requesting model`
   - `Receiving response`
   - `Parsing plan`
   - `Ready for review`

3. Review plan
   - Groups operations by impact:
     - metadata changes,
     - body append,
     - body replacement,
     - new note draft,
     - suggestions,
     - risk/impact warnings.
   - Shows before/after for metadata.
   - Collapses long Markdown previews by default.
   - Lets the user select applicable groups.

4. Composer
   - Natural-language command input remains at the bottom.
   - Quick actions become task presets and record their action type in the session.
   - Failed runs keep the command text.

5. Footer actions
   - `Apply selected`
   - `Discard`
   - `Undo last apply`

### Apply Rules

- Suggestions cannot be applied directly unless represented by a write operation.
- Metadata updates and body appends can be selected by default.
- Body replacement requires explicit confirmation.
- Title/category changes must show a path movement warning.
- Applying current-note operations must use the normal save path calculation and `moveNote` behavior when needed.
- Create-note operations remain one note at a time.

### Undo Rules

Undo is intentionally narrow:

- Only undo the last agent apply for the active note.
- Restore the previous Markdown content and previous path from `AgentUndoSnapshot`.
- The first slice supports undo for current-note write operations only.
- If the last agent apply created a note, show "Undo is not available for created notes yet" and leave the snapshot untouched.
- Undo records a status message and clears the used snapshot.

Create-note undo can be designed later with a safe deletion check, but it is out of scope for this slice.

## Error Handling

- Missing API key: show settings guidance and keep the command.
- LLM request failed: record a failed turn with the error and keep the command.
- Invalid JSON: record a failed turn with raw response available for debugging.
- Unsupported operation: reject the plan and show the unsupported operation.
- Storage failure: continue with in-memory UI for the current turn and show a persistence warning.
- Apply failure: keep the review plan visible and do not record an applied event.
- Undo failure: keep the snapshot and show the error.

## Implementation Notes

- Prefer a small `AgentSessionStore` in Rust rather than overloading `UserSettingsStore`.
- Add commands to `src-tauri/src/lib.rs` command registration.
- Add `AgentSession`, `AgentTurn`, `ReviewPlan`, and related types in TypeScript.
- Keep `agentParser.ts` strict. Do not relax schema validation to compensate for model output.
- Add `buildReviewPlan(note, result)` as a pure function.
- Update `applyCurrentNoteOperations` or a new wrapper so selected review groups map back to operations.
- Extract shared path-save logic from `saveActiveNote` so agent apply and manual save use the same path movement behavior.
- Keep process log as an expandable developer/debug detail, not the primary status view.

## Testing

### Rust Tests

- `AgentSessionStore` creates schema in `.inote/agent.sqlite3`.
- Loading a missing note session returns an empty session object or `None`.
- Recording a turn round-trips command, status, raw response, and parsed result JSON.
- Recording operation events round-trips changed fields and operation types.
- Undo snapshot is stored and only the latest snapshot is returned.
- Retention keeps the latest 20 turns for a note.

### TypeScript Tests

- `buildReviewPlan` groups metadata, body append, body replace, create note, and suggestions.
- Metadata review items show before/after values.
- Body replacement is marked high risk and requires confirmation.
- Title/category changes include path movement warning.
- Existing parser tests continue to pass.
- Session summary includes recent commands and applied events without full raw response bloat.

### App Integration Tests

- Note Agent is rendered in the right sidebar.
- Switching active notes loads the matching persisted session.
- Applying title/category changes uses the same move behavior as manual save.
- Applying a plan records an operation event and undo snapshot.
- Undo restores the previous current-note content for the active note.

## Acceptance Criteria

- A user can reopen a note and see its recent Note Agent session.
- A user can run a follow-up command that benefits from recent session context.
- A user can review grouped diffs before applying changes.
- A user can apply selected current-note changes and see an applied event in the timeline.
- A user can undo the last current-note agent apply.
- Title/category agent changes do not leave the file at a stale path.
- LLM output still cannot bypass schema validation or user confirmation.
