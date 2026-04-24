use crate::font_catalog::LocalFontEntry;
use crate::state::{
    editable_core_from_bytes, AppState, DocumentFormat, DocumentOpenResult,
    ExternalModificationStatus, FileFingerprint, MutationResult, PageSvgResult, SaveResult,
};
use rhwp::DocumentCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tauri_plugin_fs::FsExt;
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

#[tauri::command]
pub fn create_document(state: State<'_, AppState>) -> Result<DocumentOpenResult, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .create_document()
}

#[tauri::command]
pub fn open_document_tracking(
    path: String,
    source_fingerprint: Option<FileFingerprint>,
    state: State<'_, AppState>,
) -> Result<DocumentOpenResult, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .open_document_tracking(PathBuf::from(path), source_fingerprint)
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
pub fn prepare_staged_hwp_save(app: AppHandle, target_path: String) -> Result<String, String> {
    prepare_staged_file(
        &app,
        PathBuf::from(target_path),
        ensure_hwp_target_path,
        staged_hwp_save_path,
    )
}

#[tauri::command]
pub fn prepare_staged_hwp_pdf_export(
    app: AppHandle,
    target_path: String,
) -> Result<String, String> {
    prepare_staged_file(
        &app,
        PathBuf::from(target_path),
        ensure_pdf_target_path,
        staged_hwp_pdf_export_path,
    )
}

#[tauri::command]
pub fn commit_staged_hwp_save(
    doc_id: String,
    staged_path: String,
    target_path: String,
    expected_revision: Option<u64>,
    allow_external_overwrite: Option<bool>,
    state: State<'_, AppState>,
) -> Result<SaveResult, String> {
    let target_path = PathBuf::from(target_path);
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .commit_staged_hwp_save(
            &doc_id,
            PathBuf::from(staged_path),
            target_path,
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
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?;
    sessions.query_document(&doc_id, &query, args)
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

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?;
    let session = sessions.session_mut(&doc_id)?;
    let core = session.ensure_core_loaded()?;
    export_pdf_from_core(&app, &job_id, core, target_path, page_range, open_after)?;
    Ok(job_id)
}

#[tauri::command]
pub fn export_pdf_from_hwp_path(
    app: AppHandle,
    staged_path: String,
    target_path: String,
    page_range: Option<PageRange>,
    open_after: bool,
) -> Result<String, String> {
    let job_id = Uuid::new_v4().to_string();

    let staged_path = PathBuf::from(staged_path);
    let bytes = std::fs::read(&staged_path).map_err(|e| {
        format!(
            "PDF 내보내기용 staging 파일을 읽을 수 없습니다: {} ({})",
            staged_path.display(),
            e
        )
    })?;
    let core = editable_core_from_bytes(
        &bytes,
        "문서 바이트 파싱 실패",
        "PDF 내보내기용 문서 변환 실패",
    )?;
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
pub fn list_local_fonts() -> Result<Vec<LocalFontEntry>, String> {
    Ok(crate::font_catalog::collect_desktop_local_font_entries())
}

#[tauri::command]
pub fn read_local_font(path: String) -> Result<Vec<u8>, String> {
    crate::font_catalog::read_desktop_local_font(Path::new(&path))
}

fn allow_frontend_fs_file(app: &AppHandle, path: &Path) -> Result<(), String> {
    let scope = app.fs_scope();
    scope
        .allow_file(path)
        .map_err(|e| format!("filesystem scope 갱신 실패: {}", e))?;
    Ok(())
}

fn prepare_staged_file(
    app: &AppHandle,
    target_path: PathBuf,
    validate_target: fn(&Path) -> Result<(), String>,
    build_staged_path: fn(&Path) -> Result<PathBuf, String>,
) -> Result<String, String> {
    validate_target(&target_path)?;
    let staged_path = build_staged_path(&target_path)?;
    allow_frontend_fs_file(app, &staged_path)?;
    Ok(staged_path.to_string_lossy().to_string())
}

fn ensure_hwp_target_path(path: &Path) -> Result<(), String> {
    ensure_target_parent(path, "저장 경로")?;
    let format = DocumentFormat::from_path(path)?;
    if format == DocumentFormat::Hwpx {
        return Err(
            "HWPX 경로에는 HWP 바이트를 저장할 수 없습니다. .hwp 파일로 저장하세요.".to_string(),
        );
    }
    Ok(())
}

fn staged_hwp_save_path(target_path: &Path) -> Result<PathBuf, String> {
    staged_sibling_path(target_path, ".hop-save-", ".tmp")
}

fn ensure_pdf_target_path(path: &Path) -> Result<(), String> {
    ensure_target_parent(path, "PDF 경로")?;
    crate::pdf_export::ensure_pdf_path(path)
}

fn staged_hwp_pdf_export_path(target_path: &Path) -> Result<PathBuf, String> {
    staged_sibling_path(target_path, ".hop-export-", ".hwp")
}

fn ensure_target_parent(path: &Path, context: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| {
            format!(
                "{}의 상위 디렉터리를 찾을 수 없습니다: {}",
                context,
                path.display()
            )
        })?;
    if !parent.is_dir() {
        return Err(format!(
            "{}의 상위 디렉터리가 유효하지 않습니다: {}",
            context,
            parent.display()
        ));
    }
    Ok(())
}

fn staged_sibling_path(target_path: &Path, marker: &str, suffix: &str) -> Result<PathBuf, String> {
    let file_name = target_path.file_name().ok_or_else(|| {
        format!(
            "저장 경로의 파일 이름을 찾을 수 없습니다: {}",
            target_path.display()
        )
    })?;
    let mut staged_name = file_name.to_os_string();
    staged_name.push(format!("{}{}{}", marker, Uuid::new_v4().simple(), suffix));
    Ok(target_path.with_file_name(staged_name))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_hwp_target_path_accepts_existing_hwp_parent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("saved.hwp");

        assert!(ensure_hwp_target_path(&path).is_ok());
    }

    #[test]
    fn ensure_hwp_target_path_rejects_invalid_parent_and_hwpx() {
        let dir = tempfile::tempdir().unwrap();
        let missing_parent = dir.path().join("missing").join("saved.hwp");

        assert!(ensure_hwp_target_path(&missing_parent).is_err());
        assert!(ensure_hwp_target_path(&dir.path().join("saved.hwpx")).is_err());
    }

    #[test]
    fn staged_hwp_save_path_keeps_parent_and_adds_unique_suffix() {
        let dir = tempfile::tempdir().unwrap();
        let target_path = dir.path().join("saved.hwp");

        let staged_path = staged_hwp_save_path(&target_path).unwrap();

        assert_eq!(staged_path.parent(), target_path.parent());
        assert_ne!(staged_path, target_path);
        assert!(staged_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("saved.hwp.hop-save-"));
        assert!(staged_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(".tmp"));
    }

    #[test]
    fn staged_hwp_pdf_export_path_uses_hwp_sibling_file() {
        let dir = tempfile::tempdir().unwrap();
        let target_path = dir.path().join("export.pdf");

        let staged_path = staged_hwp_pdf_export_path(&target_path).unwrap();

        assert_eq!(staged_path.parent(), target_path.parent());
        assert_ne!(staged_path, target_path);
        assert!(staged_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("export.pdf.hop-export-"));
        assert_eq!(
            staged_path
                .extension()
                .and_then(|extension| extension.to_str()),
            Some("hwp")
        );
    }
}
