# Note Agent Right Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the read-only right sidebar assistant with a review-first Note Agent that can propose and apply current-note metadata/body changes and create new notes.

**Architecture:** Add a focused `src/features/agent/` module for schemas, parsing, prompt building, pure operation application, and the sidebar UI. Keep disk writes and global vault state in `App.tsx`, where note creation, saving, active selection, and status already live.

**Tech Stack:** React 18, TypeScript, Vitest, Tauri command wrappers from `src/shared/api.ts`, lucide-react icons.

---

## File Structure

- Create `src/features/agent/agentTypes.ts`
  Defines the structured agent result schema, operation union, validated metadata patch type, and UI callback types.

- Create `src/features/agent/agentParser.ts`
  Parses raw LLM output, extracts JSON, validates operation shape, normalizes tags, and returns typed `AgentResult`.

- Create `src/features/agent/agentParser.test.ts`
  Covers valid JSON, fenced JSON, malformed output, unsupported fields, invalid enum values, empty titles/categories, and tag normalization.

- Create `src/features/agent/applyAgentOperations.ts`
  Pure functions that convert validated operations into note patches, appended body changes, replaced body changes, and new note drafts without mutating inputs.

- Create `src/features/agent/applyAgentOperations.test.ts`
  Covers metadata patches, append/replace behavior, create-note drafts, unsupported mixed write operations, and immutability.

- Create `src/features/agent/agentPrompts.ts`
  Builds JSON-only prompts with current note context, category/tag hints, and quick-action instructions.

- Create `src/features/agent/agentPrompts.test.ts`
  Covers JSON-only instructions, scoped context, category/tag inclusion, and quick-action command text.

- Create `src/features/agent/NoteAgent.tsx`
  Renders command input, quick actions, proposed changes, error states, and apply/create/discard controls.

- Modify `src/app/App.tsx`
  Replace `LlmAssistant` with `NoteAgent`; add callbacks that apply current-note operations, create agent notes through existing APIs, save applied current-note changes, update `linkVersion`, and set status.

- Modify `src/app/styles.css`
  Add compact Note Agent layout, proposed-change rows, error state, and footer button styles that fit the existing right sidebar.

- Add or modify `src/app/noteAgentIntegration.test.ts`
  Static integration tests for importing/rendering `NoteAgent` and wiring apply/create callbacks without adding a React testing dependency.

---

### Task 1: Agent Types and Parser

**Files:**
- Create: `src/features/agent/agentTypes.ts`
- Create: `src/features/agent/agentParser.ts`
- Test: `src/features/agent/agentParser.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `src/features/agent/agentParser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseAgentResult } from './agentParser'

describe('parseAgentResult', () => {
  it('parses valid current-note metadata updates', () => {
    const result = parseAgentResult(JSON.stringify({
      message: 'I will update the metadata.',
      operations: [
        {
          type: 'update_current_note',
          patch: {
            title: 'Research Log',
            tags: ['#ai', ' research ', 'ai'],
            summary: 'A compact research summary.',
            status: 'in_progress',
            priority: 'high',
          },
        },
      ],
    }))

    expect(result.message).toBe('I will update the metadata.')
    expect(result.operations).toEqual([
      {
        type: 'update_current_note',
        patch: {
          title: 'Research Log',
          tags: ['ai', 'research'],
          summary: 'A compact research summary.',
          status: 'in_progress',
          priority: 'high',
        },
      },
    ])
  })

  it('parses JSON inside a fenced code block', () => {
    const result = parseAgentResult('```json\n{"message":"ok","operations":[{"type":"suggest_only","markdown":"- tag: ai"}]}\n```')

    expect(result.operations).toEqual([{ type: 'suggest_only', markdown: '- tag: ai' }])
  })

  it('rejects malformed JSON', () => {
    expect(() => parseAgentResult('not json')).toThrow('Agent response was not valid JSON.')
  })

  it('rejects unsupported operation types', () => {
    expect(() => parseAgentResult(JSON.stringify({
      message: 'bad',
      operations: [{ type: 'delete_note', path: 'x.md' }],
    }))).toThrow('Unsupported agent operation: delete_note.')
  })

  it('rejects unsupported patch fields', () => {
    expect(() => parseAgentResult(JSON.stringify({
      message: 'bad',
      operations: [{ type: 'update_current_note', patch: { custom: 'x' } }],
    }))).toThrow('Unsupported note patch field: custom.')
  })

  it('rejects invalid status and priority values', () => {
    expect(() => parseAgentResult(JSON.stringify({
      message: 'bad',
      operations: [{ type: 'update_current_note', patch: { status: 'blocked' } }],
    }))).toThrow('Invalid status: blocked.')

    expect(() => parseAgentResult(JSON.stringify({
      message: 'bad',
      operations: [{ type: 'update_current_note', patch: { priority: 'urgent' } }],
    }))).toThrow('Invalid priority: urgent.')
  })

  it('rejects empty created note titles and categories', () => {
    expect(() => parseAgentResult(JSON.stringify({
      message: 'bad',
      operations: [{ type: 'create_note', note: { title: '', category: 'knowledge', body: 'Body' } }],
    }))).toThrow('New note title is required.')

    expect(() => parseAgentResult(JSON.stringify({
      message: 'bad',
      operations: [{ type: 'create_note', note: { title: 'New', category: ' ', body: 'Body' } }],
    }))).toThrow('New note category is required.')
  })
})
```

- [ ] **Step 2: Run parser tests to verify they fail**

Run: `npm test -- src/features/agent/agentParser.test.ts --run`

Expected: FAIL because `src/features/agent/agentParser.ts` does not exist.

- [ ] **Step 3: Implement parser types and validation**

Create `src/features/agent/agentTypes.ts`:

```ts
import type { Note } from '../../shared/types'

