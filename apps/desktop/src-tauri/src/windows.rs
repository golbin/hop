use std::path::PathBuf;
use tauri::{
    AppHandle, DragDropEvent, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use uuid::Uuid;

pub fn create_editor_window(app: &AppHandle) -> Result<String, String> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "기본 창 설정을 찾을 수 없습니다".to_string())?;

    let label = format!("main{}", Uuid::new_v4().simple());
    config.label = label.clone();
    config.title = "HOP".to_string();
    config.x = None;
    config.y = None;
    config.center = true;

    let window = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|e| format!("새 창 설정 실패: {}", e))?
        .build()
        .map_err(|e| format!("새 창 생성 실패: {}", e))?;
    attach_document_drop_handler(app, &window);
    let _ = window.set_focus();

    Ok(label)
}

pub fn attach_document_drop_handler(app: &AppHandle, window: &WebviewWindow) {
    let app = app.clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event else {
            return;
        };
        let paths = document_paths(paths);
        if paths.is_empty() {
            return;
        }
        let _ = app.emit_to(
            label.as_str(),
            "hop-open-paths",
            serde_json::json!({ "paths": paths }),
        );
    });
}

fn document_paths(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("hwp") || ext.eq_ignore_ascii_case("hwpx"))
                .unwrap_or(false)
        })
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

pub fn target_window_label(app: &AppHandle) -> Option<String> {
    let windows = app.webview_windows();
    windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label.clone())
        .or_else(|| windows.keys().next().cloned())
}
