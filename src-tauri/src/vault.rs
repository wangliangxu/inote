use crate::markdown::{build_note, build_note_with_dates, parse_note, NoteMetadata};
use chrono::{Datelike, Local, NaiveDate};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveNote {
    pub from: String,
    pub title: String,
    pub category: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub body: String,
}

impl Vault {
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, String> {
        let root = root.into();
        if !root.exists() {
            fs::create_dir_all(&root)
                .map_err(|error| format!("failed to create vault: {error}"))?;
        }
        if !root.is_dir() {
            return Err("vault path must be a directory".to_string());
        }
        let root =
            fs::canonicalize(root).map_err(|error| format!("failed to resolve vault: {error}"))?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn create_starter_structure(&self) -> Result<(), String> {
        for folder in [
            "00-inbox",
            "journal",
            "knowledge/rust",
            "knowledge/ai",
            "projects/inote",
            "resources/books",
        ] {
            fs::create_dir_all(self.safe_path(folder)?)
                .map_err(|error| format!("failed to create starter folder {folder}: {error}"))?;
        }
        Ok(())
    }

    pub fn create_folder(&self, relative_path: &str) -> Result<(), String> {
        let path = self.safe_path(relative_path)?;
        fs::create_dir_all(&path).map_err(|error| format!("failed to create folder: {error}"))
    }

    pub fn scan(&self) -> Result<Vec<NoteMetadata>, String> {
        let mut notes = Vec::new();
        for entry in WalkDir::new(&self.root).into_iter().filter_entry(|entry| {
            entry.depth() == 0
                || !matches!(
                    entry.file_name().to_str(),
                    Some(".inote" | ".git" | "node_modules")
                )
        }) {
            let entry = entry.map_err(|error| format!("failed to scan vault: {error}"))?;
            let path = entry.path();
            if entry.file_type().is_file()
                && path.extension().and_then(|value| value.to_str()) == Some("md")
            {
                notes.push(parse_note(&self.root, path)?);
            }
        }
        notes.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then_with(|| a.title.cmp(&b.title))
        });
        Ok(notes)
    }

    pub fn read_note(&self, relative_path: &str) -> Result<NoteMetadata, String> {
        let path = self.note_path(relative_path)?;
        parse_note(&self.root, &path)
    }

    pub fn read_note_source(&self, relative_path: &str) -> Result<String, String> {
        let path = self.note_path(relative_path)?;
        fs::read_to_string(path).map_err(|error| format!("failed to read note source: {error}"))
    }

    pub fn write_note(&self, relative_path: &str, content: &str) -> Result<NoteMetadata, String> {
        let path = self.note_path(relative_path)?;
        crate::markdown::parse_note_content(&self.root, &path, content)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create note folder: {error}"))?;
        }

        self.persist_content(&path, content, false)?;
        parse_note(&self.root, &path)
    }

    pub(crate) fn persist_content(
        &self,
        path: &Path,
        content: &str,
        no_clobber: bool,
    ) -> Result<(), String> {
        let parent = path.parent().ok_or("missing note directory")?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create note folder: {error}"))?;
        let mut temporary = tempfile::Builder::new()
            .prefix(".inote-tmp-")
            .tempfile_in(parent)
            .map_err(|error| format!("failed to create temporary note: {error}"))?;
        temporary
            .write_all(content.as_bytes())
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|error| format!("failed to write note: {error}"))?;
        if no_clobber {
            temporary.persist_noclobber(path).map_err(|error| {
                format!("destination already exists or cannot be created: {error}")
            })?;
        } else {
            temporary
                .persist(path)
                .map_err(|error| format!("failed to replace note: {error}"))?;
        }
        Ok(())
    }

    pub fn check_revision(&self, path: &str, expected: Option<&str>) -> Result<(), String> {
        if let Some(expected) = expected {
            let source = self.read_note_source(path).map_err(|_| "The note was removed on disk. Recover the draft to a new note instead of overwriting.".to_string())?;
            if crate::markdown::source_revision(&source) != expected {
                return Err(
                    "The note changed on disk. Reload or resolve the conflict before saving."
                        .to_string(),
                );
            }
        }
        Ok(())
    }

    pub fn write_note_image(
        &self,
        note_path: &str,
        extension: &str,
        bytes: &[u8],
    ) -> Result<String, String> {
        let note_path = self.note_path(note_path)?;
        let note_directory = note_path.parent().unwrap_or(&self.root);
        let note_stem = note_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("note");
        let relative_directory = note_directory
            .strip_prefix(&self.root)
            .map_err(|error| error.to_string())?
            .join("_assets")
            .join(note_stem);
        let asset_directory =
            self.safe_path(&relative_directory.to_string_lossy().replace('\\', "/"))?;
        fs::create_dir_all(&asset_directory)
            .map_err(|error| format!("failed to create image asset folder: {error}"))?;

        let timestamp = Local::now().format("%Y%m%d-%H%M%S-%3f");
        let mut sequence = 0_u32;
        let image_path = loop {
            let suffix = if sequence == 0 {
                String::new()
            } else {
                format!("-{sequence}")
            };
            let candidate = asset_directory.join(format!("image-{timestamp}{suffix}.{extension}"));
            if !candidate.exists() {
                break candidate;
            }
            sequence += 1;
        };

        fs::write(&image_path, bytes)
            .map_err(|error| format!("failed to save pasted image: {error}"))?;
        image_path
            .strip_prefix(note_directory)
            .map_err(|_| "failed to create relative image path".to_string())
            .map(|path| path.to_string_lossy().replace('\\', "/"))
    }

    pub fn create_inbox_note(&self, title: &str) -> Result<NoteMetadata, String> {
        let date = Local::now().format("%Y-%m-%d").to_string();
        let slug = slugify(title);
        let relative_path = unique_note_path(&self.root, "00-inbox", &format!("{date}-{slug}"));
        let body = format!("# {title}\n\n");
        let content = build_note(title, "00-inbox", &["inbox".to_string()], &date, &body);
        self.persist_content(&self.note_path(&relative_path)?, &content, true)?;
        self.read_note(&relative_path)
    }

    pub fn create_note(&self, title: &str, category: &str) -> Result<NoteMetadata, String> {
        let clean_title = title.trim();
        if clean_title.is_empty() {
            return Err("note title is required".to_string());
        }
        let clean_category = category.trim().trim_matches('/');
        if clean_category.is_empty() {
            return Err("note category is required".to_string());
        }

        self.create_folder(clean_category)?;

        let date = Local::now().format("%Y-%m-%d").to_string();
        let filename = filename_for_title(clean_title);
        let relative_path = unique_note_path(&self.root, clean_category, &filename);
        let body = format!("# {clean_title}\n\n");
        let content = build_note(clean_title, clean_category, &[], &date, &body);
        self.persist_content(&self.note_path(&relative_path)?, &content, true)?;
        self.read_note(&relative_path)
    }

    pub fn create_today_note(&self, category: &str) -> Result<NoteMetadata, String> {
        let clean_category = category.trim().trim_matches('/');
        let effective_category = if clean_category.is_empty() {
            "journal"
        } else {
            clean_category
        };

        let date = Local::now().format("%Y-%m-%d").to_string();

        let relative_path = if effective_category == "journal" {
            let year = Local::now().format("%Y").to_string();
            let month = Local::now().format("%m").to_string();
            format!("journal/{year}/{month}/{date}.md")
        } else {
            format!("{effective_category}/{date}.md")
        };

        let path = self.safe_path(&relative_path)?;
        if path.exists() {
            return self.read_note(&relative_path);
        }

        let body = format!("# {date}\n\n## Notes\n\n## Review\n\n");
        let content = build_note(
            &date,
            effective_category,
            &["journal".to_string()],
            &date,
            &body,
        );
        self.write_note(&relative_path, &content)
    }

    pub fn create_weekly_review(&self, date: &str) -> Result<NoteMetadata, String> {
        let target = parse_review_date(date)?;
        let week = target.iso_week();
        let title = format!("Weekly Review {}-W{:02}", week.year(), week.week());
        let relative_path = format!(
            "journal/reviews/{}-W{:02}-review.md",
            week.year(),
            week.week()
        );
        let notes = self.review_notes(|note_date| note_date.iso_week() == week)?;
        let body = build_review_body(&title, &notes);
        let tags = vec![
            "journal".to_string(),
            "review".to_string(),
            "weekly".to_string(),
        ];
        let content = build_note(&title, "journal/reviews", &tags, date, &body);
        self.write_note(&relative_path, &content)
    }

    pub fn create_monthly_review(&self, date: &str) -> Result<NoteMetadata, String> {
        let target = parse_review_date(date)?;
        let title = format!("Monthly Review {}-{:02}", target.year(), target.month());
        let relative_path = format!(
            "journal/reviews/{}-{:02}-review.md",
            target.year(),
            target.month()
        );
        let notes = self.review_notes(|note_date| {
            note_date.year() == target.year() && note_date.month() == target.month()
        })?;
        let body = build_review_body(&title, &notes);
        let tags = vec![
            "journal".to_string(),
            "review".to_string(),
            "monthly".to_string(),
        ];
        let content = build_note(&title, "journal/reviews", &tags, date, &body);
        self.write_note(&relative_path, &content)
    }

    pub fn move_note(&self, from: &str, to: &str) -> Result<NoteMetadata, String> {
        let source = self.read_note_source(from)?;
        self.save_note_at(from, to, &source, None, None)
    }

    pub fn save_note_at(
        &self,
        from: &str,
        to: &str,
        content: &str,
        expected: Option<&str>,
        content_path: Option<&str>,
    ) -> Result<NoteMetadata, String> {
        let from_path = self.note_path(from)?;
        let to_path = self.note_path(to)?;
        self.check_revision(from, expected)?;
        if from == to {
            return self.write_note(from, content);
        }
        if to_path.exists() {
            return Err("destination already exists".to_string());
        }
        // Assets remain at their stable location; references follow the moved note.
        let content =
            crate::markdown_paths::rebase_markdown(content, content_path.unwrap_or(from), to);
        self.persist_content(&to_path, &content, true)?;
        let note = match self.read_note(to) {
            Ok(note) => note,
            Err(error) => {
                let _ = fs::remove_file(&to_path);
                return Err(error);
            }
        };
        if let Err(error) = fs::remove_file(&from_path) {
            let _ = fs::remove_file(&to_path);
            return Err(format!("failed to remove original note: {error}"));
        }
        Ok(note)
    }

    pub fn archive_note(&self, input: ArchiveNote) -> Result<NoteMetadata, String> {
        let from_path = self.safe_path(&input.from)?;
        if !input.from.starts_with("00-inbox/") {
            return Err("only inbox notes can be archived".to_string());
        }
        if !from_path.exists() {
            return Err("inbox note does not exist".to_string());
        }

        let title = input.title.trim();
        if title.is_empty() {
            return Err("note title is required".to_string());
        }
        let category = input.category.trim().trim_matches('/');
        if category.is_empty() || category == "00-inbox" || category.starts_with("00-inbox/") {
            return Err("archive category must be outside the inbox".to_string());
        }
        parse_review_date(&input.created_at)?;

        self.create_folder(category)?;
        let filename = filename_for_title(title);
        let relative_path = unique_note_path(&self.root, category, &filename);
        let updated_at = Local::now().format("%Y-%m-%d").to_string();
        let content = build_note_with_dates(
            title,
            category,
            &input.tags,
            &input.created_at,
            &updated_at,
            &input.body,
        );
        let archived = self.write_note(&relative_path, &content)?;
        fs::remove_file(from_path)
            .map_err(|error| format!("failed to remove inbox note: {error}"))?;
        Ok(archived)
    }

    pub fn delete_note(&self, relative_path: &str) -> Result<(), String> {
        let path = self.note_path(relative_path)?;
        if !path.exists() {
            return Err("note does not exist".to_string());
        }
        if relative_path.starts_with(".trash/") {
            return fs::remove_file(path)
                .map_err(|error| format!("failed to permanently delete note: {error}"));
        }
        let trash_root = self.safe_path(".trash")?;
        fs::create_dir_all(&trash_root)
            .map_err(|error| format!("failed to create trash folder: {error}"))?;
        let filename = path
            .file_name()
            .ok_or_else(|| "note path must include a file name".to_string())?
            .to_string_lossy()
            .to_string();
        let date = Local::now().format("%Y-%m-%d").to_string();
        let stem = filename.trim_end_matches(".md");
        let mut destination = trash_root.join(format!("{date}-{stem}.md"));
        let mut index = 2;
        while destination.exists() {
            destination = trash_root.join(format!("{date}-{stem}-{index}.md"));
            index += 1;
        }
        let relative = destination
            .strip_prefix(&self.root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        self.move_note(relative_path, &relative).map(|_| ())
    }

    pub fn empty_trash(&self) -> Result<(), String> {
        let trash_root = self.safe_path(".trash")?;
        if trash_root.exists() {
            fs::remove_dir_all(&trash_root)
                .map_err(|error| format!("failed to empty trash: {error}"))?;
            fs::create_dir_all(&trash_root)
                .map_err(|error| format!("failed to recreate trash folder: {error}"))?;
        }
        Ok(())
    }

    fn review_notes(
        &self,
        include: impl Fn(NaiveDate) -> bool,
    ) -> Result<Vec<NoteMetadata>, String> {
        let mut notes = self
            .scan()?
            .into_iter()
            .filter(|note| note.category == "journal" || note.category.starts_with("journal/"))
            .filter(|note| {
                note.category != "journal/reviews" && !note.category.starts_with("journal/reviews/")
            })
            .filter(|note| parse_review_date(&note.created_at).is_ok_and(&include))
            .collect::<Vec<_>>();
        notes.sort_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.path.cmp(&b.path))
        });
        Ok(notes)
    }

    pub(crate) fn safe_path(&self, relative_path: &str) -> Result<PathBuf, String> {
        let relative = Path::new(relative_path);
        if relative_path.is_empty()
            || relative_path.contains('\\')
            || relative
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err("note path must stay inside the vault".to_string());
        }
        let path = self.root.join(relative);
        let mut ancestor = path.as_path();
        while !ancestor.exists() {
            if fs::symlink_metadata(ancestor).is_ok() {
                return Err("broken symbolic links are not valid vault paths".to_string());
            }
            ancestor = ancestor.parent().ok_or("invalid vault path")?;
        }
        let resolved = fs::canonicalize(ancestor)
            .map_err(|error| format!("failed to resolve note path: {error}"))?;
        if !resolved.starts_with(&self.root) {
            return Err("note path must stay inside the vault".to_string());
        }
        Ok(path)
    }

    pub(crate) fn note_path(&self, relative_path: &str) -> Result<PathBuf, String> {
        let path = self.safe_path(relative_path)?;
        if path.extension().and_then(|extension| extension.to_str()) != Some("md")
            || relative_path
                .split('/')
                .any(|part| matches!(part, ".inote" | ".git"))
        {
            return Err("note path must refer to a Markdown file".to_string());
        }
        Ok(path)
    }
}

