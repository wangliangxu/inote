# iNote Personal Markdown Knowledge Base Design

## Purpose

iNote is a local-first desktop note application for a personal second brain and journal workflow. It stores every note as a Markdown file in user-owned folders, uses a lightweight local index only as a rebuildable cache, and adds LLM features through configurable API providers without making AI part of the storage layer.

The first version should help one person write quickly, browse notes by category and date, search accumulated knowledge, and review journal history. Team collaboration, cloud sync, and Git workflows are intentionally out of scope for the initial build.

## Reference Projects

The design borrows principles from two open-source note projects:

- Zettlr: Markdown-first writing, filesystem workspaces, full-text retrieval, writing-oriented workflows, and low lock-in.
- Tolaria: files-first, offline-first, standards-based Markdown with YAML frontmatter, Tauri + React desktop architecture, and AI-friendly knowledge base workflows.

iNote should not copy either project directly. It should combine their strongest ideas into a smaller, personal workflow-focused application.

## Product Principles

1. The filesystem is the source of truth.
   Markdown files and folders are the durable data model. The app may cache metadata and search fields, but it must be able to rebuild all derived state from the files.

2. Directories are categories.
   Top-level folders represent major categories. Nested folders represent subcategories. YAML frontmatter may add metadata, but the directory location remains the primary navigation model.

3. Journal and second brain workflows are first-class.
   The app should make daily notes, monthly browsing, recent editing, inbox capture, and retrospective review faster than general file browsing.

4. LLM support is explicit and scoped.
   AI commands must show or clearly imply the context they use: current selection, current note, selected folder, or date range. The app should not upload the whole vault by default.

5. No lock-in.
   Notes must remain readable and editable in any Markdown editor. iNote-specific metadata should use common YAML frontmatter fields where possible.

6. Keep the first version small.
   Git, team collaboration, plugin systems, graph visualizations, Pandoc export, citation management, and mobile support are deferred.

## Target Vault Structure

The recommended starter vault structure is:

```text
NotesRoot/
  00-inbox/
    2026-06-10-quick-thought.md

  journal/
    2026/
      06/
        2026-06-10.md

  knowledge/
    rust/
    ai/
    writing/

  projects/
    inote/
    research/

  resources/
    books/
    articles/
```

The app should not require this exact structure. It should provide it as a starter template and work with any folder tree containing Markdown files.

## Note Format

Every note is a Markdown file. YAML frontmatter is recommended but not mandatory.

```markdown
---
title: Tauri Architecture Notes
category: knowledge/rust
tags: [tauri, rust, desktop]
created_at: 2026-06-08
updated_at: 2026-06-10
summary: Short optional summary.
---

The note body begins here.
```

Core fields:

- `title`: Display title. If missing, derive from first heading or filename.
- `category`: Optional category hint. Directory path remains authoritative for navigation.
- `tags`: Optional list of tags.
- `created_at`: Preferred creation date for calendar and journal views.
- `updated_at`: Last update date maintained by the app when it saves a note.
- `summary`: Optional human-written or AI-generated summary.

Derived metadata:

- File path
- Directory category
- Filename slug
- File modified time
- First heading
- Word count
- Internal links
- Backlinks

## Application Architecture

The application uses Rust + Tauri + React.

```text
src/
  app/
    App.tsx
    routes.tsx
  features/
    calendar/
    editor/
    explorer/
    inbox/
    llm/
    search/
    settings/
  shared/
    components/
    hooks/
    types/

src-tauri/src/
  commands/
  config/
  indexer/
  llm/
  markdown/
  vault/
  main.rs
```

### Frontend Responsibilities

The React frontend owns interaction and presentation:

- Main shell layout
- Category tree
- Note list
- Markdown editor
- Preview pane
- Calendar/month views
- Search UI
- Right-side context panel
- LLM assistant UI
- Settings screens

The frontend should not directly access the filesystem. It calls Tauri commands for all vault operations.

### Rust Backend Responsibilities

The Rust backend owns local system access and durable operations:

- Vault selection and validation
- Directory scanning
- Markdown file read/write
- Atomic save behavior
- File rename, move, and delete
- Frontmatter parsing
- Metadata extraction
- Lightweight indexing
- File watcher events
- LLM HTTP requests
- Settings persistence

Rust commands form the boundary between UI and local capabilities.

## Storage and Indexing

Markdown files are the only durable note data. The index is a local cache.

Recommended first implementation:

- SQLite for note metadata
- SQLite FTS5 for body/title/tag search
- A rebuild command that deletes and recreates the index from Markdown files

Index tables can be introduced as:

- `notes`: path, title, category, created_at, updated_at, word_count, summary
- `tags`: note_path, tag
- `links`: source_path, target_ref
- `search_index`: title, body, tags, summary

The app must tolerate missing, stale, or corrupt index data by offering a rebuild path.

## Main User Experience

The main interface uses a three-panel layout:

```text
Left navigation      Center workspace             Right context
----------------     -------------------------    ----------------
Inbox                Note list / editor           Outline
Today                Markdown editing             Metadata
Calendar             Preview                      Tags
Categories           Search results               Backlinks
Tags                                               AI assistant
Recent
Settings
```

The first screen after opening a vault should emphasize daily use:

- Today note
- Recent notes
- Inbox notes
- Current month activity

## Core Workflows

### Open or Create Vault

The user chooses a local folder. If empty, the app can offer to create the starter structure. If non-empty, the app scans Markdown files and builds the index.

