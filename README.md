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
