use inote_lib::{
    indexer::NoteIndex,
    persistence::{commit_note_change, NoteCommitInput},
    vault::Vault,
};
use serde_json::json;
use std::time::Instant;

fn main() {
    let sizes = std::env::args()
        .skip(1)
        .map(|value| value.parse::<usize>().expect("note count"))
        .collect::<Vec<_>>();
    let sizes = if sizes.is_empty() {
        vec![1000, 10000]
    } else {
        sizes
    };
    let mut results = Vec::new();
    for size in sizes {
        let directory = tempfile::tempdir().unwrap();
        let vault = Vault::new(directory.path()).unwrap();
        std::fs::create_dir(vault.root().join("notes")).unwrap();
        for index in 0..size {
            let source = format!("---\ntitle: Note {index}\ntags: [benchmark, search]\ncustom: {{owner: iNote}}\ncreated_at: 2026-10-22\nupdated_at: 2026-10-22\n---\n\n# Note {index}\n\n{}", "本地知识库 benchmark searchable content.\n".repeat(40));
            std::fs::write(vault.root().join(format!("notes/note-{index}.md")), source).unwrap();
        }
        let index = NoteIndex::open(vault.root().join(".inote/index.sqlite3")).unwrap();
        let start = Instant::now();
        let notes = vault.scan().unwrap();
        index.full_rebuild(vault.root(), &notes).unwrap();
        let rebuild_ms = start.elapsed().as_secs_f64() * 1000.0;
        let start = Instant::now();
        let summaries = index.get_note_summaries().unwrap();
        let metadata_ms = start.elapsed().as_secs_f64() * 1000.0;
        let summary_bytes = serde_json::to_vec(&summaries).unwrap().len();
        let full_bytes = serde_json::to_vec(&notes).unwrap().len();
        let start = Instant::now();
        index.lightweight_rebuild_summaries(vault.root()).unwrap();
        let unchanged_ms = start.elapsed().as_secs_f64() * 1000.0;
        let before = vault.read_note("notes/note-0.md").unwrap();
        let start = Instant::now();
        commit_note_change(NoteCommitInput {
            vault_root: vault.root().to_string_lossy().to_string(),
            path: before.path,
            target_path: None,
            content: format!(
                "{}\nSaved once",
                vault.read_note_source("notes/note-0.md").unwrap()
            ),
            expected_revision: Some(before.source_revision),
            create: false,
            agent: None,
            source_check: None,
            content_path: None,
            undo_snapshot_id: None,
        })
        .unwrap();
        let save_ms = start.elapsed().as_secs_f64() * 1000.0;
        let mut search_times = Vec::new();
        for _ in 0..20 {
            let start = Instant::now();
            assert!(!index.search("searchable").unwrap().is_empty());
            search_times.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        search_times.sort_by(f64::total_cmp);
        results.push(json!({ "notes": size, "fullRebuildMs": rebuild_ms, "metadataLoadMs": metadata_ms, "unchangedRefreshMs": unchanged_ms, "singleSaveMs": save_ms, "searchMedianMs": search_times[10], "searchP95Ms": search_times[18], "summaryPayloadBytes": summary_bytes, "fullPayloadBytes": full_bytes }));
    }
    println!("{}", serde_json::to_string_pretty(&json!({ "profile": if cfg!(debug_assertions) { "debug" } else { "release" }, "os": std::env::consts::OS, "arch": std::env::consts::ARCH, "results": results })).unwrap());
}