### Create Quick Note

The user can create a note in `00-inbox` with a timestamp-based filename. The note opens immediately in the editor.

### Create Today Note

The user can open today's note. If it does not exist, the app creates:

```text
journal/YYYY/MM/YYYY-MM-DD.md
```

with frontmatter and a simple daily template.

### Browse by Category

The left navigation shows top-level folders and nested subfolders. Selecting a folder shows notes under that folder, sorted by updated date or title.

### Browse by Month

The calendar view groups notes by `created_at` when present. If `created_at` is missing, it falls back to filename date and then file creation or modified time.

### Edit Note

The editor supports Markdown editing with autosave or explicit save. The backend writes atomically and updates `updated_at`.

### Search

Search covers title, body, tags, summary, and path. Results show note title, category, date, and a short excerpt.

### Use LLM Assistant

The user can run scoped AI actions:

- Summarize current note
- Rewrite selected text
- Continue writing from cursor
- Suggest title and tags
- Ask questions about current folder
- Generate weekly or monthly journal review

The app should display the selected context scope before sending a folder-level or date-range request.

## LLM Provider Design

LLM support uses an API abstraction, not a hardcoded provider.

Provider settings:

- Provider name
- API base URL
- API key
- Model name
- Optional organization or project ID
- Request timeout

The first provider should support OpenAI-compatible chat completions. This allows OpenAI, DeepSeek, local proxies, and many self-hosted gateways to work through one adapter. Additional adapters can be added later only when the OpenAI-compatible path is insufficient.

API keys should be stored in the operating system keychain where practical. If keychain support is deferred, the app must clearly mark local config storage as less secure.

## Privacy and Safety

The app is local-first and offline-capable. It should not require an account or network connection for note browsing and editing.

Network access is only required for LLM calls. LLM actions must be user-triggered. Folder-level and date-range AI actions should make the context scope visible because they may send multiple notes to an external API.

## Error Handling

The app should handle common local failures explicitly:

- Missing vault folder: ask the user to locate or create a vault.
- File deleted outside the app: remove it from open editor state and index.
- File changed outside the app: show reload/keep local edit choice if there are unsaved changes.
- Invalid frontmatter: keep the note editable and show a metadata warning.
- Index failure: continue file browsing and offer index rebuild.
- LLM request failure: show provider, status, and retry option without losing the prompt.

## Testing Strategy

Rust tests:

- Frontmatter parsing
- Filename and title derivation
- Vault scanning
- Date extraction fallback order
- Atomic write behavior
- Index rebuild from sample vault
- LLM provider request construction with mocked HTTP

Frontend tests:

- Category tree rendering
- Note list sorting
- Calendar grouping
- Editor save state
- Search result rendering
- LLM context scope display

End-to-end smoke tests:

- Create a vault
- Create today's note
- Edit and save a note
- Browse by category
- Browse by month
- Search saved content

## Implementation Phases

### Phase 0: Desktop Skeleton

Goal: create a working Tauri + React + Rust shell.

Deliverables:

- Tauri 2 + React + TypeScript project
- Three-panel application layout
- Tauri command invocation pattern
- Settings placeholder
- Empty vault onboarding screen

### Phase 1: Local Markdown Vault MVP

Goal: make the app usable for local Markdown notes.

Deliverables:

- Select or create vault
- Scan directories for `.md` files
- Render category tree from folders
- Create, read, update, rename, move, and delete notes
- Parse YAML frontmatter
- Create quick inbox note
- Create today's journal note
- Browse by category
- Browse by date/month

### Phase 2: Lightweight Index and Search

Goal: support growing personal knowledge bases.

Deliverables:

- SQLite metadata index
- SQLite FTS search
- Index rebuild
- File watcher integration
- Recent notes
- Tags view
- Basic backlink extraction

### Phase 3: Journal and Review Workflows

Goal: make daily and monthly use feel natural.

Deliverables:

- Daily note template
- Month activity view
- Weekly review note generation without AI
- Monthly review note generation without AI
- Inbox-to-category move flow
- Metadata editor for title, tags, and date

### Phase 4: LLM API Assistant

Goal: add scoped AI assistance through API providers.

Deliverables:

- OpenAI-compatible provider settings
- Secure API key storage path or clearly marked local fallback
- Current note summary
- Selected text rewrite
- Continue writing
- Suggest title/tags
- Ask current folder
- Weekly/monthly journal review using selected date range
- Request error handling

### Phase 5: Knowledge Network Enhancements

Goal: improve long-term navigation and discovery.

Deliverables:

- `[[wiki-style links]]`
- Backlink panel
- Unlinked mentions
- Orphan notes
- Outline navigation

## Deferred Scope

These capabilities are deliberately deferred until the core personal workflow is stable:

- Git integration
- Cloud sync
- Multi-user collaboration
- Plugin system
- Graph visualization
- Pandoc export
- Academic citation management
- Mobile apps
- Real-time collaborative editing

## Success Criteria for the First Usable Release

The first usable release succeeds when a user can:

- Create or open a local note vault.
- Create a daily note in one action.
- Capture quick notes to inbox.
- Store all notes as plain Markdown files in visible folders.
- Browse notes by category.
- Browse notes by month.
- Edit and save Markdown reliably.
- Search title and body text.
- Rebuild the local index if needed.

LLM support is not required for the first usable release, but the architecture must leave a clean place for it.