fn slugify(title: &str) -> String {
    let slug = title
        .to_lowercase()
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() {
                value
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if slug.is_empty() {
        "note".to_string()
    } else {
        slug
    }
}

fn filename_for_title(title: &str) -> String {
    let trimmed = title.trim();
    if !trimmed.is_ascii() {
        sanitize_filename(trimmed)
    } else {
        slugify(trimmed)
    }
}

fn sanitize_filename(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            other => other,
        })
        .collect::<String>()
        .trim_matches(|ch| ch == '-' || ch == ' ')
        .to_string();

    if sanitized.is_empty() {
        "note".to_string()
    } else {
        sanitized
    }
}

fn unique_note_path(root: &Path, category: &str, filename: &str) -> String {
    let mut candidate = format!("{category}/{filename}.md");
    let mut index = 2;
    while root.join(&candidate).exists() {
        candidate = format!("{category}/{filename}-{index}.md");
        index += 1;
    }
    candidate
}

fn parse_review_date(date: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|error| format!("invalid review date {date}: {error}"))
}

fn build_review_body(title: &str, notes: &[NoteMetadata]) -> String {
    let reviewed = if notes.is_empty() {
        "No journal notes found for this period.".to_string()
    } else {
        notes
            .iter()
            .map(|note| format!("- {} - [{}]({})", note.created_at, note.title, note.path))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!("# {title}\n\n## Notes Reviewed\n\n{reviewed}\n\n## Highlights\n\n## Follow-ups\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_links_outside_the_vault_for_notes_and_assets() {
        let directory = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let vault = Vault::new(directory.path()).unwrap();
        fs::write(outside.path().join("private.md"), "private").unwrap();
        std::os::unix::fs::symlink(outside.path(), vault.root().join("escape")).unwrap();
        assert!(vault.read_note("escape/private.md").is_err());
        assert!(vault.write_note("escape/new.md", "bad").is_err());
        vault.write_note("notes/a.md", "# A").unwrap();
        std::os::unix::fs::symlink(outside.path(), vault.root().join("notes/_assets")).unwrap();
        assert!(vault
            .write_note_image("notes/a.md", "png", b"bytes")
            .is_err());
        assert!(!outside.path().join("new.md").exists());
    }

    #[test]
    fn invalid_frontmatter_remains_readable_as_raw_markdown() {
        let directory = tempdir().unwrap();
        let vault = Vault::new(directory.path()).unwrap();
        let source = "---\ntitle: [unfinished\n---\n\nBody";
        fs::write(vault.root().join("broken.md"), source).unwrap();
        let note = vault.read_note("broken.md").unwrap();
        assert_eq!(note.raw_markdown.as_deref(), Some(source));
        assert_eq!(vault.scan().unwrap().len(), 1);
        assert!(vault.write_note("broken.md", source).is_err());
        assert_eq!(vault.read_note_source("broken.md").unwrap(), source);
    }

    #[test]
    fn creates_starter_structure() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();

        vault.create_starter_structure().unwrap();

        assert!(dir.path().join("00-inbox").exists());
        assert!(dir.path().join("knowledge/rust").exists());
        assert!(dir.path().join("resources/books").exists());
    }

    #[test]
    fn scans_markdown_notes() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();
        vault
            .write_note("knowledge/rust/test.md", "# Rust Note\n\nBody")
            .unwrap();
        fs::write(dir.path().join("ignored.txt"), "ignored").unwrap();

        let notes = vault.scan().unwrap();

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "Rust Note");
        assert_eq!(notes[0].category, "knowledge/rust");
    }

    #[test]
    fn saves_note_images_beside_the_note_as_relative_assets() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();
        vault
            .write_note("knowledge/rust/ownership.md", "# Ownership")
            .unwrap();

        let relative_path = vault
            .write_note_image("knowledge/rust/ownership.md", "png", b"png-bytes")
            .unwrap();

        assert!(relative_path.starts_with("_assets/ownership/image-"));
        assert!(relative_path.ends_with(".png"));
        assert_eq!(
            fs::read(dir.path().join("knowledge/rust").join(relative_path)).unwrap(),
            b"png-bytes",
        );
    }

    #[test]
    fn writes_moves_and_deletes_note() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();

        vault.write_note("00-inbox/a.md", "# A\n\nBody").unwrap();
        let moved = vault.move_note("00-inbox/a.md", "knowledge/a.md").unwrap();
        assert_eq!(moved.path, "knowledge/a.md");
        assert!(!dir.path().join("00-inbox/a.md").exists());

        vault.delete_note("knowledge/a.md").unwrap();
        assert!(!dir.path().join("knowledge/a.md").exists());
        let scanned = vault.scan().unwrap();
        assert_eq!(scanned.len(), 1);
        assert!(scanned[0].path.starts_with(".trash/"));
        assert_eq!(fs::read_dir(dir.path().join(".trash")).unwrap().count(), 1);
    }

    #[test]
    fn creates_category_note_and_unique_filename() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();

        let first = vault
            .create_note("城市网络大模型", "knowledge/cities")
            .unwrap();
        let second = vault
            .create_note("城市网络大模型", "knowledge/cities")
            .unwrap();

        assert_eq!(first.path, "knowledge/cities/城市网络大模型.md");
        assert_eq!(second.path, "knowledge/cities/城市网络大模型-2.md");
        assert!(dir
            .path()
            .join("knowledge/cities/城市网络大模型.md")
            .exists());
    }

    #[test]
    fn archives_inbox_note_to_unique_category_path() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();

        vault
            .write_note(
                "00-inbox/idea.md",
                "---\ntitle: Raw Idea\ncategory: 00-inbox\ntags: [inbox]\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\n# Raw Idea\n\nBody.",
            )
            .unwrap();
        vault
            .write_note(
                "knowledge/ai/refined-idea.md",
                "---\ntitle: Existing\ncategory: knowledge/ai\ntags: []\ncreated_at: 2026-06-09\nupdated_at: 2026-06-09\n---\n\nExisting.",
            )
            .unwrap();

        let archived = vault
            .archive_note(ArchiveNote {
                from: "00-inbox/idea.md".to_string(),
                title: "Refined Idea".to_string(),
                category: "knowledge/ai".to_string(),
                tags: vec!["ai".to_string()],
                created_at: "2026-06-10".to_string(),
                body: "# Raw Idea\n\nBody.".to_string(),
            })
            .unwrap();

        assert_eq!(archived.path, "knowledge/ai/refined-idea-2.md");
        assert_eq!(archived.title, "Refined Idea");
        assert_eq!(archived.category, "knowledge/ai");
        assert_eq!(archived.tags, vec!["ai"]);
        assert!(!dir.path().join("00-inbox/idea.md").exists());
        assert!(dir.path().join("knowledge/ai/refined-idea.md").exists());
    }

    #[test]
    fn creates_weekly_review_from_journal_notes() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();

        vault
            .write_note(
                "journal/2026/06/2026-06-08.md",
                "---\ntitle: Monday\ncategory: journal\ntags: [journal]\ncreated_at: 2026-06-08\nupdated_at: 2026-06-08\n---\n\n# Monday\n\nStart.",
            )
            .unwrap();
        vault
            .write_note(
                "journal/2026/06/2026-06-10.md",
                "---\ntitle: Wednesday\ncategory: journal\ntags: [journal]\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\n# Wednesday\n\nMiddle.",
            )
            .unwrap();
        vault
            .write_note(
                "journal/2026/06/2026-06-01.md",
                "---\ntitle: Previous Week\ncategory: journal\ntags: [journal]\ncreated_at: 2026-06-01\nupdated_at: 2026-06-01\n---\n\n# Previous Week\n\nOld.",
            )
            .unwrap();

        let review = vault.create_weekly_review("2026-06-10").unwrap();

        assert_eq!(review.path, "journal/reviews/2026-W24-review.md");
        assert_eq!(review.category, "journal/reviews");
        assert!(review.tags.contains(&"weekly".to_string()));
        assert!(review
            .body
            .contains("[Monday](journal/2026/06/2026-06-08.md)"));
        assert!(review
            .body
            .contains("[Wednesday](journal/2026/06/2026-06-10.md)"));
        assert!(!review.body.contains("Previous Week"));
    }

    #[test]
    fn creates_monthly_review_from_journal_notes() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();

        vault
            .write_note(
                "journal/2026/06/2026-06-10.md",
                "---\ntitle: June Note\ncategory: journal\ntags: [journal]\ncreated_at: 2026-06-10\nupdated_at: 2026-06-10\n---\n\n# June Note\n\nBody.",
            )
            .unwrap();
        vault
            .write_note(
                "journal/2026/05/2026-05-31.md",
                "---\ntitle: May Note\ncategory: journal\ntags: [journal]\ncreated_at: 2026-05-31\nupdated_at: 2026-05-31\n---\n\n# May Note\n\nBody.",
            )
            .unwrap();

        let review = vault.create_monthly_review("2026-06-10").unwrap();

        assert_eq!(review.path, "journal/reviews/2026-06-review.md");
        assert_eq!(review.title, "Monthly Review 2026-06");
        assert!(review.tags.contains(&"monthly".to_string()));
        assert!(review
            .body
            .contains("[June Note](journal/2026/06/2026-06-10.md)"));
        assert!(!review.body.contains("May Note"));
    }

    #[test]
    fn rejects_paths_outside_vault() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();

        assert!(vault.write_note("../escape.md", "bad").is_err());
    }
}
