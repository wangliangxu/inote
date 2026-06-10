use crate::markdown::{build_note, parse_note, NoteMetadata};
use chrono::Local;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
}

impl Vault {
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, String> {
        let root = root.into();
        if !root.exists() {
            fs::create_dir_all(&root).map_err(|error| format!("failed to create vault: {error}"))?;
        }
        if !root.is_dir() {
            return Err("vault path must be a directory".to_string());
        }
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
            fs::create_dir_all(self.root.join(folder))
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
        for entry in WalkDir::new(&self.root).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("md") {
                notes.push(parse_note(&self.root, path)?);
            }
        }
        notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.title.cmp(&b.title)));
        Ok(notes)
    }

    pub fn read_note(&self, relative_path: &str) -> Result<NoteMetadata, String> {
        let path = self.safe_path(relative_path)?;
        parse_note(&self.root, &path)
    }

    pub fn write_note(&self, relative_path: &str, content: &str) -> Result<NoteMetadata, String> {
        let path = self.safe_path(relative_path)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("failed to create note folder: {error}"))?;
        }

        let tmp = path.with_extension("md.tmp");
        fs::write(&tmp, content).map_err(|error| format!("failed to write temp note: {error}"))?;
        fs::rename(&tmp, &path).map_err(|error| format!("failed to replace note: {error}"))?;
        parse_note(&self.root, &path)
    }

    pub fn create_inbox_note(&self, title: &str) -> Result<NoteMetadata, String> {
        let date = Local::now().format("%Y-%m-%d").to_string();
        let slug = slugify(title);
        let relative_path = format!("00-inbox/{date}-{slug}.md");
        let body = format!("# {title}\n\n");
        let content = build_note(title, "00-inbox", &["inbox".to_string()], &date, &body);
        self.write_note(&relative_path, &content)
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
        self.write_note(&relative_path, &content)
    }

    pub fn create_today_note(&self) -> Result<NoteMetadata, String> {
        let date = Local::now().format("%Y-%m-%d").to_string();
        let year = Local::now().format("%Y").to_string();
        let month = Local::now().format("%m").to_string();
        let relative_path = format!("journal/{year}/{month}/{date}.md");
        let path = self.safe_path(&relative_path)?;
        if path.exists() {
            return self.read_note(&relative_path);
        }

        let body = format!("# {date}\n\n## Notes\n\n## Review\n\n");
        let content = build_note(&date, "journal", &["journal".to_string()], &date, &body);
        self.write_note(&relative_path, &content)
    }

    pub fn move_note(&self, from: &str, to: &str) -> Result<NoteMetadata, String> {
        let from_path = self.safe_path(from)?;
        let to_path = self.safe_path(to)?;
        if let Some(parent) = to_path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("failed to create destination folder: {error}"))?;
        }
        fs::rename(&from_path, &to_path).map_err(|error| format!("failed to move note: {error}"))?;
        parse_note(&self.root, &to_path)
    }

    pub fn delete_note(&self, relative_path: &str) -> Result<(), String> {
        let path = self.safe_path(relative_path)?;
        fs::remove_file(path).map_err(|error| format!("failed to delete note: {error}"))
    }

    fn safe_path(&self, relative_path: &str) -> Result<PathBuf, String> {
        if relative_path.contains("..") || Path::new(relative_path).is_absolute() {
            return Err("note path must stay inside the vault".to_string());
        }
        Ok(self.root.join(relative_path))
    }
}

fn slugify(title: &str) -> String {
    let slug = title
        .to_lowercase()
        .chars()
        .map(|value| if value.is_ascii_alphanumeric() { value } else { '-' })
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
    if trimmed.chars().any(|value| !value.is_ascii()) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

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
    fn writes_moves_and_deletes_note() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();

        vault.write_note("00-inbox/a.md", "# A\n\nBody").unwrap();
        let moved = vault.move_note("00-inbox/a.md", "knowledge/a.md").unwrap();
        assert_eq!(moved.path, "knowledge/a.md");
        assert!(!dir.path().join("00-inbox/a.md").exists());

        vault.delete_note("knowledge/a.md").unwrap();
        assert!(!dir.path().join("knowledge/a.md").exists());
    }

    #[test]
    fn creates_category_note_and_unique_filename() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();

        let first = vault.create_note("城市网络大模型", "knowledge/cities").unwrap();
        let second = vault.create_note("城市网络大模型", "knowledge/cities").unwrap();

        assert_eq!(first.path, "knowledge/cities/城市网络大模型.md");
        assert_eq!(second.path, "knowledge/cities/城市网络大模型-2.md");
        assert!(dir.path().join("knowledge/cities/城市网络大模型.md").exists());
    }

    #[test]
    fn rejects_paths_outside_vault() {
        let dir = tempdir().unwrap();
        let vault = Vault::new(dir.path()).unwrap();

        assert!(vault.write_note("../escape.md", "bad").is_err());
    }
}
