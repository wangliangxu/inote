use serde_json::Value;
use std::collections::BTreeMap;

fn safe_source(raw: &str) -> Option<String> {
    let source = raw.trim();
    if source.is_empty() || source.len() > 2048 || source.chars().any(char::is_control) {
        return None;
    }
    let lower = source.to_ascii_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("file://")
    {
        return Some(source.into());
    }
    if source.starts_with("//") {
        return None;
    }
    if let Some(colon) = source.find(':') {
        if !(colon == 1
            && source.as_bytes()[0].is_ascii_alphabetic()
            && source
                .as_bytes()
                .get(2)
                .is_some_and(|b| matches!(b, b'/' | b'\\')))
        {
            return None;
        }
    }
    Some(source.into())
}

pub fn cover_source(frontmatter: &BTreeMap<String, Value>, body: &str) -> Option<String> {
    if frontmatter.get("cover") == Some(&Value::Bool(false)) {
        return None;
    }
    if let Some(source) = frontmatter
        .get("cover")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
    {
        return safe_source(source);
    }
    // Bound indexing work; cached previews never contain the image itself or an embedded data URL.
    let bounded: String = body.chars().take(65536).collect();
    let mut fence: Option<(u8, usize)> = None;
    let mut comment = false;
    for line in bounded.lines() {
        let trimmed = line.trim_start();
        let marker = trimmed.as_bytes().first().copied().unwrap_or(0);
        let run = trimmed.bytes().take_while(|b| *b == marker).count();
        if matches!(marker, b'`' | b'~') && run >= 3 {
            match fence {
                Some((m, n)) if marker == m && run >= n => fence = None,
                None => fence = Some((marker, run)),
                _ => {}
            }
            continue;
        }
        if fence.is_some() || line.starts_with("    ") || line.starts_with('\t') {
            continue;
        }
        let bytes = line.as_bytes();
        let mut i = 0;
        let mut ticks = 0;
        while i < bytes.len() {
            if bytes[i..].starts_with(b"<!--") {
                comment = true;
                i += 4;
                continue;
            }
            if comment {
                if bytes[i..].starts_with(b"-->") {
                    comment = false;
                    i += 3;
                } else {
                    i += 1;
                }
                continue;
            }
            if bytes[i] == b'\\' {
                i += 2;
                continue;
            }
            if bytes[i] == b'`' {
                let n = bytes[i..].iter().take_while(|b| **b == b'`').count();
                if ticks == 0 {
                    ticks = n;
                } else if ticks == n {
                    ticks = 0;
                }
                i += n;
                continue;
            }
            if ticks != 0 || !bytes[i..].starts_with(b"![") {
                i += 1;
                continue;
            }
            let Some(close) = line[i + 2..].find("](").map(|n| i + 2 + n) else {
                i += 2;
                continue;
            };
            let mut start = close + 2;
            while bytes.get(start).is_some_and(u8::is_ascii_whitespace) {
                start += 1;
            }
            let angle = bytes.get(start) == Some(&b'<');
            if angle {
                start += 1;
            }
            let mut end = start;
            let mut depth = 0;
            while end < bytes.len() {
                let c = bytes[end];
                if c == b'\\' {
                    end = (end + 2).min(bytes.len());
                    continue;
                }
                if angle && c == b'>' {
                    break;
                }
                if !angle {
                    if c.is_ascii_whitespace() || (c == b')' && depth == 0) {
                        break;
                    }
                    if c == b'(' {
                        depth += 1;
                    }
                    if c == b')' {
                        depth -= 1;
                    }
                }
                end += 1;
            }
            if end < bytes.len() && line.is_char_boundary(start) && line.is_char_boundary(end) {
                let source = line[start..end]
                    .replace("\\(", "(")
                    .replace("\\)", ")")
                    .replace("\\ ", " ");
                if let Some(source) = safe_source(&source) {
                    return Some(source);
                }
            }
            i = end.max(i + 2);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn covers_respect_overrides_and_ignore_examples() {
        let mut metadata = BTreeMap::new();
        let body = "```md\n![code](wrong.png)\n```\n`![inline](wrong.png)`\n<!-- ![hidden](wrong.png) -->\n![图片](<images/a b.png> \"caption\")";
        assert_eq!(
            cover_source(&metadata, body).as_deref(),
            Some("images/a b.png")
        );
        metadata.insert("cover".into(), Value::Bool(false));
        assert_eq!(cover_source(&metadata, body), None);
        metadata.insert("cover".into(), Value::String("custom.png".into()));
        assert_eq!(cover_source(&metadata, body).as_deref(), Some("custom.png"));
        metadata.insert("cover".into(), Value::String("javascript:alert(1)".into()));
        assert_eq!(cover_source(&metadata, body), None);
        metadata.clear();
        assert_eq!(
            cover_source(&metadata, "![a](img/a(1).png)").as_deref(),
            Some("img/a(1).png")
        );
        assert_eq!(
            cover_source(&metadata, "![a](data:image/png;base64,abc)\n![b](next.jpg)").as_deref(),
            Some("next.jpg")
        );
    }
}
