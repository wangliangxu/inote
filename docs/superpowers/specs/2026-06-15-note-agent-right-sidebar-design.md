# Note Agent Right Sidebar Design

## Purpose

Redesign the existing right sidebar from a read-only LLM assistant into a note agent that can safely update the currently opened note and create new notes from user instructions.

The agent should preserve iNote's local-first, Markdown-first model. Markdown files remain the durable source of truth, and AI output is treated as a proposed edit plan that the user can review before it is written to disk.

## Current Context

The current right sidebar renders `LlmAssistant` from `src/features/llm/LlmAssistant.tsx`. It can send scoped context to the configured LLM provider and display a result, but it cannot write changes back to a note.

The app already has the primitives needed for a safe agent:

- `Note` in `src/shared/types.ts` models core frontmatter fields: `title`, `category`, `tags`, `createdAt`, `updatedAt`, `due`, `status`, `priority`, `project`, `summary`, and `body`.
- `noteToMarkdown` serializes a `Note` back to Markdown with YAML frontmatter.
- `writeNote`, `createNote`, `createInboxNote`, and `moveNote` provide the Tauri-backed vault operations.
- `App.tsx` already owns active note state, dirty state, save state, note creation, note movement, and vault refresh behavior.
- The editor metadata panel already updates the same fields manually, so the agent should use the same data model instead of introducing a second YAML editing path.

## Selected Approach

Use a review-first agent: the LLM returns structured operations, the UI previews those operations, and the user explicitly applies them.

This is preferred over a pure chat assistant because it gives the agent real editing power without silently mutating user files. It is also preferred over direct Markdown replacement because it lets the app validate metadata fields, normalize tags, preserve existing note state, and reuse the existing save pipeline.

## Alternatives Considered

1. Chat-only assistant with copy buttons.
   This is low risk, but it does not satisfy the requirement that the sidebar can update tags, YAML data, and create notes.

2. Direct Markdown patch assistant.
   This is flexible, but it is fragile around YAML formatting, note paths, dirty state, and existing editor behavior.

3. Structured operation agent.
   This is the recommended approach. It keeps the first version bounded, testable, and safe while still allowing meaningful note automation.

## User Experience

The right sidebar becomes `Note Agent`.

It contains four areas:

1. Agent command.
   A compact prompt input where the user can describe the desired action in natural language.

2. Quick actions.
   Buttons for common workflows:
   - Summarize current note
   - Suggest tags
   - Clean metadata
   - Extract tasks
   - Continue writing
   - Create related note

3. Proposed changes.
   A review panel that groups changes by target:
   - Current note metadata
   - Current note body
   - New note draft
   - Status or validation messages

4. Action footer.
   Contextual buttons:
   - `Run`
   - `Apply`
   - `Create note`
   - `Insert into note`
   - `Discard`

The agent should not auto-apply LLM output. Every write-capable result must pass through the proposed changes panel first.

## Supported First-Version Commands

The first version should support:

- Updating current note title.
- Updating current note category.
- Updating tags by replacing, adding, or removing tags.
- Updating frontmatter fields: `summary`, `due`, `status`, `priority`, and `project`.
- Replacing the current note body.
- Appending generated content to the current note body.
- Creating a new note with title, category, tags, summary, and body.
- Creating a related note that links back to the current note.
- Generating suggestions without applying them.

The first version should not support:

- Batch editing multiple existing notes.
- Deleting notes.
- Moving files to arbitrary paths through LLM output.
- Writing unknown YAML keys.
- Running commands outside the vault API.
- Applying changes without user confirmation.

## Operation Model

The LLM should return JSON that conforms to a small operation schema.

```ts
type AgentResult = {
  message: string
  operations: AgentOperation[]
}

type AgentOperation =
  | {
      type: 'update_current_note'
      patch: NotePatch
    }
  | {
      type: 'append_to_current_note'
      markdown: string
    }
  | {
      type: 'replace_current_note_body'
      markdown: string
    }
  | {
      type: 'create_note'
      note: NewNoteDraft
    }
  | {
      type: 'suggest_only'
      markdown: string
    }

type NotePatch = {
  title?: string
  category?: string
  tags?: string[]
  summary?: string
  due?: string
  status?: 'todo' | 'in_progress' | 'done' | 'cancelled'
  priority?: 'none' | 'low' | 'medium' | 'high'
  project?: string
}

type NewNoteDraft = {
  title: string
  category: string
  tags?: string[]
  summary?: string
  body: string
  linkBackToCurrent?: boolean
}
```

The parser should reject malformed JSON, unknown operation types, unsupported metadata fields, invalid status or priority values, empty note titles, empty categories, and non-array tags.

## Data Flow

