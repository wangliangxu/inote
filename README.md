# iNote

iNote is a powerful, local-first Markdown knowledge base application designed to help you organize your thoughts, tasks, and ideas seamlessly. Built with performance and privacy in mind, iNote stores all your data locally on your device while providing modern features like full-text search, LLM integrations, and a robust tag and task management system.

## 🚀 Features

- **Local-First Architecture:** All your notes and settings are stored locally. No cloud sync required, ensuring complete privacy and offline availability.
- **Rich Markdown Editor:** A full-featured WYSIWYG and raw markdown editor powered by MDXEditor, supporting tables, images, code blocks, and more.
- **Advanced Organization:**
  - **Folders & Tags:** Structure your vault with nested folders and flexible tagging.
  - **Daily, Weekly, and Monthly Notes:** Built-in commands to easily capture daily thoughts or perform periodic reviews.
  - **Archive & Trash:** Safely archive old notes or move them to the trash before permanent deletion.
- **Intelligent Search & Indexing:** Lightning-fast full-text search powered by a local SQLite database index. Note links and relationships are tracked to build a knowledge graph.
- **Task Management (Todos):** Integrated todo management allowing you to track your tasks right from your notes.
- **AI/LLM Integration:** Chat with an integrated LLM assistant directly within the app to help summarize, brainstorm, or refine your writing.
- **Calendar View:** Visualize and navigate your notes and tasks on a calendar.
- **Dynamic Theming:** Built-in dark and light mode support that respects system preferences.

## 🛠️ Tech Stack

### Frontend
- **Framework:** React 19
- **Build Tool:** Vite
- **Language:** TypeScript
- **Icons:** Lucide React
- **Editor:** MDXEditor

### Backend (Tauri)
- **Framework:** Tauri v2
- **Language:** Rust
- **Database:** SQLite (via `rusqlite`) for fast search indexing and metadata storage.
- **File System:** `notify` for live watching vault changes and `walkdir` for directory traversal.

## 📦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (22.22.2+, 24.15.0+, or 26+; supported LTS recommended)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri CLI dependencies](https://tauri.app/v1/guides/getting-started/prerequisites)

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd inote
   ```

2. **Install frontend dependencies:**
   ```bash
   npm install
   ```

3. **Run the development server:**
   ```bash
   npm run tauri dev
   ```
   This will start both the Vite development server and the Tauri backend.

### Building for Production

To build the application for your current operating system, run:
```bash
npm run tauri build
```
The compiled binaries will be available in the `src-tauri/target/release` directory.

## macOS due-date reminders

In the desktop app, open **Settings → General → macOS Reminders**, authorize access, select a writable list, and enable sync. You can create an `iNote` list in Apple Reminders first. If access is denied, allow iNote in **System Settings → Privacy & Security → Reminders** and connect again.

Set a note's due date and system reminder in its metadata panel, then save. Options include at due time (the default), 10 minutes before, one day before, and excluding the task from sync. Date-only tasks notify at 09:00 local time. Past notification times are not replayed. Notification presentation and sounds follow macOS Reminders settings.

Titles, due dates, priorities, and completion sync to the same system reminder, including after renaming or moving a note. Cancelling, deleting, archiving, or excluding a task removes its reminder. Clearing the date on an already linked task clears the date and alarm on the other side while retaining the task and completion sync. Startup, vault/list changes, and enabling sync reconcile saved disk tasks; external Markdown changes also sync. Use **Sync now / retry** after resolving access, list, or temporary failures. Sync errors are shown separately and never reject a successful note save.

**Due dates and completion sync both ways between iNote and Reminders.** Changing or clearing a date, completing a task, or reopening it in Reminders writes back to saved Markdown. Reopening restores the previous todo/in-progress status. Titles, priorities, and reminder timing remain managed by iNote. Each note represents one task; inline checkboxes are not separate tasks.

System changes trigger a debounced check. Focus and a 30-second fallback check visit only linked tasks; startup and manual retry reconcile the vault. Changes made while iNote is closed merge on its next launch. Changes to different fields merge automatically. When both sides change the same field, Settings shows both values with **Keep iNote changes** / **Use system changes** actions. Stale choices are rejected if either version changes again. Deleting a system reminder never deletes a note; eligible linked tasks are recreated on the next check.

Inbound writes update only `due`/`status` through the existing version-checked file/index persistence, retaining the body, comments, and custom metadata. Unsaved drafts remain intact and use the existing external-file conflict flow if their disk revision changes. Typing during a save preserves newly typed content and only adopts system task fields the user did not edit again. Unusual YAML that cannot be patched safely (for example a target field inside a flow mapping or multiline scalar) reports an error; change `due`/`status` to ordinary top-level scalar lines in source mode first.

 Historical completed tasks are not imported on first sync. Disabling sync leaves existing system reminders and their notifications in place. System identifiers live in the local app-data `reminders.sqlite3`; Markdown stores only the portable `reminder` frontmatter (`at_due`, `10_minutes`, `1_day`, `none`). Other platforms can edit this metadata without invoking Apple Reminders.

## Validation and benchmarks

```bash
npm run check
npm run test:run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked --all-targets
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run benchmark:vault -- 1000 10000
```

The benchmark uses disposable temporary vaults. See [implementation and migration notes](docs/optimization-2026-10-23.md) for the storage, indexing, security and verification details.

## 🏗️ Project Structure

- `src/` - Frontend React application.
  - `app/` - Main application component and global styles.
  - `features/` - Modular feature directories (e.g., `agent`, `calendar`, `editor`, `explorer`, `llm`, `search`, `settings`, `tags`, `todo`).
  - `shared/` - Shared utilities, UI components, and theme logic.
- `src-tauri/` - Rust backend application.
  - `src/commands.rs` - Tauri IPC commands exposed to the frontend.
  - `src/indexer.rs` - SQLite indexing and search logic.
  - `src/llm.rs` - LLM integration and API handling.
  - `src/watcher.rs` - File system watcher to keep the app in sync with external changes.
  - `src/vault.rs` - Note, folder, and vault management logic.

## 🤝 Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License
[Specify License Here]
