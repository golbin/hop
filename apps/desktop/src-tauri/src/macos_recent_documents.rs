use std::path::Path;

use objc2_app_kit::NSDocumentController;
use objc2_foundation::{MainThreadMarker, NSURL};
use tauri::AppHandle;

pub fn note_recent_document(app: &AppHandle, path: &Path) -> Result<(), String> {
    let path = path.to_path_buf();

    if MainThreadMarker::new().is_some() {
        note_recent_document_on_main_thread(&path);
        return Ok(());
    }

    app.run_on_main_thread(move || {
        note_recent_document_on_main_thread(&path);
    })
    .map_err(|e| crate::ui_text::text_with("recent.macosScheduleFailed", &[&e]))
}

fn note_recent_document_on_main_thread(path: &Path) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Some(url) = NSURL::from_file_path(path) else {
        return;
    };
    let controller = NSDocumentController::sharedDocumentController(mtm);
    controller.noteNewRecentDocumentURL(&url);
}
