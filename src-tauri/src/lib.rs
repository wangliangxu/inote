pub mod commands;
pub mod indexer;
pub mod llm;
pub mod markdown;
pub mod menu;
pub mod settings;
pub mod vault;
pub mod watcher;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            if let Ok(db_path) = crate::commands::settings_db_path(app.handle()) {
                if let Ok(store) = crate::settings::UserSettingsStore::open(&db_path) {
                    if let Ok(settings) = store.load() {
                        if let Some(window) = app.get_webview_window("main") {
                            if let (Some(w), Some(h)) = (settings.window_width, settings.window_height) {
                                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(w as f64, h as f64)));
                            }
                            if let (Some(x), Some(y)) = (settings.window_x, settings.window_y) {
                                let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x as f64, y as f64)));
                            }
                            if let Some(true) = settings.window_maximized {
                                let _ = window.maximize();
                            }
                        }
                    }
                }
            }
            Ok(())
        })
        .manage(watcher::WatcherState::default())
        .menu(menu::build)
        .on_menu_event(menu::handle_event)
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = webview.window().show();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_vault,
            commands::rebuild_search_index,
            commands::scan_vault_and_rebuild_index,
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
            commands::empty_trash,
            commands::load_user_settings,
            commands::save_user_settings,
            commands::get_setting,
            commands::set_setting,
            commands::save_window_state,
            commands::build_llm_request_preview,
            commands::execute_llm_chat,
            commands::execute_llm_chat_stream
        ])
        .run(tauri::generate_context!())
        .expect("failed to run iNote");
}
