#![recursion_limit = "512"]

pub mod agent_session;
pub mod commands;
pub mod indexer;
pub mod llm;
pub mod markdown;
pub mod markdown_paths;
pub mod menu;
pub mod mindmap_files;
pub mod persistence;
mod reminder_markdown;
pub mod reminders;
pub mod settings;
pub mod sse;
pub mod vault;
pub mod watcher;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_decorum::init())
        .setup(|app| {
            use tauri::Manager;
            reminders::install_change_observer(app.handle().clone());
            if let Ok(db_path) = crate::commands::settings_db_path(app.handle()) {
                if let Ok(store) = crate::settings::UserSettingsStore::open(&db_path) {
                    if let Ok(settings) = store.load() {
                        if let Some(window) = app.get_webview_window("main") {
                            if let (Some(w), Some(h)) =
                                (settings.window_width, settings.window_height)
                            {
                                let _ = window.set_size(tauri::Size::Logical(
                                    tauri::LogicalSize::new(w as f64, h as f64),
                                ));
                            }
                            if let (Some(x), Some(y)) = (settings.window_x, settings.window_y) {
                                let _ = window.set_position(tauri::Position::Logical(
                                    tauri::LogicalPosition::new(x as f64, y as f64),
                                ));
                            }
                            if let Some(true) = settings.window_maximized {
                                let _ = window.maximize();
                            }
                        }
                    }
                }
            }
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                use tauri_plugin_decorum::WebviewWindowExt;
                let _ = window.set_traffic_lights_inset(16.0, 20.0);
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            #[cfg(target_os = "macos")]
            tauri::WindowEvent::Resized(_)
            | tauri::WindowEvent::ThemeChanged(_)
            | tauri::WindowEvent::Focused(_) => {
                use tauri::Manager;
                use tauri_plugin_decorum::WebviewWindowExt;
                if let Some(win) = window.get_webview_window("main") {
                    let _ = win.set_traffic_lights_inset(16.0, 20.0);
                }
            }
            _ => {}
        })
        .manage(watcher::WatcherState::default())
        .manage(llm::LlmRequestState::default())
        .manage(commands::ExitState::default())
        .menu(menu::build)
        .on_menu_event(menu::handle_event)
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = webview.window().show();
            }
        })
        .invoke_handler(tauri::generate_handler![
            reminders::get_reminders_settings,
            reminders::connect_reminders,
            reminders::configure_reminders,
            reminders::sync_reminders,
            reminders::resolve_reminder_conflict,
            reminders::sync_note_reminder,
            mindmap_files::pick_mindmap_files,
            mindmap_files::export_mindmap_file,
            commands::scan_vault,
            commands::rebuild_search_index,
            commands::scan_vault_and_rebuild_index,
            commands::load_indexed_vault,
            commands::search_index,
            commands::get_note_links,
            commands::start_vault_watcher,
            commands::stop_vault_watcher,
            commands::initialize_vault,
            commands::read_note,
            commands::check_file_exists,
            commands::write_note,
            commands::commit_note,
            commands::undo_agent_change,
            commands::refresh_vault_paths,
            commands::load_note_drafts,
            commands::save_note_drafts,
            commands::allow_vault_assets,
            commands::save_note_image,
            commands::migrate_note_images,
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
            commands::quit_app,
            commands::get_setting,
            commands::set_setting,
            commands::save_window_state,
            commands::get_system_fonts,
            commands::build_llm_request_preview,
            commands::execute_llm_chat,
            commands::execute_llm_chat_stream,
            commands::cancel_llm_request,
            commands::load_agent_session,
            commands::load_agent_conversation,
            commands::record_agent_turn,
            commands::record_agent_message,
            commands::record_agent_messages,
            commands::update_agent_message,
            commands::record_agent_operation_event,
            commands::load_last_agent_undo_snapshot,
            commands::clear_last_agent_undo_snapshot,
            commands::load_agent_preference,
            commands::save_agent_preference,
            commands::clear_agent_preference
        ])
        .build(tauri::generate_context!())
        .expect("failed to build iNote")
        .run(|app, event| {
            use std::sync::atomic::Ordering;
            use tauri::Manager;
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<commands::ExitState>().0.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.close();
                    } else {
                        app.state::<commands::ExitState>()
                            .0
                            .store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                }
            }
        });
}
