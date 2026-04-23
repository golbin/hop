mod app_quit;
mod commands;
#[cfg(target_os = "linux")]
mod linux_runtime;
#[cfg(target_os = "macos")]
mod menu;
mod pdf_export;
mod state;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
mod updates;
mod windows;

use std::path::{Path, PathBuf};
use std::{env, ffi::OsStr};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{AppHandle, Emitter, Manager};

use commands::{
    cancel_app_quit, check_external_modification, close_document, commit_staged_hwp_save,
    create_document, create_editor_window, desktop_platform, destroy_current_window, export_pdf,
    export_pdf_from_hwp_bytes, mark_document_dirty, mutate_document, open_document_with_bytes,
    prepare_staged_hwp_save, print_webview, query_document, render_page_svg, reveal_in_folder,
    take_pending_open_paths,
};
use state::AppState;
use updates::{get_update_state, restart_to_apply_update, start_update_install};

pub fn run() {
    #[cfg(target_os = "linux")]
    linux_runtime::apply_linux_appimage_runtime_fixes();

    let app = tauri::Builder::default()
        .enable_macos_default_menu(false)
        .manage(AppState::default())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = document_paths_from_args(&args, &cwd);
            queue_open_paths(app, paths);
        }))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            menu::install(app)?;
            #[cfg(not(target_os = "macos"))]
            app.set_menu(tauri::menu::Menu::new(app)?)?;
            #[cfg(not(target_os = "macos"))]
            queue_open_paths(app.handle(), startup_document_paths());
            if let Some(window) = app.get_webview_window("main") {
                windows::install_editor_window_minimum(&window);
                windows::attach_document_drop_handler(app.handle(), &window);
            }
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            updates::install_startup_update_check(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_document,
            create_editor_window,
            close_document,
            mark_document_dirty,
            render_page_svg,
            query_document,
            mutate_document,
            export_pdf,
            export_pdf_from_hwp_bytes,
            print_webview,
            destroy_current_window,
            cancel_app_quit,
            desktop_platform,
            open_document_with_bytes,
            prepare_staged_hwp_save,
            commit_staged_hwp_save,
            check_external_modification,
            take_pending_open_paths,
            reveal_in_folder,
            get_update_state,
            start_update_install,
            restart_to_apply_update,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build HOP desktop app");

    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        {
            let app = _app;
            let event = _event;

            if let RunEvent::Opened { urls } = &event {
                let paths = urls
                    .clone()
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter_map(document_path_from_path)
                    .collect();
                queue_open_paths(app, paths);
            }

            if let Err(error) = app_quit::handle_run_event(app, &event) {
                eprintln!("[quit] 앱 종료 흐름 처리 실패: {}", error);
            }
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
    let cwd = Path::new(cwd);
    args.iter()
        .skip(1)
        .filter_map(|arg| document_path_from_os_arg(OsStr::new(arg), Some(cwd)))
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn startup_document_paths() -> Vec<String> {
    let cwd = env::current_dir().ok();
    env::args_os()
        .skip(1)
        .filter_map(|arg| document_path_from_os_arg(&arg, cwd.as_deref()))
        .collect()
}

fn document_path_from_os_arg(arg: &OsStr, cwd: Option<&Path>) -> Option<String> {
    if let Some(arg) = arg.to_str() {
        if let Ok(url) = tauri::Url::parse(arg) {
            if let Ok(path) = url.to_file_path() {
                return document_path_from_path(path);
            }
        }
    }

    let path = PathBuf::from(arg);
    let resolved = match cwd {
        Some(cwd) if !path.is_absolute() => cwd.join(path),
        _ => path,
    };
    document_path_from_path(resolved)
}

pub(crate) fn document_path_from_path(path: impl AsRef<Path>) -> Option<String> {
    let path = path.as_ref();
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if ext != "hwp" && ext != "hwpx" {
        return None;
    }
    Some(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_path_from_path_accepts_hwp_and_hwpx_case_insensitively() {
        assert!(document_path_from_path(PathBuf::from("/tmp/doc.hwp")).is_some());
        assert!(document_path_from_path(PathBuf::from("/tmp/doc.HWPX")).is_some());
    }

    #[test]
    fn document_path_from_path_rejects_other_extensions() {
        assert!(document_path_from_path(PathBuf::from("/tmp/doc.pdf")).is_none());
        assert!(document_path_from_path(PathBuf::from("/tmp/doc")).is_none());
    }

    #[test]
    fn document_path_from_arg_resolves_relative_paths_against_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path();
        let expected = dir.path().join("docs/sample.hwp");

        assert_eq!(
            document_path_from_os_arg(OsStr::new("docs/sample.hwp"), Some(cwd)),
            Some(expected.to_string_lossy().to_string())
        );
    }

    #[test]
    fn document_path_from_arg_accepts_file_urls() {
        let path = std::env::temp_dir().join("sample.hwpx");
        let url = tauri::Url::from_file_path(&path).unwrap().to_string();

        assert_eq!(
            document_path_from_os_arg(OsStr::new(&url), Some(Path::new("/ignored"))),
            Some(path.to_string_lossy().to_string())
        );
    }

    #[test]
    fn document_paths_from_args_skip_executable_and_filter_unsupported_args() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy();
        let paths = document_paths_from_args(
            &[
                dir.path().join("HOP.exe").to_string_lossy().to_string(),
                "first.hwp".to_string(),
                "notes.txt".to_string(),
                "second.HWPX".to_string(),
            ],
            &cwd,
        );

        assert_eq!(
            paths,
            vec![
                dir.path().join("first.hwp").to_string_lossy().to_string(),
                dir.path().join("second.HWPX").to_string_lossy().to_string()
            ]
        );
    }

    #[test]
    fn startup_like_args_skip_the_executable_path() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path();
        let executable = dir.path().join("sample.hwp");
        let document = dir.path().join("opened.hwpx");
        let args = [executable.as_os_str(), document.as_os_str()];

        let paths = args
            .iter()
            .skip(1)
            .filter_map(|arg| document_path_from_os_arg(arg, Some(cwd)))
            .collect::<Vec<_>>();

        assert_eq!(paths, vec![document.to_string_lossy().to_string()]);
    }
}
