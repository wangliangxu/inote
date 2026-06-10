pub mod commands;
pub mod indexer;
pub mod llm;
pub mod markdown;
pub mod vault;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::scan_vault,
            commands::rebuild_search_index,
            commands::search_index,
            commands::initialize_vault,
            commands::read_note,
            commands::write_note,
            commands::create_inbox_note,
            commands::create_today_note,
            commands::create_note,
            commands::create_folder,
            commands::move_note,
            commands::delete_note,
            commands::build_llm_request_preview
        ])
        .run(tauri::generate_context!())
        .expect("failed to run iNote");
}
