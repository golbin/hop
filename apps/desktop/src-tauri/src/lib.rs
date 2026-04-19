mod commands;
mod menu;
mod pdf_export;
mod state;
mod windows;

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

use commands::{
    check_external_modification, close_document, create_document, create_editor_window,
    destroy_current_window, export_pdf, export_pdf_from_hwp_bytes, mutate_document, open_document,
    open_document_with_bytes, print_webview, query_document, render_page_svg, reveal_in_folder,
    save_document, save_document_as, save_hwp_bytes, take_pending_open_paths,
};
use state::AppState;

pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = document_paths_from_args(&args, &cwd);
            queue_open_paths(app, paths);
            let payload = serde_json::json!({ "args": args, "cwd": cwd });
            let _ = app.emit("hop-second-instance", payload);
        }))
        .setup(|app| {
            menu::install(app)?;
            if let Some(window) = app.get_webview_window("main") {
                windows::attach_document_drop_handler(app.handle(), &window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_document,
            create_editor_window,
            open_document,
            close_document,
            save_document,
            save_document_as,
            render_page_svg,
            query_document,
            mutate_document,
            export_pdf,
            export_pdf_from_hwp_bytes,
            print_webview,
            destroy_current_window,
            open_document_with_bytes,
            save_hwp_bytes,
            check_external_modification,
            take_pending_open_paths,
            reveal_in_folder,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build HOP desktop app");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter_map(document_path_from_path)
                .collect();
            queue_open_paths(app, paths);
        }
    });
}

fn queue_open_paths(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    if let Ok(mut pending) = app.state::<AppState>().pending_open_paths.lock() {
        pending.extend(paths.iter().cloned());
    }

    let payload = serde_json::json!({ "paths": paths });
    if let Some(label) = crate::windows::target_window_label(app) {
        let _ = app.emit_to(label, "hop-open-paths", payload);
    } else {
        let _ = app.emit("hop-open-paths", payload);
    }
}

fn document_paths_from_args(args: &[String], cwd: &str) -> Vec<String> {
    args.iter()
        .filter_map(|arg| document_path_from_arg(arg, cwd))
        .collect()
}

fn document_path_from_arg(arg: &str, cwd: &str) -> Option<String> {
    if let Ok(url) = tauri::Url::parse(arg) {
        if let Ok(path) = url.to_file_path() {
            return document_path_from_path(path);
        }
    }

    let path = PathBuf::from(arg);
    let resolved = if path.is_absolute() {
        path
    } else {
        Path::new(cwd).join(path)
    };
    document_path_from_path(resolved)
}

fn document_path_from_path(path: PathBuf) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if ext != "hwp" && ext != "hwpx" {
        return None;
    }
    Some(path.to_string_lossy().to_string())
}
