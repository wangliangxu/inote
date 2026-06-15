use crate::markdown::NoteMetadata;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub category: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub summary: Option<String>,
    pub excerpt: String,
}

pub struct NoteIndex {
    conn: Connection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteLink {
    pub source_path: String,
    pub source_title: String,
    pub target_path: String,
    pub target_title: String,
    pub label: String,
    pub kind: String,
}

impl NoteIndex {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create index folder: {error}"))?;
        }
        let conn =
            Connection::open(path).map_err(|error| format!("failed to open index: {error}"))?;
        let index = Self { conn };
        index.create_schema()?;
        index.upgrade_schema();
        Ok(index)
    }

    fn upgrade_schema(&self) {
        let _ = self.conn.execute("ALTER TABLE notes ADD COLUMN due TEXT", []);
        let _ = self.conn.execute("ALTER TABLE notes ADD COLUMN status TEXT", []);
        let _ = self.conn.execute("ALTER TABLE notes ADD COLUMN priority TEXT", []);
        let _ = self.conn.execute("ALTER TABLE notes ADD COLUMN project TEXT", []);
        let _ = self.conn.execute("ALTER TABLE notes ADD COLUMN file_modified INTEGER DEFAULT 0", []);
    }

    pub fn full_rebuild(&self, vault_root: &Path, notes: &[NoteMetadata]) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                DELETE FROM notes;
                DELETE FROM tags;
                DELETE FROM links;
                DELETE FROM search_index;
                ",
            )
            .map_err(|error| format!("failed to clear index: {error}"))?;

        let resolver = LinkResolver::new(notes);
        for note in notes {
            let file_modified = std::fs::metadata(vault_root.join(&note.path))
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            self.insert_note(note, file_modified, &resolver)?;
        }

        Ok(())
    }

    pub fn update_note(&self, vault_root: &Path, note: &NoteMetadata, notes: &[NoteMetadata]) -> Result<(), String> {
        self.delete_note(&note.path)?;
        let resolver = LinkResolver::new(notes);
        let file_modified = std::fs::metadata(vault_root.join(&note.path))
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        self.insert_note(note, file_modified, &resolver)
    }

    fn insert_note(&self, note: &NoteMetadata, file_modified: i64, resolver: &LinkResolver) -> Result<(), String> {
        let tags = note.tags.join(" ");
        self.conn
            .execute(
                "
                INSERT INTO notes (path, title, category, created_at, updated_at, word_count, summary, due, status, priority, project, file_modified)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ",
                params![
                    note.path,
                    note.title,
                    note.category,
                    note.created_at,
                    note.updated_at,
                    note.word_count as i64,
                    note.summary,
                    note.due,
                    note.status,
                    note.priority,
                    note.project,
                    file_modified
                ],
            )
            .map_err(|error| format!("failed to index note metadata: {error}"))?;

        for tag in &note.tags {
            self.conn
                .execute(
                    "INSERT INTO tags (note_path, tag) VALUES (?1, ?2)",
                    params![note.path, tag],
                )
                .map_err(|error| format!("failed to index tag: {error}"))?;
        }

        self.conn
            .execute(
                "
                INSERT INTO search_index (path, title, body, tags, summary)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ",
                params![note.path, note.title, note.body, tags, note.summary],
            )
            .map_err(|error| format!("failed to index note text: {error}"))?;

        for extracted in extract_links(note, resolver) {
            self.conn
                .execute(
                    "
                    INSERT OR IGNORE INTO links (source_path, target_path, label, kind)
                    VALUES (?1, ?2, ?3, ?4)
                    ",
                    params![
                        note.path,
                        extracted.target_path,
                        extracted.label,
                        extracted.kind
                    ],
                )
                .map_err(|error| format!("failed to index note link: {error}"))?;
        }

        Ok(())
    }

    pub fn delete_note(&self, path: &str) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM links WHERE source_path = ?1 OR target_path = ?1",
                params![path],
            )
            .map_err(|error| format!("failed to remove note links from index: {error}"))?;
        self.conn
            .execute("DELETE FROM tags WHERE note_path = ?1", params![path])
            .map_err(|error| format!("failed to remove note tags from index: {error}"))?;
        self.conn
            .execute("DELETE FROM search_index WHERE path = ?1", params![path])
            .map_err(|error| format!("failed to remove note text from index: {error}"))?;
        self.conn
            .execute("DELETE FROM notes WHERE path = ?1", params![path])
            .map_err(|error| format!("failed to remove note metadata from index: {error}"))?;
        Ok(())
    }

    
    pub fn get_all_notes(&self) -> Result<Vec<NoteMetadata>, String> {
        let mut tags_stmt = self.conn.prepare("SELECT note_path, tag FROM tags").map_err(|e| format!("tags prep: {}", e))?;
        let tags_rows = tags_stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| format!("tags query: {}", e))?;
        
        let mut tags_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
        for row in tags_rows.flatten() {
            tags_map.entry(row.0).or_default().push(row.1);
        }

        let mut stmt = self.conn.prepare(
            "
            SELECT n.path, n.title, n.category, n.created_at, n.updated_at, n.word_count, n.summary,
                   n.due, n.status, n.priority, n.project, s.body
            FROM notes n
            JOIN search_index s ON n.path = s.path
            ORDER BY n.updated_at DESC, n.title ASC
            "
        ).map_err(|e| format!("notes prep: {}", e))?;

        let rows = stmt.query_map([], |row| {
            let path: String = row.get(0)?;
            Ok(NoteMetadata {
                path: path.clone(),
                title: row.get(1)?,
                category: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                word_count: row.get(5)?,
                summary: row.get(6)?,
                due: row.get(7)?,
                status: row.get(8)?,
                priority: row.get(9)?,
                project: row.get(10)?,
                body: row.get(11)?,
                tags: tags_map.remove(&path).unwrap_or_default(),
            })
        }).map_err(|e| format!("notes query: {}", e))?;

        Ok(rows.flatten().collect())
    }

    pub fn lightweight_rebuild(&self, vault_root: &Path) -> Result<Vec<NoteMetadata>, String> {
        let mut db_files = std::collections::HashMap::new();
        {
            let mut stmt = self.conn.prepare("SELECT path, file_modified FROM notes").map_err(|e| format!("prep: {}", e))?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            }).map_err(|e| format!("query: {}", e))?;
            for row in rows.flatten() {
                db_files.insert(row.0, row.1);
            }
        }

        let mut disk_paths = std::collections::HashSet::new();
        let mut to_update = Vec::new();
        
        for entry in walkdir::WalkDir::new(vault_root).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|v| v.to_str()) == Some("md") {
                if let Ok(rel_path) = path.strip_prefix(vault_root) {
                    let rel_str = rel_path.to_string_lossy().replace('\\', "/");
                    disk_paths.insert(rel_str.clone());
                    
                    let file_modified = entry.metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                        .duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64;
                    
                    let needs_update = match db_files.get(&rel_str) {
                        Some(&db_mod) => file_modified > db_mod,
                        None => true,
                    };
                    
                    if needs_update {
                        if let Ok(note) = crate::markdown::parse_note(vault_root, path) {
                            to_update.push((note, file_modified));
                        }
                    }
                }
            }
        }
        
        for db_path in db_files.keys() {
            if !disk_paths.contains(db_path) {
                self.delete_note(db_path)?;
            }
        }
        
        if !to_update.is_empty() {
            let all_notes = self.get_all_notes()?;
            let mut merged_notes = all_notes.into_iter()
                .filter(|n| disk_paths.contains(&n.path) && !to_update.iter().any(|(u, _)| u.path == n.path))
                .collect::<Vec<_>>();
            for (note, _) in &to_update {
                merged_notes.push(note.clone());
            }
            let resolver = LinkResolver::new(&merged_notes);
            for (note, file_modified) in to_update {
                self.delete_note(&note.path)?;
                self.insert_note(&note, file_modified, &resolver)?;
            }
        }
        
        self.get_all_notes()
    }

    pub fn search(&self, query: &str) -> Result<Vec<SearchResult>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        
        let clean_query = query
            .split_whitespace()
            .filter(|part| !part.eq_ignore_ascii_case("OR"))
            .map(|part| {
                if part.starts_with('#') && part.len() > 1 {
                    &part[1..]
                } else if part.starts_with("tag:") && part.len() > 4 {
                    &part[4..]
                } else {
                    part
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
            
        let like_query = format!("%{}%", clean_query.replace('%', "\\%").replace('_', "\\_"));

        let mut stmt = self
            .conn
            .prepare(
                "
                SELECT n.path, n.title, n.category, n.created_at, n.updated_at, n.summary,
                       COALESCE(snippet(search_index, 2, '[', ']', ' ... ', 18), substr(search_index.body, 1, 180)) AS excerpt
                FROM search_index
                JOIN notes n ON n.path = search_index.path
                WHERE search_index MATCH ?1
                ORDER BY rank
                LIMIT 50
                ",
            )
            .map_err(|error| format!("failed to prepare fts search: {error}"))?;

        let fts_query = fts_query(query);
        let rows = stmt
            .query_map(params![fts_query], |row| self.search_row(row))
            .map_err(|error| format!("failed to run fts search: {error}"))?;
        let mut results = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to read search rows: {error}"))?;

        if results.is_empty() {
            let mut fallback = self
                .conn
                .prepare(
                    "
                    SELECT n.path, n.title, n.category, n.created_at, n.updated_at, n.summary,
                           substr(search_index.body, 1, 180) AS excerpt
                    FROM search_index
                    JOIN notes n ON n.path = search_index.path
                    WHERE n.title LIKE ?1 ESCAPE '\\'
                       OR n.category LIKE ?1 ESCAPE '\\'
                       OR search_index.body LIKE ?1 ESCAPE '\\'
                       OR search_index.tags LIKE ?1 ESCAPE '\\'
                       OR search_index.summary LIKE ?1 ESCAPE '\\'
                    ORDER BY n.updated_at DESC, n.title ASC
                    LIMIT 50
                    ",
                )
                .map_err(|error| format!("failed to prepare fallback search: {error}"))?;
            results = fallback
                .query_map(params![like_query], |row| self.search_row(row))
                .map_err(|error| format!("failed to run fallback search: {error}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("failed to read fallback rows: {error}"))?;
        }

        Ok(results)
    }

    pub fn outgoing_links(&self, path: &str) -> Result<Vec<NoteLink>, String> {
        self.note_links(
            "
            SELECT l.source_path, s.title, l.target_path, t.title, l.label, l.kind
            FROM links l
            JOIN notes s ON s.path = l.source_path
            JOIN notes t ON t.path = l.target_path
            WHERE l.source_path = ?1
            ORDER BY t.title ASC, l.target_path ASC
            ",
            path,
        )
    }

    pub fn backlinks(&self, path: &str) -> Result<Vec<NoteLink>, String> {
        self.note_links(
            "
            SELECT l.source_path, s.title, l.target_path, t.title, l.label, l.kind
            FROM links l
            JOIN notes s ON s.path = l.source_path
            JOIN notes t ON t.path = l.target_path
            WHERE l.target_path = ?1
            ORDER BY s.updated_at DESC, s.title ASC
            ",
            path,
        )
    }

    fn create_schema(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS notes (
                  path TEXT PRIMARY KEY,
                  title TEXT NOT NULL,
                  category TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  word_count INTEGER NOT NULL,
                  summary TEXT,
                  due TEXT,
                  status TEXT,
                  priority TEXT,
                  project TEXT,
                  file_modified INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS tags (
                  note_path TEXT NOT NULL,
                  tag TEXT NOT NULL,
                  PRIMARY KEY (note_path, tag)
                );

                CREATE TABLE IF NOT EXISTS links (
                  source_path TEXT NOT NULL,
                  target_path TEXT NOT NULL,
                  label TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  PRIMARY KEY (source_path, target_path, label, kind)
                );

                CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
                  path UNINDEXED,
                  title,
                  body,
                  tags,
                  summary
                );
                ",
            )
            .map_err(|error| format!("failed to create index schema: {error}"))
    }

    fn search_row(&self, row: &rusqlite::Row<'_>) -> rusqlite::Result<SearchResult> {
        let path: String = row.get(0)?;
        Ok(SearchResult {
            tags: self.tags_for_note(&path)?,
            path,
            title: row.get(1)?,
            category: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            summary: row.get(5)?,
            excerpt: row.get(6)?,
        })
    }

    fn tags_for_note(&self, path: &str) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT tag FROM tags WHERE note_path = ?1 ORDER BY tag ASC")?;
        let rows = stmt.query_map(params![path], |row| row.get::<_, String>(0))?;
        rows.collect()
    }

    fn note_links(&self, sql: &str, path: &str) -> Result<Vec<NoteLink>, String> {
        let mut stmt = self
            .conn
            .prepare(sql)
            .map_err(|error| format!("failed to prepare link query: {error}"))?;
        let rows = stmt
            .query_map(params![path], |row| {
                Ok(NoteLink {
                    source_path: row.get(0)?,
                    source_title: row.get(1)?,
                    target_path: row.get(2)?,
                    target_title: row.get(3)?,
                    label: row.get(4)?,
                    kind: row.get(5)?,
                })
            })
            .map_err(|error| format!("failed to run link query: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to read link rows: {error}"))
    }
}

fn fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|part| {
            if part.eq_ignore_ascii_case("OR") {
                "OR".to_string()
            } else if part.starts_with('#') && part.len() > 1 {
                format!("tags:\"{}\"*", part[1..].replace('"', "\"\""))
            } else if part.starts_with("tag:") && part.len() > 4 {
                format!("tags:\"{}\"*", part[4..].replace('"', "\"\""))
            } else {
                format!("\"{}\"*", part.replace('"', "\"\""))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Debug)]
struct ExtractedLink {
    target_path: String,
    label: String,
    kind: String,
}

struct LinkResolver {
    by_title: HashMap<String, String>,
    by_path: HashMap<String, String>,
}

impl LinkResolver {
    fn new(notes: &[NoteMetadata]) -> Self {
        let mut by_title = HashMap::new();
        let mut by_path = HashMap::new();
        for note in notes {
            by_title
                .entry(note.title.to_lowercase())
                .or_insert_with(|| note.path.clone());
            by_path.insert(note.path.clone(), note.path.clone());
            if let Some(stem) = Path::new(&note.path)
                .file_stem()
                .and_then(|value| value.to_str())
            {
                by_title
                    .entry(stem.to_lowercase())
                    .or_insert_with(|| note.path.clone());
            }
        }
        Self { by_title, by_path }
    }

    fn resolve_wiki(&self, label: &str) -> Option<String> {
        let target = label.split('|').next().unwrap_or(label).trim();
        self.by_title.get(&target.to_lowercase()).cloned()
    }

    fn resolve_markdown(&self, source_path: &str, target: &str) -> Option<String> {
        if target.starts_with("http://")
            || target.starts_with("https://")
            || target.starts_with('#')
            || target.starts_with("mailto:")
        {
            return None;
        }

        let without_anchor = target.split('#').next().unwrap_or(target);
        if without_anchor.is_empty() || !without_anchor.ends_with(".md") {
            return None;
        }

        let source_parent = Path::new(source_path)
            .parent()
            .unwrap_or_else(|| Path::new(""));
        let candidate = normalize_relative_path(&source_parent.join(without_anchor));
        self.by_path.get(&candidate).cloned()
    }
}

fn extract_links(note: &NoteMetadata, resolver: &LinkResolver) -> Vec<ExtractedLink> {
    let mut links = Vec::new();
    links.extend(extract_wiki_links(&note.body, resolver));
    links.extend(extract_markdown_links(&note.path, &note.body, resolver));
    links
}

fn extract_wiki_links(body: &str, resolver: &LinkResolver) -> Vec<ExtractedLink> {
    let mut links = Vec::new();
    let mut remaining = body;
    while let Some(start) = remaining.find("[[") {
        let after_start = &remaining[start + 2..];
        let Some(end) = after_start.find("]]") else {
            break;
        };
        let raw_label = after_start[..end].trim();
        let label = raw_label
            .split('|')
            .nth(1)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| raw_label.split('|').next().unwrap_or(raw_label).trim());
        if !raw_label.is_empty() {
            if let Some(target_path) = resolver.resolve_wiki(raw_label) {
                links.push(ExtractedLink {
                    target_path,
                    label: label.to_string(),
                    kind: "wiki".to_string(),
                });
            }
        }
        remaining = &after_start[end + 2..];
    }
    links
}

