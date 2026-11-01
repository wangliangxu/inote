//! Read-only MindNode Classic import. Source packages and archives are never modified.
use plist::Value;
use serde::Serialize;
use std::collections::{BTreeSet, HashSet};
use std::io::{Cursor, Read};
use std::path::Path;

pub const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_NODES: usize = 5000;
const MAX_DEPTH: usize = 64;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MindNodeImport {
    pub format_version: u64,
    pub roots: Vec<ImportedNode>,
    pub warnings: BTreeSet<String>,
}

/// Title and note text remain inert HTML until the frontend decodes them.
#[derive(Debug, Serialize)]
pub struct ImportedNode {
    pub id: String,
    pub text: String,
    pub children: Vec<ImportedNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub collapsed: bool,
}

pub fn read_limited(reader: impl Read) -> Result<Vec<u8>, &'static str> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "read")?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("limit");
    }
    Ok(bytes)
}

pub fn read_mindnode(path: &Path) -> Result<MindNodeImport, &'static str> {
    let bytes = if path.is_dir() {
        // Only the selected package's own document is read. Do not follow internal links.
        let contents = path.join("contents.xml");
        let metadata = std::fs::symlink_metadata(&contents).map_err(|_| "mindnodeSchema")?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("mindnodeSchema");
        }
        if metadata.len() > MAX_FILE_BYTES {
            return Err("limit");
        }
        read_limited(std::fs::File::open(contents).map_err(|_| "read")?)?
    } else {
        let file = std::fs::File::open(path).map_err(|_| "read")?;
        if file.metadata().map_err(|_| "read")?.len() > MAX_FILE_BYTES {
            return Err("limit");
        }
        read_limited(file)?
    };
    parse_mindnode_bytes(&bytes)
}

pub fn parse_mindnode_bytes(bytes: &[u8]) -> Result<MindNodeImport, &'static str> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("limit");
    }
    let document = if bytes.starts_with(b"PK") {
        unzip_document(bytes)?
    } else {
        bytes.to_vec()
    };
    // Standard plist XML doctypes are allowed, custom entity declarations are not.
    if !document.starts_with(b"bplist00")
        && document
            .windows(8)
            .any(|w| w.eq_ignore_ascii_case(b"<!ENTITY"))
    {
        return Err("mindnodeSchema");
    }
    let value = Value::from_reader(Cursor::new(document)).map_err(|_| "mindnodeSchema")?;
    convert_document(&value)
}

fn unzip_document(bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "mindnodeSchema")?;
    if archive.len() > 10000 {
        return Err("limit");
    }
    // Read one root document, not similarly named files in styles/ or QuickLook/.
    let mut candidates = Vec::new();
    for name in archive.file_names() {
        let name = name.map_err(|_| "mindnodeSchema")?;
        let components: Vec<_> = name.split('/').collect();
        let root = components.as_slice() == ["contents.xml"];
        let wrapped = components.len() == 2
            && components[0].to_ascii_lowercase().ends_with(".mindnode")
            && components[1] == "contents.xml";
        if root || wrapped {
            candidates.push(name.into_owned());
        }
    }
    if candidates.len() != 1 {
        return Err("mindnodeSchema");
    }
    let entry = archive
        .by_name(&candidates[0])
        .map_err(|_| "mindnodeSchema")?;
    if entry.is_dir()
        || entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
    {
        return Err("mindnodeSchema");
    }
    if entry.size() > MAX_FILE_BYTES {
        return Err("limit");
    }
    // Nothing is extracted to disk, and decompressed size is bounded too.
    read_limited(entry)
}

fn dictionary(value: &Value) -> Result<&plist::Dictionary, &'static str> {
    value.as_dictionary().ok_or("mindnodeSchema")
}
fn rich_string(value: &Value) -> Result<String, &'static str> {
    value
        .as_string()
        .or_else(|| value.as_dictionary()?.get("text")?.as_string())
        .map(str::to_string)
        .ok_or("mindnodeSchema")
}
fn nonempty(value: &Value) -> bool {
    match value {
        Value::Array(v) => !v.is_empty(),
        Value::Dictionary(v) => !v.is_empty(),
        Value::String(v) => !v.is_empty(),
        Value::Boolean(v) => *v,
        _ => true,
    }
}
fn color(value: &Value) -> Option<String> {
    let source = value.as_string()?;
    let components: Vec<f64> = source
        .trim_matches(['{', '}'])
        .split(',')
        .map(|v| v.trim().parse())
        .collect::<Result<_, _>>()
        .ok()?;
    if components.len() < 3
        || components
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
    {
        return None;
    }
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        (components[0] * 255.0).round() as u8,
        (components[1] * 255.0).round() as u8,
        (components[2] * 255.0).round() as u8
    ))
}

