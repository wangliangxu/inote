# iNote

iNote 是一款功能强大、本地优先的 Markdown 知识库应用程序，旨在帮助您无缝地整理想法、任务和灵感。它的构建将性能和隐私放在首位，您的所有数据都安全地保存在本地设备上，同时提供了现代化的功能，例如全文搜索、AI (LLM) 整合、以及强大的标签和任务管理系统。

## 🚀 核心功能

- **本地优先架构**：您所有的笔记和设置均存储在本地。无需云端同步，确保完全的隐私和离线可用性。
- **丰富的 Markdown 编辑器**：内置由 MDXEditor 驱动的全功能所见即所得 (WYSIWYG) 及原始 Markdown 编辑器，支持表格、图片、代码块等高级特性。
- **高级组织与管理**：
  - **文件夹与标签**：通过嵌套文件夹和灵活的标签系统来构建您的知识库。
  - **日记、周报和月报**：内置快捷命令，轻松记录日常思考并进行定期回顾。
  - **归档与回收站**：安全地归档旧笔记，或将其移入回收站以防止误删。
- **智能搜索与索引**：由本地 SQLite 数据库驱动的闪电般快速的全文搜索。系统自动追踪笔记之间的关联和双向链接，构建您的专属知识图谱。
- **任务管理 (Todos)**：集成待办事项管理功能，允许您直接在笔记中追踪和管理任务。
- **AI 大模型 (LLM) 整合**：应用内直接集成大语言模型助手，协助您总结摘要、头脑风暴或润色文章。
- **日历视图**：通过直观的日历界面可视化并导航您的笔记与任务。
- **动态主题**：内置暗黑模式与浅色模式支持，并能够自动跟随系统偏好。

## 🛠️ 技术栈

### 前端 (Frontend)
- **核心框架:** React 19
- **构建工具:** Vite
- **开发语言:** TypeScript
- **图标库:** Lucide React
- **编辑器:** MDXEditor

### 后端 (Backend / Tauri)
- **应用框架:** Tauri v2
- **开发语言:** Rust
- **数据库:** SQLite (使用 `rusqlite`) 用于提供极速的搜索索引和元数据存储。
- **文件系统:** 使用 `notify` 实时监听文件系统的变化，以及 `walkdir` 用于文件目录遍历。

## 📦 快速开始

### 环境依赖
- [Node.js](https://nodejs.org/)（22.22.2+、24.15.0+ 或 26+，建议使用受支持的 LTS 版本）
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri CLI 环境依赖](https://tauri.app/v1/guides/getting-started/prerequisites)

### 安装步骤

1. **克隆项目仓库：**
   ```bash
   git clone <repository-url>
   cd inote
   ```

2. **安装前端依赖：**
   ```bash
   npm install
   ```

3. **运行开发服务器：**
   ```bash
   npm run tauri dev
   ```
   这将同时启动 Vite 前端开发服务器和 Tauri 后端进程。

### 构建生产环境版本

要为当前操作系统构建应用的独立可执行文件，请运行：
```bash
npm run tauri build
```
编译完成的二进制文件将保存在 `src-tauri/target/release` 目录中。

## 验证与性能基准

```bash
npm run check
npm run test:run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked --all-targets
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run benchmark:vault -- 1000 10000
```

基准使用自动清理的临时笔记库，不访问个人笔记。实现说明、迁移行为和验收记录见 [优化实现说明](docs/optimization-2026-10-23.md)。

## 🏗️ 项目结构

- `src/` - 前端 React 应用。
  - `app/` - 应用程序主组件和全局样式。
  - `features/` - 模块化功能目录（例如 `agent`, `calendar`, `editor`, `explorer`, `llm`, `search`, `settings`, `tags`, `todo`）。
  - `shared/` - 共享的工具函数、UI 组件和主题逻辑。
- `src-tauri/` - Rust 后端应用。
  - `src/commands.rs` - 暴露给前端的 Tauri IPC 命令。
  - `src/indexer.rs` - SQLite 索引与搜索逻辑。
  - `src/llm.rs` - LLM 整合与 API 交互处理。
  - `src/watcher.rs` - 文件系统监听器，保持应用内部状态与外部文件变动同步。
  - `src/vault.rs` - 笔记、文件夹和本地知识库(Vault)的管理逻辑。

## 🤝 参与贡献
欢迎随时提交 Pull Request，感谢您的贡献！

## 📄 许可证 (License)
[在此处指定许可证]