fn extract_markdown_links(
    source_path: &str,
    body: &str,
    resolver: &LinkResolver,
) -> Vec<ExtractedLink> {
    let mut links = Vec::new();
    let mut remaining = body;
    while let Some(label_start) = remaining.find('[') {
        if remaining[label_start..].starts_with("[[") {
            remaining = &remaining[label_start + 2..];
            continue;
        }
        let after_label = &remaining[label_start + 1..];
        let Some(label_end) = after_label.find(']') else {
            break;
        };
        let after_bracket = &after_label[label_end + 1..];
        if !after_bracket.starts_with('(') {
            remaining = after_bracket;
            continue;
        }
        let Some(target_end) = after_bracket[1..].find(')') else {
            break;
        };
        let label = after_label[..label_end].trim();
        let target = after_bracket[1..target_end + 1].trim();
        if let Some(target_path) = resolver.resolve_markdown(source_path, target) {
            links.push(ExtractedLink {
                target_path,
                label: label.to_string(),
                kind: "markdown".to_string(),
            });
        }
        remaining = &after_bracket[target_end + 2..];
    }
    links
}

fn normalize_relative_path(path: &Path) -> String {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => parts.push(value.to_string_lossy().to_string()),
            Component::ParentDir => {
                parts.pop();
            }
            Component::CurDir => {}
            _ => {}
        }
    }
    PathBuf::from_iter(parts)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::NoteIndex;
    use crate::vault::Vault;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn rebuilds_index_and_searches_title_body_tags_and_summary() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();
        vault
            .write_note(
                "knowledge/ai/城市网络大模型.md",
                "---\ntitle: 城市网络大模型\ntags: [ai, city]\nsummary: Urban intelligence\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nGraph retrieval body.",
            )
            .unwrap();

        let index = NoteIndex::open(dir.path().join(".inote/index.sqlite3")).unwrap();
        let notes = vault.scan().unwrap();
        index.full_rebuild(vault.root(), &notes).unwrap();

        let by_title = index.search("城市网络").unwrap();
        let by_body = index.search("retrieval").unwrap();
        let by_tag = index.search("city").unwrap();
        let by_summary = index.search("Urban").unwrap();

        assert_eq!(by_title[0].title, "城市网络大模型");
        assert_eq!(by_body[0].path, "knowledge/ai/城市网络大模型.md");
        assert_eq!(by_tag[0].path, "knowledge/ai/城市网络大模型.md");
        assert_eq!(by_summary[0].path, "knowledge/ai/城市网络大模型.md");
    }

    #[test]
    fn rebuild_removes_notes_that_no_longer_exist() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();
        vault
            .write_note("knowledge/old.md", "# Old\n\nstale body")
            .unwrap();

        let index = NoteIndex::open(dir.path().join(".inote/index.sqlite3")).unwrap();
        index.full_rebuild(vault.root(), &vault.scan().unwrap()).unwrap();
        assert_eq!(index.search("stale").unwrap().len(), 1);

        fs::remove_file(dir.path().join("knowledge/old.md")).unwrap();
        index.full_rebuild(vault.root(), &vault.scan().unwrap()).unwrap();

        assert!(index.search("stale").unwrap().is_empty());
    }

    #[test]
    fn delete_note_removes_search_tags_and_links_without_rebuild() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();
        vault
            .write_note(
                "knowledge/source.md",
                "---\ntitle: Source Note\ntags: [source]\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nLinks to [[Target Note]].",
            )
            .unwrap();
        vault
            .write_note(
                "knowledge/target.md",
                "---\ntitle: Target Note\ntags: [target]\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\ntargetonly body.",
            )
            .unwrap();

        let index = NoteIndex::open(dir.path().join(".inote/index.sqlite3")).unwrap();
        index.full_rebuild(vault.root(), &vault.scan().unwrap()).unwrap();
        assert_eq!(index.search("targetonly").unwrap().len(), 1);
        assert_eq!(index.backlinks("knowledge/target.md").unwrap().len(), 1);

        index.delete_note("knowledge/target.md").unwrap();

        assert!(index.search("targetonly").unwrap().is_empty());
        assert!(index.backlinks("knowledge/target.md").unwrap().is_empty());
        assert!(index.outgoing_links("knowledge/source.md").unwrap().is_empty());
    }

    #[test]
    fn rebuild_extracts_outgoing_links_and_backlinks() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();
        vault
            .write_note(
                "knowledge/source.md",
                "---\ntitle: Source Note\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nLinks to [[Target Note]] and [Relative](../projects/linked.md).",
            )
            .unwrap();
        vault
            .write_note(
                "knowledge/target.md",
                "---\ntitle: Target Note\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nTarget body.",
            )
            .unwrap();
        vault
            .write_note(
                "projects/linked.md",
                "---\ntitle: Linked Project\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nLinked body.",
            )
            .unwrap();

        let index = NoteIndex::open(dir.path().join(".inote/index.sqlite3")).unwrap();
        index.full_rebuild(vault.root(), &vault.scan().unwrap()).unwrap();

        let outgoing = index.outgoing_links("knowledge/source.md").unwrap();
        let backlinks = index.backlinks("knowledge/target.md").unwrap();

        assert_eq!(outgoing.len(), 2);
        assert!(outgoing
            .iter()
            .any(|link| link.target_path == "knowledge/target.md" && link.label == "Target Note"));
        assert!(outgoing
            .iter()
            .any(|link| link.target_path == "projects/linked.md"));
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].source_path, "knowledge/source.md");
    }
}