export type QuickAgentAction = 'summarize' | 'suggest_tags' | 'clean_metadata' | 'extract_tasks' | 'continue_writing' | 'create_related'

export interface AgentResult {
  message: string
  operations: AgentOperation[]
}

export type AgentOperation =
  | { type: 'update_current_note', patch: NotePatch }
  | { type: 'append_to_current_note', markdown: string }
  | { type: 'replace_current_note_body', markdown: string }
  | { type: 'create_note', note: NewNoteDraft }
  | { type: 'suggest_only', markdown: string }

export type NotePatch = Partial<Pick<Note, 'title' | 'category' | 'tags' | 'summary' | 'due' | 'status' | 'priority' | 'project'>>

export interface NewNoteDraft {
  title: string
  category: string
  tags?: string[]
  summary?: string
  body: string
  linkBackToCurrent?: boolean
}

export interface AppliedCurrentNoteChange {
  note: Note
  changedFields: string[]
}
```

Create `src/features/agent/agentParser.ts`:

```ts
import type { AgentOperation, AgentResult, NewNoteDraft, NotePatch } from './agentTypes'

const allowedPatchFields = new Set(['title', 'category', 'tags', 'summary', 'due', 'status', 'priority', 'project'])
const allowedStatuses = new Set(['todo', 'in_progress', 'done', 'cancelled'])
const allowedPriorities = new Set(['none', 'low', 'medium', 'high'])

export function normalizeAgentTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Tags must be an array.')
  }

  const tags: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error('Tags must be strings.')
    }
    const tag = item.trim().replace(/^#/, '')
    if (tag && !tags.includes(tag)) {
      tags.push(tag)
    }
  }
  return tags
}

export function parseAgentResult(raw: string): AgentResult {
  const parsed = parseJsonObject(raw)
  const message = typeof parsed.message === 'string' ? parsed.message : ''
  if (!Array.isArray(parsed.operations)) {
    throw new Error('Agent response must include an operations array.')
  }

  return {
    message,
    operations: parsed.operations.map(validateOperation),
  }
}

function parseJsonObject(raw: string): any {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const candidate = fenced ? fenced[1].trim() : trimmed
  try {
    const parsed = JSON.parse(candidate)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('object')
    }
    return parsed
  } catch {
    throw new Error('Agent response was not valid JSON.')
  }
}

function validateOperation(value: any): AgentOperation {
  if (!value || typeof value !== 'object') {
    throw new Error('Agent operation must be an object.')
  }

  if (value.type === 'update_current_note') {
    return { type: value.type, patch: validatePatch(value.patch) }
  }
  if (value.type === 'append_to_current_note' || value.type === 'replace_current_note_body' || value.type === 'suggest_only') {
    if (typeof value.markdown !== 'string') {
      throw new Error(`${value.type} requires markdown text.`)
    }
    return { type: value.type, markdown: value.markdown }
  }
  if (value.type === 'create_note') {
    return { type: value.type, note: validateNewNote(value.note) }
  }

  throw new Error(`Unsupported agent operation: ${String(value.type)}.`)
}

