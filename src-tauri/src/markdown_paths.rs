use std::path::{Component, Path};

fn normalized(path: &Path) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    for part in path.components() {
        match part {
            Component::Normal(value) => parts.push(value.to_string_lossy().to_string()),
            Component::ParentDir => {
                parts.pop()?;
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(parts)
}

fn relative_destination(destination: &str, from: &str, to: &str) -> String {
    if destination.is_empty()
        || destination.starts_with(['/', '#'])
        || destination.contains(':')
        || destination.starts_with("data:")
    {
        return destination.to_string();
    }
    let end = destination.find(['#', '?']).unwrap_or(destination.len());
    let (path, suffix) = destination.split_at(end);
    let old_parent = Path::new(from).parent().unwrap_or(Path::new(""));
    let new_parent = Path::new(to).parent().unwrap_or(Path::new(""));
    let Some(target) = normalized(&old_parent.join(path)) else {
        return destination.to_string();
    };
    let Some(base) = normalized(new_parent) else {
        return destination.to_string();
    };
    let common = target.iter().zip(&base).take_while(|(a, b)| a == b).count();
    let mut result = vec!["..".to_string(); base.len() - common];
    result.extend(target[common..].iter().cloned());
    format!("{}{suffix}", result.join("/"))
}

/// Rebase inline and reference destinations while leaving fenced and inline code intact.
pub fn rebase_markdown(source: &str, from: &str, to: &str) -> String {
    if Path::new(from).parent() == Path::new(to).parent() {
        return source.to_string();
    }
    rewrite_destinations(source, |destination, wiki| {
        if wiki {
            destination.to_string()
        } else {
            relative_destination(destination, from, to)
        }
    })
}

pub fn redirect_note_links(
    source: &str,
    source_path: &str,
    old: &crate::markdown::NoteMetadata,
    new: &crate::markdown::NoteMetadata,
) -> String {
    rewrite_destinations(source, |destination, wiki| {
        let end = destination.find(['#', '?']).unwrap_or(destination.len());
        let (target, suffix) = destination.split_at(end);
        if wiki {
            let stem = Path::new(&old.path)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if target.trim().eq_ignore_ascii_case(&old.title)
                || target.trim().eq_ignore_ascii_case(stem)
            {
                return format!("{}{suffix}", new.title);
            }
        } else if !target.contains(':') && !target.starts_with('/') {
            let parent = Path::new(source_path).parent().unwrap_or(Path::new(""));
            if normalized(&parent.join(target)) == normalized(Path::new(&old.path)) {
                return format!(
                    "{}{suffix}",
                    relative_destination(&new.path, "root.md", source_path)
                );
            }
        }
        destination.to_string()
    })
}

fn rewrite_destinations(source: &str, rewrite: impl Fn(&str, bool) -> String) -> String {
    let mut output = String::with_capacity(source.len());
    let mut fence: Option<(u8, usize)> = None;
    let mut frontmatter = source.starts_with("---\n") || source.starts_with("---\r\n");
    for (line_index, line) in source.split_inclusive('\n').enumerate() {
        let trimmed = line.trim_start();
        if frontmatter {
            output.push_str(line);
            if line_index > 0 && trimmed.trim_end() == "---" {
                frontmatter = false;
            }
            continue;
        }
        let marker = trimmed.as_bytes().first().copied().unwrap_or(0);
        let run = trimmed.bytes().take_while(|byte| *byte == marker).count();
        if matches!(marker, b'`' | b'~') && run >= 3 {
            match fence {
                Some((character, length)) if marker == character && run >= length => fence = None,
                None => fence = Some((marker, run)),
                _ => {}
            }
            output.push_str(line);
            continue;
        }
        if fence.is_some() || line.starts_with("    ") || line.starts_with('\t') {
            output.push_str(line);
            continue;
        }
        let bytes = line.as_bytes();
        let mut cursor = 0;
        let mut emitted = 0;
        let mut inline_ticks = 0;
        while cursor < bytes.len() {
            if bytes[cursor] == b'\\' {
                cursor += 2;
                continue;
            }
            if bytes[cursor] == b'`' {
                let length = bytes[cursor..]
                    .iter()
                    .take_while(|byte| **byte == b'`')
                    .count();
                if inline_ticks == 0 {
                    inline_ticks = length;
                } else if inline_ticks == length {
                    inline_ticks = 0;
                }
                cursor += length;
                continue;
            }
            if inline_ticks == 0 && bytes[cursor..].starts_with(b"[[") {
                if let Some(end) = line[cursor + 2..].find("]]").map(|end| cursor + 2 + end) {
                    let target_end = line[cursor + 2..end]
                        .find('|')
                        .map(|end| cursor + 2 + end)
                        .unwrap_or(end);
                    output.push_str(&line[emitted..cursor + 2]);
                    output.push_str(&rewrite(&line[cursor + 2..target_end], true));
                    emitted = target_end;
                    cursor = end + 2;
                    continue;
                }
            }
            let inline = bytes[cursor..].starts_with(b"](");
            let reference = bytes[cursor..].starts_with(b"]:") && trimmed.starts_with('[');
            if inline_ticks != 0 || (!inline && !reference) {
                cursor += 1;
                continue;
            }
            let mut start = cursor + 2;
            while start < bytes.len() && matches!(bytes[start], b' ' | b'\t') {
                start += 1;
            }
            let angle = bytes.get(start) == Some(&b'<');
            if angle {
                start += 1;
            }
            let mut end = start;
            let mut depth = 0;
            while end < bytes.len() {
                let character = bytes[end];
                if character == b'\\' {
                    end += 2;
                    continue;
                }
                if angle {
                    if character == b'>' {
                        break;
                    }
                } else {
                    if character.is_ascii_whitespace() {
                        break;
                    }
                    if character == b'(' {
                        depth += 1;
                    }
                    if character == b')' {
                        if depth == 0 {
                            break;
                        }
                        depth -= 1;
                    }
                }
                end += 1;
            }
            if end <= bytes.len() && end > start {
                output.push_str(&line[emitted..start]);
                output.push_str(&rewrite(&line[start..end], false));
                emitted = end;
            }
            cursor = end.max(cursor + 1);
        }
        output.push_str(&line[emitted..]);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rebase_images_links_references_but_not_code() {
        let source = "![image](_assets/a/pic.png)\n[Note](../b.md#heading)\n[id]: <images/a b.png> \"title\"\n`[code](code.md)`\n```md\n![code](code.png)\n```\n";
        let moved = rebase_markdown(source, "old/a.md", "new/deep/a.md");
        assert!(moved.contains("../../old/_assets/a/pic.png"));
        assert!(moved.contains("../../b.md#heading"));
        assert!(moved.contains("../../old/images/a b.png"));
        assert!(moved.contains("`[code](code.md)`"));
        assert!(moved.contains("![code](code.png)"));
    }
}
