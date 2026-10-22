use tauri::{
    menu::{
        AboutMetadata, IconMenuItem, Menu, MenuEvent, MenuItem, NativeIcon, PredefinedMenuItem,
        Submenu,
    },
    AppHandle, Emitter, Runtime,
};

const OPEN_SETTINGS_MENU_ID: &str = "open-settings";
const OPEN_SETTINGS_EVENT: &str = "inote://open-settings";
const EMPTY_TRASH_MENU_ID: &str = "empty-trash";
const EMPTY_TRASH_EVENT: &str = "inote://empty-trash";
const REBUILD_INDEX_MENU_ID: &str = "rebuild-index";
const REBUILD_INDEX_EVENT: &str = "inote://rebuild-index";
const SAVE_MENU_ID: &str = "save";
const SAVE_EVENT: &str = "inote://save";

pub fn build<R: Runtime>(app_handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg_info = app_handle.package_info();
    let config = app_handle.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };

    let window_menu = Submenu::with_id_and_items(
        app_handle,
        "__tauri_window_menu__",
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app_handle, None)?,
            &PredefinedMenuItem::maximize(app_handle, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::close_window(app_handle, None)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(
        app_handle,
        "__tauri_help_menu__",
        "Help",
        true,
        &[
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::about(app_handle, None, Some(about_metadata.clone()))?,
        ],
    )?;

    Menu::with_items(
        app_handle,
        &[
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app_handle,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app_handle, None, Some(about_metadata.clone()))?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &MenuItem::with_id(
                        app_handle,
                        OPEN_SETTINGS_MENU_ID,
                        "Settings...",
                        true,
                        Some("CmdOrCtrl+,"),
                    )?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::services(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::hide(app_handle, None)?,
                    &PredefinedMenuItem::hide_others(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::quit(app_handle, None)?,
                ],
            )?,
            #[cfg(not(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "openbsd"
            )))]
            &Submenu::with_items(
                app_handle,
                "File",
                true,
                &[
                    #[cfg(not(target_os = "macos"))]
                    &MenuItem::with_id(
                        app_handle,
                        OPEN_SETTINGS_MENU_ID,
                        "Settings...",
                        true,
                        Some("CmdOrCtrl+,"),
                    )?,
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::separator(app_handle)?,
                    &MenuItem::with_id(
                        app_handle,
                        SAVE_MENU_ID,
                        "Save",
                        true,
                        Some("CmdOrCtrl+S"),
                    )?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &IconMenuItem::with_id_and_native_icon(
                        app_handle,
                        REBUILD_INDEX_MENU_ID,
                        "Rebuild Full Index",
                        true,
                        Some(NativeIcon::Refresh),
                        None::<&str>,
                    )?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &IconMenuItem::with_id_and_native_icon(
                        app_handle,
                        EMPTY_TRASH_MENU_ID,
                        "Empty Trash",
                        true,
                        Some(NativeIcon::TrashEmpty),
                        None::<&str>,
                    )?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::close_window(app_handle, None)?,
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::quit(app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(
                app_handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app_handle, None)?,
                    &PredefinedMenuItem::redo(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::cut(app_handle, None)?,
                    &PredefinedMenuItem::copy(app_handle, None)?,
                    &PredefinedMenuItem::paste(app_handle, None)?,
                    &PredefinedMenuItem::select_all(app_handle, None)?,
                ],
            )?,
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app_handle,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app_handle, None)?],
            )?,
            &window_menu,
            &help_menu,
        ],
    )
}

pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if event.id() == OPEN_SETTINGS_MENU_ID {
        let _ = app.emit(OPEN_SETTINGS_EVENT, ());
    } else if event.id() == EMPTY_TRASH_MENU_ID {
        let _ = app.emit(EMPTY_TRASH_EVENT, ());
    } else if event.id() == REBUILD_INDEX_MENU_ID {
        let _ = app.emit(REBUILD_INDEX_EVENT, ());
    } else if event.id() == SAVE_MENU_ID {
        let _ = app.emit(SAVE_EVENT, ());
    }
}