function validatePatch(value: any): NotePatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Current note update requires a patch object.')
  }

  const patch: NotePatch = {}
  for (const key of Object.keys(value)) {
    if (!allowedPatchFields.has(key)) {
      throw new Error(`Unsupported note patch field: ${key}.`)
    }
  }

  for (const key of ['title', 'category', 'summary', 'due', 'status', 'priority', 'project'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`${key} must be a string.`)
    }
  }

  if (value.status !== undefined && !allowedStatuses.has(value.status)) {
    throw new Error(`Invalid status: ${value.status}.`)
  }
  if (value.priority !== undefined && !allowedPriorities.has(value.priority)) {
    throw new Error(`Invalid priority: ${value.priority}.`)
  }
  if (value.title !== undefined) patch.title = value.title.trim()
  if (value.category !== undefined) patch.category = value.category.trim().replace(/^\/+|\/+$/g, '')
  if (value.tags !== undefined) patch.tags = normalizeAgentTags(value.tags)
  if (value.summary !== undefined) patch.summary = value.summary.trim()
  if (value.due !== undefined) patch.due = value.due.trim()
  if (value.status !== undefined) patch.status = value.status
  if (value.priority !== undefined) patch.priority = value.priority
  if (value.project !== undefined) patch.project = value.project.trim()

  return patch
}

function validateNewNote(value: any): NewNoteDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Create note requires a note object.')
  }
  if (typeof value.title !== 'string' || !value.title.trim()) {
    throw new Error('New note title is required.')
  }
  if (typeof value.category !== 'string' || !value.category.trim()) {
    throw new Error('New note category is required.')
  }
  if (typeof value.body !== 'string') {
    throw new Error('New note body is required.')
  }

  return {
    title: value.title.trim(),
    category: value.category.trim().replace(/^\/+|\/+$/g, ''),
    tags: value.tags === undefined ? undefined : normalizeAgentTags(value.tags),
    summary: typeof value.summary === 'string' ? value.summary.trim() : undefined,
    body: value.body,
    linkBackToCurrent: value.linkBackToCurrent === true,
  }
}
```

- [ ] **Step 4: Run parser tests to verify they pass**

Run: `npm test -- src/features/agent/agentParser.test.ts --run`

Expected: PASS.

- [ ] **Step 5: Commit parser**

```bash
git add src/features/agent/agentTypes.ts src/features/agent/agentParser.ts src/features/agent/agentParser.test.ts
git commit -m "feat(agent): validate structured note operations"
```

---

### Task 2: Pure Operation Application

**Files:**
- Create: `src/features/agent/applyAgentOperations.ts`
- Test: `src/features/agent/applyAgentOperations.test.ts`

- [ ] **Step 1: Write failing apply tests**

Create `src/features/agent/applyAgentOperations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Note } from '../../shared/types'
import { applyCurrentNoteOperations, getCreateNoteDraft } from './applyAgentOperations'

const baseNote: Note = {
  path: 'knowledge/old.md',
  title: 'Old',
  category: 'knowledge',
  tags: ['old'],
  createdAt: '2026-06-10',
  updatedAt: '2026-06-10',
  body: '# Old\n\nBody.',
  wordCount: 3,
}

describe('applyCurrentNoteOperations', () => {
  it('applies metadata patches without mutating the input note', () => {
    const result = applyCurrentNoteOperations(baseNote, [
      { type: 'update_current_note', patch: { title: 'New', tags: ['ai'], summary: 'Summary' } },
    ], '2026-06-15')

    expect(result.note).toMatchObject({
      title: 'New',
      tags: ['ai'],
      summary: 'Summary',
      updatedAt: '2026-06-15',
      isDirty: true,
    })
    expect(result.changedFields).toEqual(['title', 'tags', 'summary'])
    expect(baseNote.title).toBe('Old')
  })

  it('appends generated markdown to the current body', () => {
    const result = applyCurrentNoteOperations(baseNote, [
      { type: 'append_to_current_note', markdown: '## Follow-up\n\nNext.' },
    ], '2026-06-15')

    expect(result.note.body).toBe('# Old\n\nBody.\n\n## Follow-up\n\nNext.')
    expect(result.note.wordCount).toBe(6)
  })

  it('replaces the current body', () => {
    const result = applyCurrentNoteOperations(baseNote, [
      { type: 'replace_current_note_body', markdown: '# New\n\nReplacement body.' },
    ], '2026-06-15')

    expect(result.note.body).toBe('# New\n\nReplacement body.')
    expect(result.changedFields).toEqual(['body'])
  })

  it('rejects create-note and suggest-only operations for current-note apply', () => {
    expect(() => applyCurrentNoteOperations(baseNote, [
      { type: 'create_note', note: { title: 'New', category: 'knowledge', body: 'Body' } },
    ], '2026-06-15')).toThrow('Apply current note can only use current-note operations.')

    expect(() => applyCurrentNoteOperations(baseNote, [
      { type: 'suggest_only', markdown: '- keep' },
    ], '2026-06-15')).toThrow('Apply current note can only use current-note operations.')
  })
})

