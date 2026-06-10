use crate::markdown::NoteMetadata;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

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

impl NoteIndex {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| format!("failed to create index folder: {error}"))?;
        }
        let conn = Connection::open(path).map_err(|error| format!("failed to open index: {error}"))?;
        let index = Self { conn };
        index.create_schema()?;
        Ok(index)
    }

    pub fn rebuild(&self, notes: &[NoteMetadata]) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                DELETE FROM notes;
                DELETE FROM tags;
                DELETE FROM search_index;
                ",
            )
            .map_err(|error| format!("failed to clear index: {error}"))?;

        for note in notes {
            let tags = note.tags.join(" ");
            self.conn
                .execute(
                    "
                    INSERT INTO notes (path, title, category, created_at, updated_at, word_count, summary)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                    ",
                    params![
                        note.path,
                        note.title,
                        note.category,
                        note.created_at,
                        note.updated_at,
                        note.word_count as i64,
                        note.summary
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
        }

        Ok(())
    }

    pub fn search(&self, query: &str) -> Result<Vec<SearchResult>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let like_query = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));

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
        let mut results = rows.collect::<Result<Vec<_>, _>>().map_err(|error| format!("failed to read search rows: {error}"))?;

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
                  summary TEXT
                );

                CREATE TABLE IF NOT EXISTS tags (
                  note_path TEXT NOT NULL,
                  tag TEXT NOT NULL,
                  PRIMARY KEY (note_path, tag)
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
        let mut stmt = self.conn.prepare("SELECT tag FROM tags WHERE note_path = ?1 ORDER BY tag ASC")?;
        let rows = stmt.query_map(params![path], |row| row.get::<_, String>(0))?;
        rows.collect()
    }
}

fn fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|part| format!("\"{}\"*", part.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use crate::vault::Vault;
    use super::NoteIndex;
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
        index.rebuild(&notes).unwrap();

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
        vault.write_note("knowledge/old.md", "# Old\n\nstale body").unwrap();

        let index = NoteIndex::open(dir.path().join(".inote/index.sqlite3")).unwrap();
        index.rebuild(&vault.scan().unwrap()).unwrap();
        assert_eq!(index.search("stale").unwrap().len(), 1);

        fs::remove_file(dir.path().join("knowledge/old.md")).unwrap();
        index.rebuild(&vault.scan().unwrap()).unwrap();

        assert!(index.search("stale").unwrap().is_empty());
    }
}
