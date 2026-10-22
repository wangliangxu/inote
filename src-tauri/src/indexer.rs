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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultDelta {
    pub notes: Vec<NoteMetadata>,
    pub removed_paths: Vec<String>,
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
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| error.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| error.to_string())?;
        let index = Self { conn };
        index.create_schema()?;
        index.upgrade_schema()?;
        Ok(index)
    }

    fn upgrade_schema(&self) -> Result<(), String> {
        let mut statement = self
            .conn
            .prepare("PRAGMA table_info(notes)")
            .map_err(|error| error.to_string())?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| error.to_string())?
            .collect::<Result<std::collections::HashSet<_>, _>>()
            .map_err(|error| error.to_string())?;
        for (name, definition) in [
            ("due", "TEXT"),
            ("status", "TEXT"),
            ("priority", "TEXT"),
            ("project", "TEXT"),
            ("file_modified", "INTEGER DEFAULT 0"),
            ("file_size", "INTEGER DEFAULT -1"),
            ("source_revision", "TEXT DEFAULT ''"),
            ("frontmatter_json", "TEXT DEFAULT '{}'"),
            ("frontmatter_source", "TEXT"),
        ] {
            if !columns.contains(name) {
                self.conn
                    .execute(
                        &format!("ALTER TABLE notes ADD COLUMN {name} {definition}"),
                        [],
                    )
                    .map_err(|error| format!("failed to migrate index: {error}"))?;
            }
        }
        Ok(())
    }

    fn atomic<T>(&self, update: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        self.conn
            .execute_batch("SAVEPOINT inote_index_change")
            .map_err(|error| error.to_string())?;
        match update() {
            Ok(value) => {
                self.conn
                    .execute_batch("RELEASE inote_index_change")
                    .map_err(|error| error.to_string())?;
                Ok(value)
            }
            Err(error) => {
                self.conn
                    .execute_batch("ROLLBACK TO inote_index_change; RELEASE inote_index_change")
                    .map_err(|rollback| format!("{error}; rollback failed: {rollback}"))?;
                Err(error)
            }
        }
    }

    pub fn full_rebuild(&self, vault_root: &Path, notes: &[NoteMetadata]) -> Result<(), String> {
        self.atomic(|| {
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
                    .as_nanos()
                    .min(i64::MAX as u128) as i64;
                self.insert_note(note, file_modified, &resolver)?;
            }

            Ok(())
        })
    }

    pub fn update_note(
        &self,
        vault_root: &Path,
        note: &NoteMetadata,
        notes: &[NoteMetadata],
    ) -> Result<(), String> {
        self.atomic(|| {
            let previous_title = self
                .conn
                .query_row(
                    "SELECT title FROM notes WHERE path = ?1",
                    [&note.path],
                    |row| row.get::<_, String>(0),
                )
                .ok();
            self.remove_note_outgoing(&note.path)?;
            let resolver = LinkResolver::new(notes);
            let file_modified = std::fs::metadata(vault_root.join(&note.path))
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
                .min(i64::MAX as u128) as i64;
            self.insert_note(note, file_modified, &resolver)?;
            if previous_title.as_deref() != Some(&note.title) {
                self.refresh_links()?;
            }
            Ok(())
        })
    }

    fn insert_note(
        &self,
        note: &NoteMetadata,
        file_modified: i64,
        resolver: &LinkResolver,
    ) -> Result<(), String> {
        let tags = note.tags.join(" ");
        self.conn
            .execute(
                "
                INSERT INTO notes (path, title, category, created_at, updated_at, word_count, summary, due, status, priority, project, file_modified, file_size, source_revision, frontmatter_json, frontmatter_source)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
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
                    file_modified,
                    note.source_size as i64,
                    note.source_revision,
                    serde_json::to_string(&note.frontmatter).map_err(|error| error.to_string())?,
                    note.frontmatter_source
                ],
            )
            .map_err(|error| format!("failed to index note metadata: {error}"))?;

        for tag in &note.tags {
            self.conn
                .execute(
                    "INSERT OR IGNORE INTO tags (note_path, tag) VALUES (?1, ?2)",
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
        self.atomic(|| {
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
        })
    }

    /// Remove only the outgoing data for a note (source links, tags, search text, metadata)
    /// so it can be re-inserted. Incoming links (where target_path = path) are preserved.
    fn remove_note_outgoing(&self, path: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM links WHERE source_path = ?1", params![path])
            .map_err(|error| format!("failed to remove outgoing links: {error}"))?;
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
        self.get_notes(true)
    }

    pub fn get_note_summaries(&self) -> Result<Vec<NoteMetadata>, String> {
        self.get_notes(false)
    }

    fn get_notes(&self, include_body: bool) -> Result<Vec<NoteMetadata>, String> {
        self.get_filtered_notes(include_body, None)
    }

    pub fn get_summaries_for_paths(&self, paths: &[String]) -> Result<Vec<NoteMetadata>, String> {
        self.get_filtered_notes(false, Some(paths))
    }

    fn get_filtered_notes(
        &self,
        include_body: bool,
        paths: Option<&[String]>,
    ) -> Result<Vec<NoteMetadata>, String> {
        let path_json = paths
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| error.to_string())?;
        let tag_filter = if paths.is_some() {
            "WHERE note_path IN (SELECT value FROM json_each(?1))"
        } else {
            "WHERE ?1 IS NULL"
        };
        let note_filter = if paths.is_some() {
            "WHERE n.path IN (SELECT value FROM json_each(?1))"
        } else {
            "WHERE ?1 IS NULL"
        };
        let mut tags_stmt = self
            .conn
            .prepare(&format!("SELECT note_path, tag FROM tags {tag_filter}"))
            .map_err(|e| format!("tags prep: {}", e))?;
        let tags_rows = tags_stmt
            .query_map(params![path_json], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("tags query: {}", e))?;

        let mut tags_map: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for row in tags_rows {
            let row = row.map_err(|error| error.to_string())?;
            tags_map.entry(row.0).or_default().push(row.1);
        }

        let body_column = if include_body { "s.body" } else { "''" };
        let frontmatter_column = if include_body {
            "n.frontmatter_json, n.frontmatter_source"
        } else {
            "'{}', NULL"
        };
        let mut stmt = self.conn.prepare(&format!(
            "
            SELECT n.path, n.title, n.category, n.created_at, n.updated_at, n.word_count, n.summary,
                   n.due, n.status, n.priority, n.project, {body_column}, n.source_revision, {frontmatter_column}, substr(s.body, 1, 180), n.file_size
            FROM notes n
            JOIN search_index s ON n.path = s.path
            {note_filter}
            ORDER BY n.updated_at DESC, n.title ASC
            "
            )
        ).map_err(|e| format!("notes prep: {}", e))?;

        let rows = stmt
            .query_map(params![path_json], |row| {
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
                    source_revision: row.get(12)?,
                    source_size: row.get(16)?,
                    body_loaded: include_body,
                    frontmatter: serde_json::from_str(&row.get::<_, String>(13)?).map_err(
                        |error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                13,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        },
                    )?,
                    frontmatter_source: row.get(14)?,
                    excerpt: row.get(15)?,
                    raw_markdown: None,
                })
            })
            .map_err(|e| format!("notes query: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn lightweight_rebuild(&self, vault_root: &Path) -> Result<Vec<NoteMetadata>, String> {
        self.rebuild_changed_files(vault_root, true)
    }

    pub fn lightweight_rebuild_summaries(
        &self,
        vault_root: &Path,
    ) -> Result<Vec<NoteMetadata>, String> {
        self.rebuild_changed_files(vault_root, false)
    }

    fn rebuild_changed_files(
        &self,
        vault_root: &Path,
        include_body: bool,
    ) -> Result<Vec<NoteMetadata>, String> {
        self.atomic(|| {
            let mut db_files = std::collections::HashMap::new();
            {
                let mut stmt = self
                    .conn
                    .prepare("SELECT path, file_modified, file_size FROM notes")
                    .map_err(|e| format!("prep: {}", e))?;
                let rows = stmt
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            (row.get::<_, i64>(1)?, row.get::<_, i64>(2)?),
                        ))
                    })
                    .map_err(|e| format!("query: {}", e))?;
                for row in rows.flatten() {
                    db_files.insert(row.0, row.1);
                }
            }

            let mut disk_paths = std::collections::HashSet::new();
            let mut to_update = Vec::new();

            for entry in walkdir::WalkDir::new(vault_root)
                .into_iter()
                .filter_entry(|entry| {
                    entry.depth() == 0
                        || !matches!(
                            entry.file_name().to_str(),
                            Some(".git" | ".inote" | "node_modules")
                        )
                })
            {
                let entry = entry.map_err(|error| error.to_string())?;
                let path = entry.path();
                if entry.file_type().is_file()
                    && path.extension().and_then(|v| v.to_str()) == Some("md")
                {
                    if let Ok(rel_path) = path.strip_prefix(vault_root) {
                        let rel_str = rel_path.to_string_lossy().replace('\\', "/");
                        disk_paths.insert(rel_str.clone());

                        let file_modified = entry
                            .metadata()
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                            .duration_since(std::time::SystemTime::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_nanos()
                            .min(i64::MAX as u128)
                            as i64;

                        let needs_update = match db_files.get(&rel_str) {
                            Some(&(db_mod, db_size)) => {
                                file_modified != db_mod
                                    || entry.metadata().map_err(|error| error.to_string())?.len()
                                        as i64
                                        != db_size
                            }
                            None => true,
                        };

                        if needs_update {
                            let note = crate::markdown::parse_note(vault_root, path)?;
                            to_update.push((note, file_modified));
                        }
                    }
                }
            }

            let mut topology_changed = false;
            for db_path in db_files.keys() {
                if !disk_paths.contains(db_path) {
                    self.delete_note(db_path)?;
                    topology_changed = true;
                }
            }

            if !to_update.is_empty() {
                let all_notes = self.get_note_summaries()?;
                topology_changed |= to_update.iter().any(|(note, _)| {
                    !all_notes
                        .iter()
                        .any(|existing| existing.path == note.path && existing.title == note.title)
                });
                let mut merged_notes = all_notes
                    .into_iter()
                    .filter(|n| {
                        disk_paths.contains(&n.path)
                            && !to_update.iter().any(|(u, _)| u.path == n.path)
                    })
                    .collect::<Vec<_>>();
                for (note, _) in &to_update {
                    merged_notes.push(note.clone());
                }
                let resolver = LinkResolver::new(&merged_notes);
                for (note, file_modified) in to_update {
                    self.remove_note_outgoing(&note.path)?;
                    self.insert_note(&note, file_modified, &resolver)?;
                }
            }
            if topology_changed {
                self.refresh_links()?;
            }

            self.get_notes(include_body)
        })
    }

    pub fn refresh_links(&self) -> Result<(), String> {
        let notes = self.get_all_notes()?;
        let resolver = LinkResolver::new(&notes);
        self.conn
            .execute("DELETE FROM links", [])
            .map_err(|error| error.to_string())?;
        for note in &notes {
            for link in extract_links(note, &resolver) {
                self.conn.execute("INSERT OR IGNORE INTO links (source_path, target_path, label, kind) VALUES (?1, ?2, ?3, ?4)", params![note.path, link.target_path, link.label, link.kind]).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }

    pub fn refresh_paths(&self, vault_root: &Path, paths: &[String]) -> Result<(), String> {
        let vault = crate::vault::Vault::new(vault_root)?;
        if paths.iter().all(|path| {
            Path::new(path).extension().and_then(|value| value.to_str()) == Some("md")
                && !Path::new(path).is_dir()
        }) {
            return self.refresh_note_files(&vault, paths);
        }
        self.atomic(|| {
            let vault = crate::vault::Vault::new(vault_root)?;
            let known = self.get_note_summaries()?;
            let mut affected = std::collections::HashSet::new();
            let mut updates = HashMap::new();
            for changed in paths {
                let path = Path::new(changed);
                let relative = path
                    .strip_prefix(vault.root())
                    .map_err(|_| "watcher path is outside the vault")?;
                if relative.as_os_str().is_empty() {
                    self.lightweight_rebuild_summaries(vault.root())?;
                    continue;
                }
                let relative = relative.to_string_lossy().replace('\\', "/");
                let full = vault.safe_path(&relative)?;
                if relative
                    .split('/')
                    .any(|part| matches!(part, ".inote" | ".git" | "node_modules"))
                {
                    continue;
                }
                for note in &known {
                    if note.path == relative || note.path.starts_with(&format!("{relative}/")) {
                        affected.insert(note.path.clone());
                    }
                }
                if full.is_dir() {
                    for entry in walkdir::WalkDir::new(&full)
                        .into_iter()
                        .filter_entry(|entry| {
                            !matches!(
                                entry.file_name().to_str(),
                                Some(".inote" | ".git" | "node_modules")
                            )
                        })
                    {
                        let entry = entry.map_err(|error| error.to_string())?;
                        if entry.file_type().is_file()
                            && entry
                                .path()
                                .extension()
                                .and_then(|extension| extension.to_str())
                                == Some("md")
                        {
                            let note = crate::markdown::parse_note(vault.root(), entry.path())?;
                            affected.insert(note.path.clone());
                            updates.insert(note.path.clone(), note);
                        }
                    }
                } else if full.is_file() && relative.ends_with(".md") {
                    let note = vault.read_note(&relative)?;
                    affected.insert(note.path.clone());
                    updates.insert(note.path.clone(), note);
                }
            }
            let mut merged = known
                .into_iter()
                .filter(|note| !affected.contains(&note.path))
                .collect::<Vec<_>>();
            merged.extend(updates.values().cloned());
            let resolver = LinkResolver::new(&merged);
            let mut topology_changed = false;
            for path in affected {
                if let Some(note) = updates.remove(&path) {
                    let old_title = self
                        .conn
                        .query_row("SELECT title FROM notes WHERE path = ?1", [&path], |row| {
                            row.get::<_, String>(0)
                        })
                        .ok();
                    topology_changed |= old_title.as_deref() != Some(&note.title);
                    self.remove_note_outgoing(&path)?;
                    let modified = std::fs::metadata(vault.root().join(&path))
                        .and_then(|metadata| metadata.modified())
                        .map_err(|error| error.to_string())?
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_nanos()
                        .min(i64::MAX as u128) as i64;
                    self.insert_note(&note, modified, &resolver)?;
                } else {
                    self.delete_note(&path)?;
                    topology_changed = true;
                }
            }
            if topology_changed {
                self.refresh_links()?;
            }
            Ok(())
        })
    }

    fn refresh_note_files(
        &self,
        vault: &crate::vault::Vault,
        paths: &[String],
    ) -> Result<(), String> {
        self.atomic(|| {
            let mut identities = self
                .conn
                .prepare("SELECT path, title FROM notes")
                .map_err(|error| error.to_string())?
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<std::collections::BTreeMap<_, _>, _>>()
                .map_err(|error| error.to_string())?;
            let mut changes = std::collections::BTreeMap::new();
            let mut topology_changed = false;
            for changed in paths {
                let relative = Path::new(changed)
                    .strip_prefix(vault.root())
                    .map_err(|_| "watcher path is outside the vault")?
                    .to_string_lossy()
                    .replace('\\', "/");
                let full = vault.note_path(&relative)?;
                if full.is_file() {
                    let note = vault.read_note(&relative)?;
                    topology_changed |= identities.get(&relative) != Some(&note.title);
                    identities.insert(relative.clone(), note.title.clone());
                    changes.insert(relative, Some(note));
                } else {
                    topology_changed |= identities.remove(&relative).is_some();
                    changes.insert(relative, None);
                }
            }
            let resolver = LinkResolver::from_pairs(
                identities
                    .iter()
                    .map(|(path, title)| (path.as_str(), title.as_str())),
            );
            for (path, note) in changes {
                if let Some(note) = note {
                    self.remove_note_outgoing(&path)?;
                    let modified = std::fs::metadata(vault.root().join(&path))
                        .and_then(|metadata| metadata.modified())
                        .map_err(|error| error.to_string())?
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_nanos()
                        .min(i64::MAX as u128) as i64;
                    self.insert_note(&note, modified, &resolver)?;
                } else {
                    self.delete_note(&path)?;
                }
            }
            if topology_changed {
                self.refresh_links()?;
            }
            Ok(())
        })
    }

    pub fn affected_paths(
        &self,
        vault_root: &Path,
        paths: &[String],
    ) -> Result<Vec<String>, String> {
        let roots = paths
            .iter()
            .map(|path| {
                Path::new(path)
                    .strip_prefix(vault_root)
                    .map(|path| path.to_string_lossy().replace('\\', "/"))
                    .map_err(|_| "watcher path is outside the vault".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        self.conn
            .prepare("SELECT path FROM notes")
            .map_err(|error| error.to_string())?
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .filter_map(|path| match path {
                Ok(path)
                    if roots.iter().any(|root| {
                        root.is_empty() || path == *root || path.starts_with(&format!("{root}/"))
                    }) =>
                {
                    Some(Ok(path))
                }
                Ok(_) => None,
                Err(error) => Some(Err(error.to_string())),
            })
            .collect()
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

        let mut results = Vec::new();
        let mut seen_paths = std::collections::HashSet::new();

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

        for row in rows.flatten() {
            if seen_paths.insert(row.path.clone()) {
                results.push(row);
            }
        }

        if results.len() >= 50 {
            results.truncate(50);
            return Ok(results);
        }

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

        let fallback_rows = fallback
            .query_map(params![like_query], |row| self.search_row(row))
            .map_err(|error| format!("failed to run fallback search: {error}"))?;

        for row in fallback_rows.flatten() {
            if seen_paths.insert(row.path.clone()) {
                results.push(row);
            }
        }

        results.truncate(50);
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
                  summary,
                  tokenize='trigram'
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
        Self::from_pairs(
            notes
                .iter()
                .map(|note| (note.path.as_str(), note.title.as_str())),
        )
    }

    fn from_pairs<'a>(notes: impl IntoIterator<Item = (&'a str, &'a str)>) -> Self {
        let mut by_title = HashMap::new();
        let mut by_path = HashMap::new();
        for (path, title) in notes {
            by_title
                .entry(title.to_lowercase())
                .or_insert_with(|| path.to_string());
            by_path.insert(path.to_string(), path.to_string());
            if let Some(stem) = Path::new(path).file_stem().and_then(|value| value.to_str()) {
                by_title
                    .entry(stem.to_lowercase())
                    .or_insert_with(|| path.to_string());
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
        let mut target = after_bracket[1..target_end + 1].trim();

        // Strip angle brackets: [text](<url>) → url
        if (target.starts_with('<') && target.ends_with('>'))
            || (target.starts_with('"') && target.ends_with('"') && target.len() >= 2)
        {
            target = target[1..target.len() - 1].trim();
        }

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
    fn incremental_refresh_detects_subsecond_changes_and_preserves_incoming_links() {
        let directory = tempdir().unwrap();
        let vault = crate::vault::Vault::new(directory.path()).unwrap();
        vault
            .write_note("source.md", "# Source\n\n[[Target]]")
            .unwrap();
        let target = vault.write_note("target.md", "# Target\n\nBefore").unwrap();
        let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3")).unwrap();
        index
            .full_rebuild(vault.root(), &vault.scan().unwrap())
            .unwrap();
        let before = std::fs::metadata(vault.root().join("target.md"))
            .unwrap()
            .modified()
            .unwrap();
        vault.write_note("target.md", "# Target\n\nAfter").unwrap();
        let after = before + std::time::Duration::from_nanos(1);
        std::fs::OpenOptions::new()
            .write(true)
            .open(vault.root().join("target.md"))
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(after))
            .unwrap();
        index.lightweight_rebuild(vault.root()).unwrap();
        assert_eq!(index.backlinks(&target.path).unwrap().len(), 1);
        assert_eq!(index.search("After").unwrap().len(), 1);
    }

    #[test]
    fn watcher_paths_force_content_checks_even_when_size_and_timestamp_are_unchanged() {
        let directory = tempdir().unwrap();
        let vault = crate::vault::Vault::new(directory.path()).unwrap();
        vault.write_note("a.md", "# Note\n\nOld content").unwrap();
        let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3")).unwrap();
        index
            .full_rebuild(vault.root(), &vault.scan().unwrap())
            .unwrap();
        let path = vault.root().join("a.md");
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        std::fs::write(&path, "# Note\n\nNew content").unwrap();
        std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        index
            .refresh_paths(vault.root(), &[path.to_string_lossy().to_string()])
            .unwrap();
        assert_eq!(index.search("New content").unwrap().len(), 1);
    }

    #[test]
    fn failed_index_update_and_full_rebuild_keep_the_previous_searchable_state() {
        let directory = tempdir().unwrap();
        let vault = crate::vault::Vault::new(directory.path()).unwrap();
        let note = vault.write_note("a.md", "# Original").unwrap();
        let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3")).unwrap();
        index
            .full_rebuild(vault.root(), std::slice::from_ref(&note))
            .unwrap();
        index.conn.execute_batch("CREATE TRIGGER reject_tag BEFORE INSERT ON tags WHEN new.tag = 'reject' BEGIN SELECT RAISE(ABORT, 'test failure'); END").unwrap();
        let mut rejected = note.clone();
        rejected.title = "Rejected".into();
        rejected.tags = vec!["reject".into()];
        assert!(index
            .update_note(vault.root(), &rejected, std::slice::from_ref(&rejected))
            .is_err());
        assert!(index.full_rebuild(vault.root(), &[rejected]).is_err());
        assert_eq!(index.search("Original").unwrap().len(), 1);
        assert!(index.search("Rejected").unwrap().is_empty());
    }

    #[test]
    fn summaries_omit_bodies_and_new_targets_resolve_existing_links() {
        let directory = tempdir().unwrap();
        let vault = crate::vault::Vault::new(directory.path()).unwrap();
        vault
            .write_note("source.md", "# Source\n\n[[New target]]")
            .unwrap();
        let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3")).unwrap();
        index
            .full_rebuild(vault.root(), &vault.scan().unwrap())
            .unwrap();
        vault.write_note("new.md", "# New target").unwrap();
        index
            .refresh_paths(
                vault.root(),
                &[vault.root().join("new.md").to_string_lossy().to_string()],
            )
            .unwrap();
        assert_eq!(index.backlinks("new.md").unwrap().len(), 1);
        assert!(index
            .get_note_summaries()
            .unwrap()
            .iter()
            .all(|note| !note.body_loaded
                && note.body.is_empty()
                && !note.source_revision.is_empty()));
    }

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
        index
            .full_rebuild(vault.root(), &vault.scan().unwrap())
            .unwrap();
        assert_eq!(index.search("stale").unwrap().len(), 1);

        fs::remove_file(dir.path().join("knowledge/old.md")).unwrap();
        index
            .full_rebuild(vault.root(), &vault.scan().unwrap())
            .unwrap();

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
        index
            .full_rebuild(vault.root(), &vault.scan().unwrap())
            .unwrap();
        assert_eq!(index.search("targetonly").unwrap().len(), 1);
        assert_eq!(index.backlinks("knowledge/target.md").unwrap().len(), 1);

        index.delete_note("knowledge/target.md").unwrap();

        assert!(index.search("targetonly").unwrap().is_empty());
        assert!(index.backlinks("knowledge/target.md").unwrap().is_empty());
        assert!(index
            .outgoing_links("knowledge/source.md")
            .unwrap()
            .is_empty());
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
        index
            .full_rebuild(vault.root(), &vault.scan().unwrap())
            .unwrap();

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

    #[test]
    fn rebuild_extracts_angle_bracket_and_quoted_url_links() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();
        vault
            .write_note(
                "knowledge/source.md",
                "---\ntitle: Source Note\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nAngle bracket [POI](< ./POI更新策略.md>) and quoted [POI2](\"./POI更新策略.md\").",
            )
            .unwrap();
        vault
            .write_note(
                "knowledge/POI更新策略.md",
                "---\ntitle: POI更新策略\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nPOI body.",
            )
            .unwrap();

        let index = NoteIndex::open(dir.path().join(".inote/index.sqlite3")).unwrap();
        index
            .full_rebuild(vault.root(), &vault.scan().unwrap())
            .unwrap();

        let outgoing = index.outgoing_links("knowledge/source.md").unwrap();
        let backlinks = index.backlinks("knowledge/POI更新策略.md").unwrap();

        assert_eq!(
            outgoing.len(),
            2,
            "expected 2 outgoing links, got: {outgoing:?}"
        );
        assert!(outgoing
            .iter()
            .all(|link| link.target_path == "knowledge/POI更新策略.md"));
        assert_eq!(
            backlinks.len(),
            2,
            "expected 2 backlinks, got: {backlinks:?}"
        );
        assert!(backlinks
            .iter()
            .all(|link| link.source_path == "knowledge/source.md"));
    }

    #[test]
    fn update_note_preserves_backlinks() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();
        vault
            .write_note(
                "knowledge/source.md",
                "---\ntitle: Source Note\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nLinks to [[Target Note]].",
            )
            .unwrap();
        vault
            .write_note(
                "knowledge/target.md",
                "---\ntitle: Target Note\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nOriginal body.",
            )
            .unwrap();

        let index = NoteIndex::open(dir.path().join(".inote/index.sqlite3")).unwrap();
        let notes = vault.scan().unwrap();
        index.full_rebuild(vault.root(), &notes).unwrap();
        assert_eq!(index.backlinks("knowledge/target.md").unwrap().len(), 1);

        // Update target note (simulates saving) — backlinks from source should survive
        vault
            .write_note(
                "knowledge/target.md",
                "---\ntitle: Target Note\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\nUpdated body.",
            )
            .unwrap();
        let updated_notes = vault.scan().unwrap();
        let target = updated_notes
            .iter()
            .find(|n| n.path == "knowledge/target.md")
            .unwrap();
        index
            .update_note(vault.root(), target, &updated_notes)
            .unwrap();

        let backlinks = index.backlinks("knowledge/target.md").unwrap();
        assert_eq!(
            backlinks.len(),
            1,
            "backlink from source should be preserved after updating target"
        );
        assert_eq!(backlinks[0].source_path, "knowledge/source.md");
    }
}