describe('getCreateNoteDraft', () => {
  it('returns a single create-note draft', () => {
    const draft = getCreateNoteDraft([
      { type: 'create_note', note: { title: 'Related', category: 'knowledge/ai', tags: ['ai'], body: '# Related' } },
    ])

    expect(draft).toEqual({ title: 'Related', category: 'knowledge/ai', tags: ['ai'], body: '# Related' })
  })

  it('rejects missing or mixed create-note operations', () => {
    expect(() => getCreateNoteDraft([])).toThrow('Agent result does not contain a note draft.')
    expect(() => getCreateNoteDraft([
      { type: 'create_note', note: { title: 'A', category: 'knowledge', body: 'A' } },
      { type: 'create_note', note: { title: 'B', category: 'knowledge', body: 'B' } },
    ])).toThrow('Only one note can be created at a time.')
  })
})
```

- [ ] **Step 2: Run apply tests to verify they fail**

Run: `npm test -- src/features/agent/applyAgentOperations.test.ts --run`

Expected: FAIL because `applyAgentOperations.ts` does not exist.

- [ ] **Step 3: Implement pure operation application**

Create `src/features/agent/applyAgentOperations.ts`:

```ts
import type { Note } from '../../shared/types'
import type { AgentOperation, AppliedCurrentNoteChange, NewNoteDraft } from './agentTypes'

export function applyCurrentNoteOperations(note: Note, operations: AgentOperation[], today: string): AppliedCurrentNoteChange {
  const changedFields: string[] = []
  let next: Note = { ...note, tags: [...note.tags] }

  for (const operation of operations) {
    if (operation.type === 'update_current_note') {
      for (const [field, value] of Object.entries(operation.patch)) {
        ;(next as any)[field] = Array.isArray(value) ? [...value] : value
        changedFields.push(field)
      }
    } else if (operation.type === 'append_to_current_note') {
      next.body = appendMarkdown(next.body, operation.markdown)
      changedFields.push('body')
    } else if (operation.type === 'replace_current_note_body') {
      next.body = operation.markdown
      changedFields.push('body')
    } else {
      throw new Error('Apply current note can only use current-note operations.')
    }
  }

  const uniqueChangedFields = changedFields.filter((field, index, all) => all.indexOf(field) === index)
  next = {
    ...next,
    updatedAt: today,
    wordCount: countWords(next.body),
    isDirty: true,
  }

  return { note: next, changedFields: uniqueChangedFields }
}

export function getCreateNoteDraft(operations: AgentOperation[]): NewNoteDraft {
  const createOperations = operations.filter((operation): operation is Extract<AgentOperation, { type: 'create_note' }> => operation.type === 'create_note')
  if (createOperations.length === 0) {
    throw new Error('Agent result does not contain a note draft.')
  }
  if (createOperations.length > 1 || createOperations.length !== operations.length) {
    throw new Error('Only one note can be created at a time.')
  }
  return createOperations[0].note
}

export function hasCurrentNoteWrite(operations: AgentOperation[]): boolean {
  return operations.some((operation) =>
    operation.type === 'update_current_note' ||
    operation.type === 'append_to_current_note' ||
    operation.type === 'replace_current_note_body'
  )
}

export function hasCreateNoteWrite(operations: AgentOperation[]): boolean {
  return operations.some((operation) => operation.type === 'create_note')
}

function appendMarkdown(body: string, markdown: string): string {
  const left = body.trimEnd()
  const right = markdown.trim()
  if (!left) return right
  if (!right) return left
  return `${left}\n\n${right}`
}