struct Converter {
    count: usize,
    ids: HashSet<String>,
    warnings: BTreeSet<String>,
}
impl Converter {
    fn node(&mut self, value: &Value, depth: usize) -> Result<ImportedNode, &'static str> {
        self.count += 1;
        if depth > MAX_DEPTH || self.count > MAX_NODES {
            return Err("limit");
        }
        let node = dictionary(value)?;
        let text = rich_string(node.get("title").ok_or("mindnodeSchema")?)?;
        let note = node.get("note").map(rich_string).transpose()?;
        let original_id = node
            .get("nodeID")
            .and_then(Value::as_string)
            .filter(|s| !s.is_empty());
        let mut id = original_id.unwrap_or("").to_string();
        if id.is_empty() || !self.ids.insert(id.clone()) {
            self.warnings.insert("mindnodeIds".into());
            id = format!("inote-mindnode-{}", self.count);
            while !self.ids.insert(id.clone()) {
                id.push('-');
            }
        }
        let collapsed = match node.get("hasFoldedSubnodes") {
            Some(Value::Boolean(value)) => *value,
            None => false,
            _ => return Err("mindnodeSchema"),
        };
        let subnodes = match node.get("subnodes") {
            Some(Value::Array(values)) => values.as_slice(),
            None => &[],
            _ => return Err("mindnodeSchema"),
        };
        let children = subnodes
            .iter()
            .map(|child| self.node(child, depth + 1))
            .collect::<Result<_, _>>()?;
        let link = node
            .get("link")
            .or_else(|| node.get("url"))
            .and_then(|v| {
                v.as_string()
                    .or_else(|| v.as_dictionary()?.get("url")?.as_string())
            })
            .map(str::to_string);
        if node.contains_key("attachment") {
            self.warnings.insert("mindnodeAttachments".into());
        }
        if ["task", "tags", "sticker"]
            .iter()
            .any(|key| node.get(key).is_some_and(nonempty))
        {
            self.warnings.insert("mindnodeFeatures".into());
        }
        let color = node
            .get("shapeStyle")
            .and_then(Value::as_dictionary)
            .and_then(|v| v.get("borderStrokeStyle"))
            .and_then(Value::as_dictionary)
            .and_then(|v| v.get("color"))
            .and_then(color);
        // Position/font/style information is intentionally converted to iNote's own layout.
        self.warnings.insert("appearance".into());
        Ok(ImportedNode {
            id,
            text,
            children,
            note,
            link,
            color,
            collapsed,
        })
    }
}
fn convert_document(value: &Value) -> Result<MindNodeImport, &'static str> {
    let document = dictionary(value)?;
    let format_version = document
        .get("version")
        .and_then(Value::as_unsigned_integer)
        .ok_or("mindnodeSchema")?;
    if ![6, 9].contains(&format_version) {
        return Err("mindnodeVersion");
    }
    let canvas = dictionary(document.get("canvas").ok_or("mindnodeSchema")?)?;
    let maps = canvas
        .get("mindMaps")
        .and_then(Value::as_array)
        .filter(|v| !v.is_empty())
        .ok_or("mindnodeSchema")?;
    let mut converter = Converter {
        count: 0,
        ids: HashSet::new(),
        warnings: BTreeSet::new(),
    };
    if ["crossConnections", "boundaries"]
        .iter()
        .any(|key| canvas.get(key).is_some_and(nonempty))
    {
        converter.warnings.insert("mindnodeConnections".into());
    }
    let roots = maps
        .iter()
        .map(|map| converter.node(dictionary(map)?.get("mainNode").ok_or("mindnodeSchema")?, 1))
        .collect::<Result<_, _>>()?;
    Ok(MindNodeImport {
        format_version,
        roots,
        warnings: converter.warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;

    fn fixture(version: u64) -> serde_json::Value {
        json!({"version": version, "canvas": {"mindMaps": [{"mainNode": {
            "nodeID": "root", "title": {"text": "<p>课程 &amp; 计划</p>"}, "hasFoldedSubnodes": true,
            "shapeStyle": {"borderStrokeStyle": {"color": "{0.2, 0.4, 0.6, 1.0}"}},
            "subnodes": [{"nodeID": "child", "title": {"text": "<p>Python 基础</p>"}, "note": {"text": "<p>第一行</p><p>第二行</p>"}, "link": "https://example.com", "subnodes": []}]
        }}]}})
    }
    fn encode(document: &serde_json::Value, binary: bool) -> Vec<u8> {
        let value = plist::to_value(document).unwrap();
        let mut bytes = Vec::new();
        if binary {
            value.to_writer_binary(&mut bytes).unwrap();
        } else {
            value.to_writer_xml(&mut bytes).unwrap();
        }
        bytes
    }
    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            writer
                .start_file(
                    *name,
                    zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
    fn count(nodes: &[ImportedNode]) -> usize {
        nodes.iter().map(|n| 1 + count(&n.children)).sum()
    }
    #[test]
    fn decodes_binary_and_xml_plists_preserving_structure_and_supported_properties() {
        for version in [6, 9] {
            for binary in [true, false] {
                let imported = parse_mindnode_bytes(&encode(&fixture(version), binary)).unwrap();
                assert_eq!(imported.format_version, version);
                assert_eq!(count(&imported.roots), 2);
                let root = &imported.roots[0];
                assert_eq!(root.id, "root");
                assert_eq!(root.color.as_deref(), Some("#336699"));
                assert!(root.collapsed);
                assert_eq!(root.children[0].id, "child");
                assert_eq!(
                    root.children[0].note.as_deref(),
                    Some("<p>第一行</p><p>第二行</p>")
                );
                assert_eq!(
                    root.children[0].link.as_deref(),
                    Some("https://example.com")
                );
            }
        }
    }
    #[test]
    fn reads_packages_without_modifying_sources_and_reports_missing_documents() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sample.mindnode");
        std::fs::create_dir(&path).unwrap();
        assert_eq!(read_mindnode(&path).unwrap_err(), "mindnodeSchema");
        let source = encode(&fixture(6), true);
        std::fs::write(path.join("contents.xml"), &source).unwrap();
        assert_eq!(count(&read_mindnode(&path).unwrap().roots), 2);
        assert_eq!(std::fs::read(path.join("contents.xml")).unwrap(), source);
        let file = directory.path().join("single.mindnode");
        std::fs::write(&file, &source).unwrap();
        assert_eq!(count(&read_mindnode(&file).unwrap().roots), 2);
    }
    #[test]
    fn reads_zip_single_files_and_wrapped_packages_without_extracting_resources() {
        let bytes = encode(&fixture(6), true);
        for name in ["contents.xml", "sample.mindnode/contents.xml"] {
            let zip = archive(&[
                ("style.mindnodestyle/contents.xml", b"not the document"),
                (name, &bytes),
                ("resources/image.png", b"ignored"),
            ]);
            assert_eq!(count(&parse_mindnode_bytes(&zip).unwrap().roots), 2);
        }
        assert_eq!(
            parse_mindnode_bytes(&archive(&[("../contents.xml", &bytes)])).unwrap_err(),
            "mindnodeSchema"
        );
        assert_eq!(
            parse_mindnode_bytes(&archive(&[
                ("contents.xml", &bytes),
                ("other.mindnode/contents.xml", &bytes)
            ]))
            .unwrap_err(),
            "mindnodeSchema"
        );
    }
    #[test]
    fn rejects_invalid_versions_schema_plists_and_corrupt_archives() {
        for bytes in [b"garbage".as_slice(), b"PKbroken", b"<!ENTITY invalid>"] {
            assert!(parse_mindnode_bytes(bytes).is_err());
        }
        assert_eq!(
            parse_mindnode_bytes(&encode(&fixture(100), true)).unwrap_err(),
            "mindnodeVersion"
        );
        let mut value = fixture(6);
        value["canvas"]["mindMaps"][0]["mainNode"]["title"] = json!(123);
        assert_eq!(
            parse_mindnode_bytes(&encode(&value, true)).unwrap_err(),
            "mindnodeSchema"
        );
        assert_eq!(
            parse_mindnode_bytes(&encode(
                &json!({"version": 6, "canvas": {"mindMaps": []}}),
                true
            ))
            .unwrap_err(),
            "mindnodeSchema"
        );
    }
    #[test]
    fn repairs_ids_and_reports_features_that_cannot_be_migrated() {
        let mut value = fixture(9);
        let root = &mut value["canvas"]["mindMaps"][0]["mainNode"];
        root["subnodes"][0]["nodeID"] = json!("root");
        root["attachment"] = json!({"fileName": "image.png"});
        root["task"] = json!({"state": 1});
        value["canvas"]["crossConnections"] = json!([{"id":"connection"}]);
        let imported = parse_mindnode_bytes(&encode(&value, true)).unwrap();
        assert_ne!(imported.roots[0].id, imported.roots[0].children[0].id);
        for warning in [
            "mindnodeIds",
            "mindnodeAttachments",
            "mindnodeFeatures",
            "mindnodeConnections",
        ] {
            assert!(imported.warnings.contains(warning));
        }
    }
    #[test]
    fn enforces_depth_node_and_uncompressed_byte_limits() {
        let mut value = fixture(6);
        let mut node = json!({"nodeID":"deep", "title":"end", "subnodes":[]});
        for _ in 0..MAX_DEPTH {
            node = json!({"title":"level", "subnodes":[node]});
        }
        value["canvas"]["mindMaps"][0]["mainNode"] = node;
        assert_eq!(
            parse_mindnode_bytes(&encode(&value, true)).unwrap_err(),
            "limit"
        );
        value["canvas"]["mindMaps"][0]["mainNode"] = json!({"title":"root", "subnodes": (0..MAX_NODES).map(|_| json!({"title":"node", "subnodes":[]})).collect::<Vec<_>>()});
        assert_eq!(
            parse_mindnode_bytes(&encode(&value, true)).unwrap_err(),
            "limit"
        );
        let oversized = vec![b'x'; MAX_FILE_BYTES as usize + 1];
        assert_eq!(parse_mindnode_bytes(&oversized).unwrap_err(), "limit");
        assert_eq!(
            parse_mindnode_bytes(&archive(&[("contents.xml", &oversized)])).unwrap_err(),
            "limit"
        );
    }
    #[cfg(unix)]
    #[test]
    fn does_not_follow_internal_package_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        let package = directory.path().join("sample.mindnode");
        std::fs::create_dir(&package).unwrap();
        let outside = directory.path().join("outside.plist");
        std::fs::write(&outside, encode(&fixture(6), true)).unwrap();
        std::os::unix::fs::symlink(outside, package.join("contents.xml")).unwrap();
        assert_eq!(read_mindnode(&package).unwrap_err(), "mindnodeSchema");
    }
    #[test]
    #[ignore = "requires INOTE_MINDNODE_SAMPLE; reads a local user-provided sample"]
    fn verify_local_sample() {
        let sample = std::env::var("INOTE_MINDNODE_SAMPLE").expect("set INOTE_MINDNODE_SAMPLE");
        let package = Path::new(&sample);
        let source = std::fs::read(package.join("contents.xml")).unwrap();
        let value = Value::from_reader(Cursor::new(&source)).unwrap();
        let imported = read_mindnode(package).unwrap();
        fn verify(original: &Value, converted: &ImportedNode) {
            let original = original.as_dictionary().unwrap();
            assert_eq!(original["nodeID"].as_string().unwrap(), converted.id);
            assert_eq!(rich_string(&original["title"]).unwrap(), converted.text);
            assert_eq!(
                original["hasFoldedSubnodes"].as_boolean().unwrap(),
                converted.collapsed
            );
            let children = original["subnodes"].as_array().unwrap();
            assert_eq!(children.len(), converted.children.len());
            for (original, converted) in children.iter().zip(&converted.children) {
                verify(original, converted);
            }
        }
        let maps = value.as_dictionary().unwrap()["canvas"]
            .as_dictionary()
            .unwrap()["mindMaps"]
            .as_array()
            .unwrap();
        assert_eq!(maps.len(), imported.roots.len());
        for (map, node) in maps.iter().zip(&imported.roots) {
            verify(&map.as_dictionary().unwrap()["mainNode"], node);
        }
        assert_eq!(std::fs::read(package.join("contents.xml")).unwrap(), source);
        if let Ok(destination) = std::env::var("INOTE_MINDNODE_PAYLOAD") {
            std::fs::write(destination, serde_json::to_vec(&imported).unwrap()).unwrap();
        }
        eprintln!("Verified MindNode format {}: {} roots, {} nodes; all IDs, HTML titles, child order and folding preserved; source unchanged", imported.format_version, imported.roots.len(), count(&imported.roots));
    }
}
