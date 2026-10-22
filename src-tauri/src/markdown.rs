use chrono::{DateTime, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetadata {
    pub path: String,
    pub title: String,
    pub category: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub due: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub project: Option<String>,
    pub summary: Option<String>,
    pub body: String,
    pub word_count: usize,
    #[serde(default)]
    pub source_revision: String,
    #[serde(default)]
    pub source_size: u64,
    #[serde(default = "loaded_body")]
    pub body_loaded: bool,
    pub excerpt: Option<String>,
    #[serde(default)]
    pub frontmatter: BTreeMap<String, serde_json::Value>,
    pub frontmatter_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_markdown: Option<String>,
}

fn loaded_body() -> bool {
    true
}

pub fn source_revision(source: &str) -> String {
    ring::digest::digest(&ring::digest::SHA256, source.as_bytes())
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[derive(Debug, Clone, Deserialize, Default)]
struct Frontmatter {
    title: Option<String>,
    tags: Option<Vec<String>>,
    created: Option<String>,
    updated: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    due: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    project: Option<String>,
    summary: Option<String>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

pub fn parse_note(root: &Path, path: &Path) -> Result<NoteMetadata, String> {
    let raw = fs::read_to_string(path).map_err(|error| format!("failed to read note: {error}"))?;
    parse_note_impl(root, path, &raw, false)
}

pub fn parse_note_content(root: &Path, path: &Path, raw: &str) -> Result<NoteMetadata, String> {
    parse_note_impl(root, path, raw, true)
}

fn parse_note_impl(
    root: &Path,
    path: &Path,
    raw: &str,
    validate: bool,
) -> Result<NoteMetadata, String> {
    let relative_path = relative_path(root, path)?;
    let (frontmatter, body) = split_frontmatter(raw);
    let mut invalid = false;
    let parsed = match frontmatter.as_deref() {
        Some(yaml) => match serde_yaml::from_str::<Frontmatter>(yaml) {
            Ok(parsed) => parsed,
            Err(error) if validate => {
                return Err(format!("invalid frontmatter in {relative_path}: {error}"))
            }
            Err(_) => {
                invalid = true;
                Frontmatter::default()
            }
        },
        None => Frontmatter::default(),
    };

    let category = category_from_path(&relative_path);
    let title = parsed
        .title
        .or_else(|| first_heading(&body))
        .unwrap_or_else(|| title_from_path(&relative_path));
    let created_at = parsed
        .created_at
        .or(parsed.created)
        .or_else(|| date_from_filename(&relative_path))
        .unwrap_or_else(|| file_date(path));
    let updated_at = parsed
        .updated_at
        .or(parsed.updated)
        .unwrap_or_else(|| file_date(path));
    let word_count = count_words(&body);

    Ok(NoteMetadata {
        path: relative_path,
        title,
        category,
        tags: parsed.tags.unwrap_or_default(),
        created_at,
        updated_at,
        due: parsed.due,
        status: parsed.status,
        priority: parsed.priority,
        project: parsed.project,
        summary: parsed.summary,
        body,
        word_count,
        source_revision: source_revision(raw),
        source_size: raw.len() as u64,
        body_loaded: true,
        excerpt: None,
        frontmatter: parsed.extra,
        frontmatter_source: frontmatter,
        raw_markdown: invalid.then(|| raw.to_string()),
    })
}

pub fn build_note(title: &str, category: &str, tags: &[String], date: &str, body: &str) -> String {
    build_note_with_dates(title, category, tags, date, date, body)
}

pub fn build_note_with_dates(
    title: &str,
    _category: &str,
    tags: &[String],
    created_at: &str,
    updated_at: &str,
    body: &str,
) -> String {
    let tag_list = serde_json::to_string(tags).expect("string list is serializable");
    let title = serde_json::to_string(title).expect("string is serializable");
    format!(
        "---\ntitle: {title}\ntags: {tag_list}\ncreated_at: {created_at}\nupdated_at: {updated_at}\n---\n\n{body}"
    )
}

pub fn title_from_path(path: &str) -> String {
    let stem = Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled");
    let without_date = stem
        .strip_prefix_date()
        .trim_matches(|value| value == '-' || value == '_' || value == ' ');
    let title = without_date
        .split(|value: char| value == '-' || value == '_' || value.is_whitespace())
        .filter(|part| !part.is_empty())
        .map(capitalize)
        .collect::<Vec<_>>()
        .join(" ");

    if title.is_empty() {
        "Untitled".to_string()
    } else {
        title
    }
}

pub fn category_from_path(path: &str) -> String {
    Path::new(path)
        .parent()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("uncategorized")
        .replace('\\', "/")
}

fn split_frontmatter(raw: &str) -> (Option<String>, String) {
    let source = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let mut lines = source.split_inclusive('\n');
    let first = lines.next().unwrap_or("");
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return (None, raw.to_string());
    }
    let mut offset = first.len();
    for line in lines {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            let yaml = source[first.len()..offset]
                .trim_end_matches(['\r', '\n'])
                .to_string();
            let body = source[offset + line.len()..].to_string();
            return (
                Some(yaml),
                body.strip_prefix("\r\n")
                    .or_else(|| body.strip_prefix('\n'))
                    .unwrap_or(&body)
                    .to_string(),
            );
        }
        offset += line.len();
    }
    (None, raw.to_string())
}

fn first_heading(body: &str) -> Option<String> {
    body.lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn count_words(body: &str) -> usize {
    let mut count = 0;
    let mut in_word = false;

    for c in body.chars() {
        if is_cjk(c) {
            count += 1;
            in_word = false;
        } else if c.is_whitespace() || is_punctuation(c) {
            in_word = false;
        } else {
            if !in_word {
                count += 1;
                in_word = true;
            }
        }
    }
    count
}

fn is_cjk(c: char) -> bool {
    let u = c as u32;
    (0x4E00..=0x9FFF).contains(&u)
        || (0x3400..=0x4DBF).contains(&u)
        || (0xF900..=0xFAFF).contains(&u)
}

fn is_punctuation(c: char) -> bool {
    c.is_ascii_punctuation()
        || matches!(
            c,
            '，' | '。'
                | '！'
                | '？'
                | '；'
                | '：'
                | '“'
                | '”'
                | '‘'
                | '’'
                | '（'
                | '）'
                | '【'
                | '】'
                | '《'
                | '》'
                | '、'
                | '—'
                | '…'
        )
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map_err(|error| format!("note is outside vault: {error}"))
        .map(|value| value.to_string_lossy().replace('\\', "/"))
}

fn date_from_filename(path: &str) -> Option<String> {
    let filename = Path::new(path).file_name()?.to_str()?;
    let date = filename.get(0..10)?;
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    Some(date.to_string())
}

fn file_date(path: &Path) -> String {
    let modified = fs::metadata(path).and_then(|metadata| metadata.modified());
    modified
        .map(DateTime::<Local>::from)
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|_| Local::now().format("%Y-%m-%d").to_string())
}

fn capitalize(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

trait StripPrefixDate {
    fn strip_prefix_date(&self) -> &str;
}

impl StripPrefixDate for str {
    fn strip_prefix_date(&self) -> &str {
        if let Some(date) = self.get(0..10) {
            if NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok() {
                return self.get(10..).unwrap_or_default();
            }
            self
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parses_frontmatter_and_body() {
        let dir = tempdir().unwrap();
        let note_path = dir.path().join("knowledge/rust/2026-06-08-tauri.md");
        fs::create_dir_all(note_path.parent().unwrap()).unwrap();
        fs::write(
            &note_path,
            "---\ntitle: Tauri Notes\ntags: [rust, tauri]\ncreated_at: 2026-06-08\nupdated_at: 2026-06-09\nsummary: Desktop shell\n---\n\n# Ignored Heading\n\nBody text here.",
        )
        .unwrap();

        let note = parse_note(dir.path(), &note_path).unwrap();

        assert_eq!(note.path, "knowledge/rust/2026-06-08-tauri.md");
        assert_eq!(note.title, "Tauri Notes");
        assert_eq!(note.category, "knowledge/rust");
        assert_eq!(note.tags, vec!["rust", "tauri"]);
        assert_eq!(note.created_at, "2026-06-08");
        assert_eq!(note.updated_at, "2026-06-09");
        assert_eq!(note.summary, Some("Desktop shell".to_string()));
        assert!(note.body.contains("Body text here."));
    }

    #[test]
    fn parses_created_and_updated_frontmatter_aliases() {
        let dir = tempdir().unwrap();
        let note_path = dir.path().join("knowledge/rust/aliases.md");
        fs::create_dir_all(note_path.parent().unwrap()).unwrap();
        fs::write(
            &note_path,
            "---\ntitle: Alias Dates\ncreated: 2026-06-07\nupdated: 2026-06-11\n---\n\nBody.",
        )
        .unwrap();

        let note = parse_note(dir.path(), &note_path).unwrap();

        assert_eq!(note.created_at, "2026-06-07");
        assert_eq!(note.updated_at, "2026-06-11");
    }

    #[test]
    fn derives_title_from_heading_or_filename() {
        let dir = tempdir().unwrap();
        let note_path = dir.path().join("00-inbox/2026-06-10-quick-thought.md");
        fs::create_dir_all(note_path.parent().unwrap()).unwrap();
        fs::write(&note_path, "# Heading Wins\n\nBody").unwrap();

        let note = parse_note(dir.path(), &note_path).unwrap();
        assert_eq!(note.title, "Heading Wins");

        fs::write(&note_path, "Body without heading").unwrap();
        let note = parse_note(dir.path(), &note_path).unwrap();
        assert_eq!(note.title, "Quick Thought");
    }

    #[test]
    fn derives_title_from_non_ascii_filename_without_panic() {
        let dir = tempdir().unwrap();
        let note_path = dir.path().join("knowledge/城市网络大模型.md");
        fs::create_dir_all(note_path.parent().unwrap()).unwrap();
        fs::write(&note_path, "Body without heading").unwrap();

        let note = parse_note(dir.path(), &note_path).unwrap();

        assert_eq!(note.title, "城市网络大模型");
        assert_eq!(note.category, "knowledge");
    }

    #[test]
    fn builds_note_with_common_frontmatter() {
        let markdown = build_note(
            "Daily Note",
            "journal",
            &["journal".to_string()],
            "2026-06-10",
            "# Daily Note\n",
        );

        assert!(markdown.contains("title: \"Daily Note\""));
        assert!(markdown.contains("tags: [\"journal\"]"));
        assert!(markdown.contains("# Daily Note"));
    }

    #[test]
    fn extracts_category_from_parent_path() {
        assert_eq!(
            category_from_path("knowledge/rust/tauri.md"),
            "knowledge/rust"
        );
        assert_eq!(category_from_path("loose.md"), "uncategorized");
    }
}