function countWords(body: string): number {
  return body.trim() ? body.trim().split(/\s+/).length : 0
}
```

- [ ] **Step 4: Run apply tests to verify they pass**

Run: `npm test -- src/features/agent/applyAgentOperations.test.ts --run`

Expected: PASS.

- [ ] **Step 5: Commit operation application**

```bash
git add src/features/agent/applyAgentOperations.ts src/features/agent/applyAgentOperations.test.ts
git commit -m "feat(agent): apply note agent operations"
```

---

### Task 3: Prompt Builder

**Files:**
- Create: `src/features/agent/agentPrompts.ts`
- Test: `src/features/agent/agentPrompts.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Create `src/features/agent/agentPrompts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Note } from '../../shared/types'
import { buildAgentPrompt } from './agentPrompts'

const note: Note = {
  path: 'knowledge/ai.md',
  title: 'AI Notes',
  category: 'knowledge',
  tags: ['ai'],
  createdAt: '2026-06-10',
  updatedAt: '2026-06-12',
  body: '# AI Notes\n\nLocal-first notes.',
  wordCount: 4,
}

describe('buildAgentPrompt', () => {
  it('requires JSON-only operation output', () => {
    const prompt = buildAgentPrompt({
      command: 'suggest tags',
      note,
      notes: [note],
      action: 'suggest_tags',
    })

    expect(prompt.prompt).toContain('Return only valid JSON')
    expect(prompt.prompt).toContain('"operations"')
    expect(prompt.context).toContain('Current note:')
    expect(prompt.context).toContain('AI Notes')
  })

  it('includes compact category and tag hints', () => {
    const prompt = buildAgentPrompt({
      command: 'create related note',
      note,
      notes: [
        note,
        { ...note, path: 'projects/app.md', category: 'projects', tags: ['inote', 'ai'] },
      ],
      action: 'create_related',
    })

    expect(prompt.context).toContain('Existing categories: knowledge, projects')
    expect(prompt.context).toContain('Existing tags: ai, inote')
    expect(prompt.prompt).toContain('Create a related note')
  })
})
```

- [ ] **Step 2: Run prompt tests to verify they fail**

Run: `npm test -- src/features/agent/agentPrompts.test.ts --run`

Expected: FAIL because `agentPrompts.ts` does not exist.

- [ ] **Step 3: Implement prompt builder**

Create `src/features/agent/agentPrompts.ts`:

```ts
import type { Note } from '../../shared/types'
import type { QuickAgentAction } from './agentTypes'

interface BuildAgentPromptInput {
  command: string
  note: Note
  notes: Note[]
  action?: QuickAgentAction
}

export function buildAgentPrompt({ command, note, notes, action }: BuildAgentPromptInput): { prompt: string, context: string } {
  return {
    prompt: [
      'You are iNote Note Agent. Return only valid JSON and no Markdown wrapper.',
      'The JSON shape is {"message":"short user-facing summary","operations":[...]}',
      'Allowed operation types are update_current_note, append_to_current_note, replace_current_note_body, create_note, and suggest_only.',
      'Allowed current-note patch fields are title, category, tags, summary, due, status, priority, and project.',
      actionInstruction(action),
      `User command: ${command.trim() || actionInstruction(action)}`,
    ].filter(Boolean).join('\n'),
    context: [
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
      note.body.slice(0, 6000),
    ].filter((line) => line !== '').join('\n'),
  }
}

function actionInstruction(action?: QuickAgentAction): string {
  if (action === 'summarize') return 'Summarize the note by updating summary or returning suggest_only markdown.'
  if (action === 'suggest_tags') return 'Suggest concise tags. Use update_current_note when the user asks to apply tags.'
  if (action === 'clean_metadata') return 'Clean title, tags, summary, status, priority, project, due, or category only.'
  if (action === 'extract_tasks') return 'Extract tasks as Markdown that can be appended to the current note.'
  if (action === 'continue_writing') return 'Continue the current note with append_to_current_note.'
  if (action === 'create_related') return 'Create a related note with create_note and set linkBackToCurrent true.'
  return 'Follow the user command using the smallest safe operation set.'
}

function unique(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).sort((a, b) => a.localeCompare(b))
}
```

- [ ] **Step 4: Run prompt tests to verify they pass**

Run: `npm test -- src/features/agent/agentPrompts.test.ts --run`

Expected: PASS.

- [ ] **Step 5: Commit prompt builder**

```bash
git add src/features/agent/agentPrompts.ts src/features/agent/agentPrompts.test.ts
git commit -m "feat(agent): build scoped note prompts"
```

---

### Task 4: Note Agent Sidebar UI

