use crate::state::{
    AppState, DocumentFormat, DocumentOpenResult, ExternalModificationStatus, MutationResult,
    PageSvgResult, SaveResult,
};
use rhwp::DocumentCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRange {
    pub start: Option<u32>,
    pub end: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub job_id: String,
    pub phase: String,
    pub done: u32,
    pub total: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOpenWithBytesResult {
    pub document: DocumentOpenResult,
    pub bytes: Vec<u8>,
}

#[tauri::command]
pub fn create_document(state: State<'_, AppState>) -> Result<DocumentOpenResult, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .create_document()
}

#[tauri::command]
pub fn open_document(
    path: String,
    state: State<'_, AppState>,
) -> Result<DocumentOpenResult, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .open_document(PathBuf::from(path))
}

#[tauri::command]
pub fn open_document_with_bytes(
    path: String,
    state: State<'_, AppState>,
) -> Result<DocumentOpenWithBytesResult, String> {
    let path_buf = PathBuf::from(&path);
    DocumentFormat::from_path(&path_buf)?;
    let bytes = std::fs::read(&path_buf)
        .map_err(|e| format!("파일을 읽을 수 없습니다: {} ({})", path_buf.display(), e))?;
    let document = state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .open_document_from_bytes(path_buf, &bytes)?;
    Ok(DocumentOpenWithBytesResult { document, bytes })
}

#[tauri::command]
pub fn take_pending_open_paths(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut paths = state
        .pending_open_paths
        .lock()
        .map_err(|_| "대기 중인 파일 열기 큐 잠금 실패".to_string())?;
    Ok(paths.drain(..).collect())
}

#[tauri::command]
pub fn close_document(doc_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .close_document(&doc_id)
}

#[tauri::command]
pub fn mark_document_dirty(doc_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .mark_document_dirty(&doc_id)
}

#[tauri::command]
pub fn save_document(
    doc_id: String,
    expected_revision: Option<u64>,
    state: State<'_, AppState>,
) -> Result<SaveResult, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .save_document(&doc_id, expected_revision)
}

#[tauri::command]
pub fn save_document_as(
    doc_id: String,
    target_path: String,
    format: DocumentFormat,
    expected_revision: Option<u64>,
    state: State<'_, AppState>,
) -> Result<SaveResult, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .save_document_as(
            &doc_id,
            PathBuf::from(target_path),
            format,
            expected_revision,
        )
}

#[tauri::command]
pub fn save_hwp_bytes(
    doc_id: String,
    bytes: Vec<u8>,
    target_path: Option<String>,
    expected_revision: Option<u64>,
    allow_external_overwrite: Option<bool>,
    state: State<'_, AppState>,
) -> Result<SaveResult, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .save_hwp_bytes(
            &doc_id,
            &bytes,
            target_path.map(PathBuf::from),
            expected_revision,
            allow_external_overwrite.unwrap_or(false),
        )
}

#[tauri::command]
pub fn check_external_modification(
    doc_id: String,
    target_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<ExternalModificationStatus, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .external_modification_status(&doc_id, target_path.map(PathBuf::from))
}

#[tauri::command]
pub fn render_page_svg(
    doc_id: String,
    page_index: u32,
    revision: Option<u64>,
    state: State<'_, AppState>,
) -> Result<PageSvgResult, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .render_page_svg(&doc_id, page_index, revision)
}

#[tauri::command]
pub fn query_document(
    doc_id: String,
    query: String,
    args: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .query_document(&doc_id, &query, args)
}

#[tauri::command]
pub fn mutate_document(
    doc_id: String,
    operation: String,
    args: Value,
    expected_revision: Option<u64>,
    state: State<'_, AppState>,
) -> Result<MutationResult, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .mutate_document(&doc_id, &operation, args, expected_revision)
}

#[tauri::command]
pub fn export_pdf(
    app: AppHandle,
    doc_id: String,
    target_path: String,
    page_range: Option<PageRange>,
    open_after: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let job_id = Uuid::new_v4().to_string();

    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?;
    let session = sessions.session(&doc_id)?;
    export_pdf_from_core(
        &app,
        &job_id,
        &session.core,
        target_path,
        page_range,
        open_after,
    )?;
    Ok(job_id)
}

#[tauri::command]
pub fn export_pdf_from_hwp_bytes(
    app: AppHandle,
    bytes: Vec<u8>,
    target_path: String,
    page_range: Option<PageRange>,
    open_after: bool,
) -> Result<String, String> {
    let job_id = Uuid::new_v4().to_string();

    let mut core =
        DocumentCore::from_bytes(&bytes).map_err(|e| format!("문서 바이트 파싱 실패: {}", e))?;
    core.convert_to_editable_native()
        .map_err(|e| format!("PDF 내보내기용 문서 변환 실패: {}", e))?;
    export_pdf_from_core(&app, &job_id, &core, target_path, page_range, open_after)?;
    Ok(job_id)
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let reveal_path = if path.is_dir() {
        path.as_path()
    } else {
        path.parent()
            .ok_or_else(|| format!("파일 위치를 찾을 수 없습니다: {}", path.display()))?
    };
    if !reveal_path.is_dir() {
        return Err(format!(
            "파일 위치가 로컬 디렉터리가 아닙니다: {}",
            reveal_path.display()
        ));
    }
    open::that(reveal_path).map_err(|e| format!("파일 위치를 열 수 없습니다: {}", e))
}

#[tauri::command]
pub fn print_webview(window: WebviewWindow) -> Result<(), String> {
    window
        .print()
        .map_err(|e| format!("인쇄 대화상자를 열 수 없습니다: {}", e))
}

#[tauri::command]
pub fn destroy_current_window(window: WebviewWindow) -> Result<(), String> {
    window
        .destroy()
        .map_err(|e| format!("창을 닫을 수 없습니다: {}", e))
}

#[tauri::command]
pub fn cancel_app_quit(app: AppHandle) -> Result<(), String> {
    crate::app_quit::cancel_app_quit_request(&app)
}

#[tauri::command]
pub fn desktop_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

#[tauri::command]
pub async fn create_editor_window(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::windows::create_editor_window(&app))
        .await
        .map_err(|e| format!("새 창 생성 작업 실패: {}", e))?
}

fn export_pdf_from_core(
    app: &AppHandle,
    job_id: &str,
    core: &DocumentCore,
    target_path: String,
    page_range: Option<PageRange>,
    open_after: bool,
) -> Result<(), String> {
    let path = PathBuf::from(&target_path);
    let total = crate::pdf_export::export_core_to_pdf(
        core,
        &path,
        page_range,
        |phase, done, total, message| {
            emit_progress(app, job_id, phase, done, total, &message);
        },
    )?;

    if open_after {
        open::that(&path).map_err(|e| {
            format!(
                "파일은 저장됐지만 OS 기본 앱으로 열 수 없습니다: {} ({})",
                path.display(),
                e
            )
        })?;
    }

    emit_progress(
        app,
        job_id,
        "done",
        total,
        total,
        "PDF 내보내기가 완료되었습니다",
    );
    Ok(())
}

fn emit_progress(app: &AppHandle, job_id: &str, phase: &str, done: u32, total: u32, message: &str) {
    let _ = app.emit(
        "hop-job-progress",
        JobProgress {
            job_id: job_id.to_string(),
            phase: phase.to_string(),
            done,
            total,
            message: message.to_string(),
        },
    );
}
