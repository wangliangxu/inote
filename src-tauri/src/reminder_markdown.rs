//! Patch only reminder-owned scalar fields, preserving all other Markdown bytes.
use serde_yaml::Value;

pub fn patch(source: &str, fields: &[(&str, Option<String>)]) -> Result<String, String> {
    let bom = if source.starts_with('\u{feff}') {
        "\u{feff}"
    } else {
        ""
    };
    let text = &source[bom.len()..];
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let first = text.split_inclusive('\n').next().unwrap_or("");
    let (prefix, yaml, suffix) = if first.trim_end_matches(['\r', '\n']) == "---" {
        let mut offset = first.len();
        let mut closing = None;
        for line in text[first.len()..].split_inclusive('\n') {
            if line.trim_end_matches(['\r', '\n']) == "---" {
                closing = Some(offset);
                break;
            }
            offset += line.len();
        }
        let end = closing.ok_or("Unclosed Markdown frontmatter.")?;
        (
            format!("{bom}{first}"),
            &text[first.len()..end],
            &text[end..],
        )
    } else {
        (format!("{bom}---{eol}"), "", text)
    };
    let document: Value = serde_yaml::from_str(yaml).map_err(|error| error.to_string())?;
    if !document.is_null() && !document.is_mapping() {
        return Err("Frontmatter must be a mapping.".into());
    }
    let mut lines: Vec<String> = yaml.split_inclusive('\n').map(str::to_owned).collect();
    for (key, value) in fields {
        let yaml_key = Value::String((*key).into());
        let index = lines.iter().position(|line| {
            if line.starts_with(char::is_whitespace) {
                return false;
            }
            line.split_once(':').is_some_and(|(name, _)| {
                [*key, &format!("'{key}'"), &format!("\"{key}\"")].contains(&name.trim())
            })
        });
        let replacement = value.as_ref().map(|value| {
            format!(
                "{key}: {}",
                serde_json::to_string(value).expect("string JSON")
            )
        });
        if let Some(index) = index {
            let scalar = lines[index].split_once(':').unwrap().1.trim();
            let parsed: Value = serde_yaml::from_str(scalar).map_err(|_| "Cannot safely update a multiline reminder field. Use a plain scalar in frontmatter.")?;
            if document.get(&yaml_key) != Some(&parsed) {
                return Err("Cannot safely update a multiline reminder field. Use a plain scalar in frontmatter.".into());
            }
            let comment = inline_comment(scalar);
            lines[index] = match (replacement, comment) {
                (Some(value), Some(comment)) => format!("{value} {comment}{eol}"),
                (Some(value), None) => format!("{value}{eol}"),
                (None, Some(comment)) => format!("{comment}{eol}"),
                (None, None) => String::new(),
            };
        } else {
            if document.get(&yaml_key).is_some() {
                return Err("Cannot safely update flow-style or inherited reminder fields. Use top-level due/status lines in frontmatter.".into());
            }
            if let Some(value) = replacement {
                lines.push(format!("{value}{eol}"));
            }
        }
    }
    let rendered = lines.concat();
    let result = if yaml.is_empty() && first.trim_end_matches(['\r', '\n']) != "---" {
        format!("{prefix}{rendered}---{eol}{eol}{suffix}")
    } else {
        format!("{prefix}{rendered}{suffix}")
    };
    // Verify that the patch changed exactly the requested keys.
    let mut expected = document.as_mapping().cloned().unwrap_or_default();
    for (key, value) in fields {
        let key = Value::String((*key).into());
        if let Some(value) = value {
            expected.insert(key, Value::String(value.clone()));
        } else {
            expected.remove(&key);
        }
    }
    let actual: Value = serde_yaml::from_str(&rendered)
        .map_err(|_| "Cannot safely patch this frontmatter layout.")?;
    if actual != Value::Mapping(expected.clone()) && !(expected.is_empty() && actual.is_null()) {
        return Err("Cannot safely patch this frontmatter layout.".into());
    }
    Ok(result)
}

fn inline_comment(value: &str) -> Option<&str> {
    let mut single = false;
    let mut double = false;
    let mut escaped = false;
    let mut previous_space = true;
    for (index, character) in value.char_indices() {
        if escaped {
            escaped = false;
            previous_space = false;
            continue;
        }
        match character {
            '\\' if double => escaped = true,
            '\'' if !double => single = !single,
            '"' if !single => double = !double,
            '#' if !single && !double && previous_space => return Some(&value[index..]),
            _ => {}
        }
        previous_space = character.is_whitespace();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_comments_unknown_fields_body_bom_and_crlf() {
        let source = "\u{feff}---\r\n# Keep\r\ntitle: '标题: A'\r\ndue: 2030-01-02T10:00 # date note\r\nstatus: in_progress # status note\r\ncustom: {x: [one, two]}\r\nsummary: |\r\n  multiline\r\n---\r\n\r\n# Body\r\n```yaml\r\ndue: untouched\r\n```\r\n";
        let updated = patch(
            source,
            &[
                ("due", Some("2030-02-03T11:00:00".into())),
                ("status", Some("done".into())),
            ],
        )
        .unwrap();
        assert_eq!(
            updated,
            source
                .replace("due: 2030-01-02T10:00", "due: \"2030-02-03T11:00:00\"")
                .replace("status: in_progress", "status: \"done\"")
        );
    }

    #[test]
    fn clears_dates_and_adds_status_without_altering_the_body() {
        let source = "---\ntitle: A\n'due': '2030-01-01' # keep comment\n---\nBody";
        let updated = patch(source, &[("due", None), ("status", Some("todo".into()))]).unwrap();
        assert_eq!(
            updated,
            "---\ntitle: A\n# keep comment\nstatus: \"todo\"\n---\nBody"
        );
        assert_eq!(
            patch("# Heading\nBody", &[("status", Some("done".into()))]).unwrap(),
            "---\nstatus: \"done\"\n---\n\n# Heading\nBody"
        );
    }

    #[test]
    fn rejects_flow_and_multiline_target_fields() {
        assert!(patch(
            "---\n{due: '2030-01-01', title: A}\n---\nBody",
            &[("due", None)]
        )
        .is_err());
        assert!(patch(
            "---\nstatus: |\n  todo\n---\nBody",
            &[("status", Some("done".into()))]
        )
        .is_err());
    }
}