**Files:**
- Create: `src/features/agent/NoteAgent.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add static UI integration expectations**

Create `src/app/noteAgentIntegration.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('note agent integration', () => {
  it('renders NoteAgent in the right sidebar instead of LlmAssistant', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toContain('NoteAgent')
    expect(app).not.toContain('const LlmAssistant')
    expect(app).not.toContain('<LlmAssistant')
  })

  it('has dedicated Note Agent styles', () => {
    const styles = readFileSync(resolve(__dirname, './styles.css'), 'utf8')

    expect(styles).toContain('.note-agent')
    expect(styles).toContain('.agent-change-list')
    expect(styles).toContain('.agent-footer')
  })
})
```

- [ ] **Step 2: Run integration test to verify it fails**

Run: `npm test -- src/app/noteAgentIntegration.test.ts --run`

Expected: FAIL because `App.tsx` still imports and renders `LlmAssistant`.

- [ ] **Step 3: Create the NoteAgent component**

Create `src/features/agent/NoteAgent.tsx` with these behaviors:

```ts
import { useMemo, useState } from 'react'
import { FilePlus2, ListChecks, Plus, RefreshCw, Send, Sparkles, Tags, Wand2, X } from 'lucide-react'
import { executeLlmChat } from '../../shared/api'
import type { LlmProviderSettings, Note } from '../../shared/types'
import { buildAgentPrompt } from './agentPrompts'
import { parseAgentResult } from './agentParser'
import { hasCreateNoteWrite, hasCurrentNoteWrite } from './applyAgentOperations'
import type { AgentResult, QuickAgentAction } from './agentTypes'

interface NoteAgentProps {
  note: Note
  notes: Note[]
  settings: LlmProviderSettings
  onApplyCurrentNote: (result: AgentResult) => Promise<void>
  onCreateNote: (result: AgentResult) => Promise<void>
}

const quickActions: Array<{ action: QuickAgentAction, label: string, icon: typeof Sparkles, command: string }> = [
  { action: 'summarize', label: 'Summary', icon: Sparkles, command: 'Update the summary for the current note.' },
  { action: 'suggest_tags', label: 'Tags', icon: Tags, command: 'Suggest and apply concise tags for the current note.' },
  { action: 'clean_metadata', label: 'YAML', icon: Wand2, command: 'Clean the current note metadata.' },
  { action: 'extract_tasks', label: 'Tasks', icon: ListChecks, command: 'Extract action items and append them to the current note.' },
  { action: 'continue_writing', label: 'Continue', icon: RefreshCw, command: 'Continue writing the current note.' },
  { action: 'create_related', label: 'Related', icon: FilePlus2, command: 'Create a related note that links back to the current note.' },
]

