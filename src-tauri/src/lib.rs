pub mod commands;
pub mod indexer;
pub mod llm;
pub mod markdown;
pub mod vault;
pub mod watcher;

pub fn run() {
    tauri::Builder::default()
        .manage(watcher::WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            commands::scan_vault,
            commands::rebuild_search_index,
            commands::search_index,
            commands::get_note_links,
            commands::start_vault_watcher,
            commands::stop_vault_watcher,
            commands::initialize_vault,
            commands::read_note,
            commands::write_note,
            commands::create_inbox_note,
            commands::create_today_note,
            commands::create_weekly_review,
            commands::create_monthly_review,
            commands::create_note,
            commands::create_folder,
            commands::move_note,
            commands::archive_note,
            commands::delete_note,
            commands::build_llm_request_preview,
            commands::execute_llm_chat
        ])
        .run(tauri::generate_context!())
        .expect("failed to run iNote");
}