```text
User command
  -> NoteAgent builds scoped prompt
  -> executeLlmChat
  -> parse and validate AgentResult JSON
  -> render proposed changes
  -> user applies approved operations
  -> App applies operations to Note objects
  -> noteToMarkdown
  -> writeNote or createNote
  -> update notes state, activePath, activeCategory, linkVersion, and status
```

The agent context should include:

- Current note title, path, category, tags, dates, optional task metadata, summary, and body.
- A compact list of existing categories.
- A compact list of existing tags.
- A compact list of nearby notes only when useful for the selected quick action.

The agent should not send the entire vault by default.

## Frontend Architecture

Add a new feature module:

```text
src/features/agent/
  NoteAgent.tsx
  agentTypes.ts
  agentPrompts.ts
  agentParser.ts
  applyAgentOperations.ts
  NoteAgent.test.tsx
  agentParser.test.ts
  applyAgentOperations.test.ts
```

`NoteAgent.tsx` owns UI state: command text, running state, parser errors, proposed result, and selected quick action.

`agentPrompts.ts` builds the system and user prompts. It must instruct the model to return JSON only, with no Markdown wrapper.

`agentParser.ts` converts raw LLM text into validated `AgentResult`.

`applyAgentOperations.ts` is a pure helper that takes the current note and validated operations, then returns an application plan. The actual disk write remains in `App.tsx` so the top-level app continues to own vault state.

`App.tsx` should replace the current `LlmAssistant` render with `NoteAgent`, passing callbacks for:

- Applying current-note updates.
- Creating an agent-proposed note.
- Saving the active note.
- Reporting app status.

## Applying Current Note Updates

Current-note updates should update React note state first, mark the note dirty, and then let the existing save flow write to disk. For operations triggered from the agent's `Apply` button, the app may save immediately after applying the patch because the user has explicitly confirmed the generated plan.

When the patch changes `title` or `category`, the existing save behavior may rename or move the Markdown file to match the app's filename convention. The proposed changes panel must make this visible by showing that title or category changes may affect the path after save.

Tag handling should match the editor metadata input:

- Trim whitespace.
- Remove a leading `#`.
- Drop empty values.
- De-duplicate while preserving first occurrence order.

## Creating Notes

The first implementation should create notes through existing APIs rather than adding backend commands.

Creation flow:

1. Validate the new note draft.
2. Call `createNote` with title and category.
3. Merge the returned note with agent-proposed tags, summary, and body.
4. Write the merged note through `writeNote`.
5. Add the saved note to state and select it.

If `linkBackToCurrent` is true and there is an active note, the created body should include a backlink such as `Related: [[Current Title]]`.

## Error Handling

The agent should expose concise, recoverable errors:

- Missing API key: show the existing settings guidance.
- LLM request failed: show provider error and keep the prompt text.
- Invalid JSON: show that the model returned an unreadable plan and allow rerun.
- Unsupported operation: show the unsupported operation name.
- Validation failure: show the exact field that failed validation.
- Disk write failure: preserve proposed changes and show the Tauri error.

If applying several operations and one fails, no remaining disk writes should continue. For the first version, operations should be limited so a single `Apply` affects either the current note or one new note, not both.

## Styling

The design should keep the existing compact desktop-tool feel:

- Use the existing right sidebar width and resize behavior.
- Use icon buttons for quick actions and footer commands.
- Keep text dense and scannable.
- Avoid card-in-card layouts.
- Make proposed changes visually distinct from chat output.
- Keep all buttons and labels fitting within the narrow sidebar at 220px minimum width.

## Testing

Add focused tests for:

- Parsing valid agent JSON.
- Rejecting malformed or unsupported agent JSON.
- Normalizing tags from agent output.
- Applying metadata patches to a note without mutating the original object.
- Appending generated Markdown to an existing body.
- Creating a new note draft with validated title and category.

Add app-level tests where practical:

- Applying a current-note patch marks the active note dirty or saves it.
- Creating an agent note adds it to the note list and selects it.
- Agent errors do not clear the user's command text or proposed changes.

Manual verification should cover:

- Run without an API key.
- Suggest tags for the current note.
- Apply metadata changes and verify YAML output.
- Create a related note and verify path, body, tags, and backlink.
- Resize the right sidebar to its minimum and maximum widths.

## Acceptance Criteria

The work is complete when:

- The right sidebar is labeled and behaves as a Note Agent.
- The agent can propose metadata updates for the current note.
- The agent can apply approved changes to tags and supported YAML fields.
- The agent can create a new note from an approved draft.
- Every write-capable operation has a visible preview and explicit user confirmation.
- Invalid model output is handled without corrupting note state.
- Existing note save, dirty state, search index refresh, and active note selection continue to work.