export function NoteAgent({ note, notes, settings, onApplyCurrentNote, onCreateNote }: NoteAgentProps) {
  const [command, setCommand] = useState('Update tags and summary for this note.')
  const [activeAction, setActiveAction] = useState<QuickAgentAction | undefined>()
  const [result, setResult] = useState<AgentResult | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'applying' | 'error'>('idle')
  const [error, setError] = useState('')

  const canApplyCurrent = useMemo(() => result ? hasCurrentNoteWrite(result.operations) : false, [result])
  const canCreate = useMemo(() => result ? hasCreateNoteWrite(result.operations) : false, [result])

  async function runAgent(nextAction = activeAction, nextCommand = command) {
    setError('')
    setResult(null)
    if (!settings.apiKey.trim()) {
      setStatus('error')
      setError('Add an LLM API key in Settings first.')
      return
    }

    try {
      setStatus('running')
      const request = buildAgentPrompt({ command: nextCommand, note, notes, action: nextAction })
      const response = await executeLlmChat({
        settings,
        prompt: request.prompt,
        context: request.context,
      })
      setResult(parseAgentResult(response.content))
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function applyCurrent() {
    if (!result) return
    setStatus('applying')
    try {
      await onApplyCurrentNote(result)
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function createNote() {
    if (!result) return
    setStatus('applying')
    try {
      await onCreateNote(result)
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="note-agent">
      <div className="scope-pill">Note Agent</div>
      <textarea
        className="agent-command"
        aria-label="Note agent command"
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        placeholder="Ask the agent to update this note or create a new one."
      />
      <div className="agent-quick-actions" aria-label="Quick agent actions">
        {quickActions.map(({ action, label, icon: Icon, command: quickCommand }) => (
          <button
            key={action}
            className={activeAction === action ? 'active' : ''}
            type="button"
            onClick={() => {
              setActiveAction(action)
              setCommand(quickCommand)
            }}
            title={label}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <button className="llm-action" type="button" onClick={() => runAgent()} disabled={status === 'running' || status === 'applying'}>
        <Send size={14} />
        {status === 'running' ? 'Running...' : 'Run agent'}
      </button>
      <p className="panel-title compact">Proposed Changes</p>
      {error ? <p className="agent-error">{error}</p> : null}
      {result ? (
        <div className="agent-change-list">
          <p>{result.message || 'Review the proposed operations before applying.'}</p>
          {result.operations.map((operation, index) => (
            <div className="agent-change" key={`${operation.type}-${index}`}>
              <strong>{operation.type.replace(/_/g, ' ')}</strong>
              <pre>{JSON.stringify(operation, null, 2)}</pre>
            </div>
          ))}
        </div>
      ) : !error ? (
        <p className="agent-empty">Run the agent to preview changes here.</p>
      ) : null}
      <div className="agent-footer">
        <button type="button" onClick={() => setResult(null)} disabled={!result || status === 'applying'} title="Discard">
          <X size={15} />
        </button>
        <button type="button" onClick={applyCurrent} disabled={!canApplyCurrent || status === 'applying'} title="Apply to current note">
          <Plus size={15} />
          <span>Apply</span>
        </button>
        <button type="button" onClick={createNote} disabled={!canCreate || status === 'applying'} title="Create note">
          <FilePlus2 size={15} />
          <span>Create</span>
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add compact styles**

Append focused styles to `src/app/styles.css` near the existing `.llm-box` styles:

```css
.note-agent {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-command {
  min-height: 88px;
  resize: vertical;
}

.agent-quick-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.agent-quick-actions button,
.agent-footer button {
  align-items: center;
  display: inline-flex;
  gap: 6px;
  justify-content: center;
  min-width: 0;
}

.agent-quick-actions button span,
.agent-footer button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-change-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-change {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
}

.agent-change pre {
  margin: 6px 0 0;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
}

.agent-error {
  color: var(--danger);
  font-size: 0.85rem;
  margin: 0;
}

.agent-empty {
  color: var(--muted);
  font-size: 0.85rem;
  margin: 0;
}

.agent-footer {
  display: grid;
  gap: 6px;
  grid-template-columns: 36px 1fr 1fr;
}
```

- [ ] **Step 5: Do not run the static integration test yet**

The static integration test is expected to keep failing until Task 5 wires `NoteAgent` into `App.tsx`.

- [ ] **Step 6: Commit sidebar UI module**

```bash
git add src/features/agent/NoteAgent.tsx src/app/styles.css src/app/noteAgentIntegration.test.ts
git commit -m "feat(agent): add note agent sidebar UI"
```

---

### Task 5: App Integration and Disk Writes

**Files:**
- Modify: `src/app/App.tsx`
- Test: `src/app/noteAgentIntegration.test.ts`

- [ ] **Step 1: Add NoteAgent import and remove LlmAssistant import**

Modify the lazy import section in `src/app/App.tsx`:

```ts
const NoteAgent = lazy(() => import('../features/agent/NoteAgent').then(m => ({ default: m.NoteAgent })))
```

Remove the existing `LlmAssistant` lazy import.

- [ ] **Step 2: Add agent helper imports**

Add imports near the existing shared imports:

```ts
import { applyCurrentNoteOperations, getCreateNoteDraft } from '../features/agent/applyAgentOperations'
import type { AgentResult } from '../features/agent/agentTypes'
```

- [ ] **Step 3: Add apply-current-note callback**

Add this function inside `App` near `saveActiveNote` so it can reuse `activeNote`, `vaultRoot`, and `writeNote`:

```ts
async function applyAgentCurrentNote(result: AgentResult) {
  if (!activeNote || !vaultRoot.trim()) {
    setStatus('Open a real vault before applying agent changes.')
    return
  }

  const applied = applyCurrentNoteOperations(activeNote, result.operations, localDateString())
  setIsSaving(true)
  try {
    const saved = await writeNote({
      vaultRoot: vaultRoot.trim(),
      path: applied.note.path,
      content: noteToMarkdown(applied.note),
    })
    setLinkVersion((current) => current + 1)
    setNotes((current) => current.map((note) => (note.path === activeNote.path ? saved : note)))
    setActiveCategory(saved.category)
    setSaveError(false)
    setStatus(`Agent updated ${applied.changedFields.join(', ') || 'note'}.`)
  } catch (error) {
    setSaveError(true)
    setStatus(error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    setIsSaving(false)
  }
}
```

- [ ] **Step 4: Add create-note callback**

Add this function inside `App` near the existing `addCategoryNote` function:

```ts
async function createAgentNote(result: AgentResult) {
  if (!vaultRoot.trim()) {
    setStatus('Open a real vault before creating notes.')
    return
  }

  const draft = getCreateNoteDraft(result.operations)
  try {
    const created = await createNote({
      vaultRoot: vaultRoot.trim(),
      title: draft.title,
      category: draft.category,
    })
    const backlink = draft.linkBackToCurrent && activeNote ? `\n\nRelated: [[${activeNote.title}]]` : ''
    const noteToSave = {
      ...created,
      tags: draft.tags ?? [],
      summary: draft.summary,
      body: `${draft.body.trimEnd()}${backlink}`,
      updatedAt: localDateString(),
    }
    const saved = await writeNote({
      vaultRoot: vaultRoot.trim(),
      path: created.path,
      content: noteToMarkdown(noteToSave),
    })
    setLinkVersion((current) => current + 1)
    setNotes((current) => [saved, ...current.filter((note) => note.path !== saved.path)])
    setActivePath(saved.path)
    setActiveCategory(saved.category)
    setActiveView('category')
    setSaveError(false)
    setStatus(`Agent created ${saved.path}.`)
  } catch (error) {
    setSaveError(true)
    setStatus(error instanceof Error ? error.message : String(error))
    throw error
  }
}
```

- [ ] **Step 5: Render NoteAgent in the right sidebar**

Replace the existing `LlmAssistant` render block in the right sidebar with:

```tsx
<Suspense fallback={<div className="empty">Loading note agent...</div>}>
  <NoteAgent
    note={activeNote}
    notes={notes}
    settings={llmSettings}
    onApplyCurrentNote={applyAgentCurrentNote}
    onCreateNote={createAgentNote}
  />
</Suspense>
```

Keep the enclosing section title as:

```tsx
<p className="panel-title">
  <Bot size={14} /> Note Agent
</p>
```

- [ ] **Step 6: Run static integration test**

Run: `npm test -- src/app/noteAgentIntegration.test.ts --run`

Expected: PASS.

- [ ] **Step 7: Run all agent and app tests**

Run: `npm test -- src/features/agent src/app/noteAgentIntegration.test.ts --run`

Expected: PASS.

- [ ] **Step 8: Commit app integration**

```bash
git add src/app/App.tsx src/app/noteAgentIntegration.test.ts
git commit -m "feat(agent): wire note agent into sidebar"
```

---

### Task 6: Full Verification

**Files:**
- Modify only if verification reveals a defect.

- [ ] **Step 1: Run TypeScript build**

Run: `npm run build`

Expected: TypeScript compilation succeeds and Vite builds `dist`.

- [ ] **Step 2: Run full Vitest suite**

Run: `npm test -- --run`

Expected: all tests pass.

- [ ] **Step 3: Start the dev server**

Run: `npm run dev`

Expected: Vite starts and prints a local URL, usually `http://localhost:5173/`.

- [ ] **Step 4: Manually inspect the app**

Open the local URL shown by Vite. Verify:

- The right sidebar title says `Note Agent`.
- The quick-action grid fits at the minimum right sidebar width.
- Running without an API key shows the settings guidance error.
- Proposed changes render in the review panel.
- Discard clears a proposed result.

- [ ] **Step 5: Stop the dev server**

Stop the `npm run dev` session with Ctrl-C after manual verification.

- [ ] **Step 6: Commit any verification fixes**

If Task 6 required fixes:

```bash
git add src/features/agent src/app/App.tsx src/app/styles.css src/app/noteAgentIntegration.test.ts
git commit -m "fix(agent): polish note agent verification issues"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Current-note metadata updates are covered by Tasks 1, 2, 4, and 5.
- Tags and supported YAML fields are validated in Task 1 and applied in Task 2.
- New note creation is validated in Task 1, extracted in Task 2, and wired to `createNote` plus `writeNote` in Task 5.
- Review-before-write is implemented by Task 4's proposed changes panel and Task 5's explicit apply/create callbacks.
- Invalid model output is handled by Task 1 parser errors and Task 4 error state.
- Existing save and vault state ownership stay in `App.tsx` in Task 5.
- Styling and minimum-width behavior are covered by Task 4 and manual verification in Task 6.

Placeholder scan:

- No `TBD`, `TODO`, or undefined later work remains in this plan.
- Each code-producing step includes concrete code or exact replacement text.
- Every task includes a verification command and expected result.

Type consistency:

- `AgentResult`, `AgentOperation`, `NotePatch`, `NewNoteDraft`, and `QuickAgentAction` are defined in Task 1 before later tasks import them.
- `applyCurrentNoteOperations`, `getCreateNoteDraft`, `hasCurrentNoteWrite`, and `hasCreateNoteWrite` are defined in Task 2 before UI and app integration use them.
- `buildAgentPrompt` is defined in Task 3 before `NoteAgent` uses it.
