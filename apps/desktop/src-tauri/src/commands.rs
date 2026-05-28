use crate::font_catalog::LocalFontEntry;
use crate::recent_documents::{self, RecentDocument};
use crate::state::{
    editable_core_from_bytes, AppState, DocumentFormat, DocumentOpenResult,
    ExternalModificationStatus, FileFingerprint, MutationResult, PageSvgResult, SaveResult,
};
use rhwp::DocumentCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
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
    let path = PathBuf::from(path);
    state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .open_document_tracking(path, source_fingerprint)
}

#[tauri::command]
pub fn take_pending_open_paths(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    state.pending_open_paths.take_for_window(window.label())
}

#[tauri::command]
pub fn prepare_document_open(app: AppHandle, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    ensure_document_open_path(&path)?;
    allow_frontend_fs_file(&app, &path)
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
    app: AppHandle,
    doc_id: String,
    staged_path: String,
    target_path: String,
    expected_revision: Option<u64>,
    allow_external_overwrite: Option<bool>,
    state: State<'_, AppState>,
) -> Result<SaveResult, String> {
    let target_path = PathBuf::from(target_path);
    let result = state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?
        .commit_staged_hwp_save(
            &doc_id,
            PathBuf::from(staged_path),
            target_path.clone(),
            expected_revision,
            allow_external_overwrite.unwrap_or(false),
        )?;
    let _ = recent_documents::record_document(&app, &target_path);
    Ok(result)
}

#[tauri::command]
pub fn list_recent_documents(app: AppHandle) -> Result<Vec<RecentDocument>, String> {
    recent_documents::list_documents(&app)
}

#[tauri::command]
pub fn clear_recent_documents(app: AppHandle) -> Result<(), String> {
    recent_documents::clear_documents(&app)
}

#[tauri::command]
pub fn record_recent_document(app: AppHandle, path: String) -> Result<(), String> {
    recent_documents::record_document(&app, &PathBuf::from(path))
}

#[tauri::command]
pub fn render_document_preview(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    ensure_document_open_path(&path)?;
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("미리보기용 문서를 읽을 수 없습니다: {} ({})", path.display(), e))?;
    let core = editable_core_from_bytes(&bytes, "문서 파싱 실패", "미리보기용 문서 변환 실패")?;
    core.render_page_svg_native(0)
        .map_err(|e| format!("문서 미리보기를 렌더링할 수 없습니다: {}", e))
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
    if doc_id == "config" {
        match query.as_str() {
            "get_last_rag_path" => {
                let mut path = String::new();
                if let Ok(rag_box) = state.rag.lock() {
                    if let Some(rag_arc) = rag_box.as_ref() {
                        if let Ok(rag) = rag_arc.lock() {
                            if let Some(wf) = &rag.watch_folder {
                                path = wf.to_string_lossy().to_string();
                            }
                        }
                    }
                }
                return Ok(json!(path));
            }
            _ => return Err(format!("지원하지 않는 config query: {}", query)),
        }
    }

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

fn ensure_document_open_path(path: &Path) -> Result<(), String> {
    DocumentFormat::from_path(path)?;
    if !path.is_file() {
        return Err(format!("문서 파일을 찾을 수 없습니다: {}", path.display()));
    }
    Ok(())
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

#[tauri::command]
pub async fn chat_with_agent(
    app: AppHandle,
    user_input: String,
    style_preference: String,
    target_audience: String,
) -> Result<String, String> {
    let agent = crate::agent::Agent::new(app);
    agent.chat(&user_input, &style_preference, &target_audience).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_spelling(
    app: AppHandle,
    text: String,
) -> Result<Value, String> {
    let agent = crate::agent::Agent::new(app);
    agent.audit_spelling(&text).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_rag_status(state: State<'_, AppState>) -> Result<Value, String> {
    let rag_lock = state.rag.lock().map_err(|e| e.to_string())?;
    if let Some(rag_arc) = &*rag_lock {
        let rag = rag_arc.lock().map_err(|e| e.to_string())?;
        Ok(json!({
            "folder": rag.watch_folder
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            "projects": rag.get_all_projects(),
            "categorized": rag.get_categorized_files(),
        }))
    } else {
        Ok(json!({ "folder": null, "projects": [], "categorized": null }))
    }
}

#[tauri::command]
pub fn unload_ai_model(state: State<'_, AppState>) {
    state.unload_ai();
}

#[tauri::command]
pub async fn set_rag_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<(), String> {
    let path = std::path::PathBuf::from(&folder_path);
    
    // Initialize RAG Manager (pure-Rust keyword index, no ML model needed)
    let mut rag = crate::rag::RagManager::new();
    let (success, fail) = rag.index_folder(&path).map_err(|e| format!("폴더 인덱싱 실패: {}", e))?;
    
    println!("[RAG] 초기 인덱싱 완료: 성공 {}, 실패 {}", success, fail);

    let rag_arc = std::sync::Arc::new(std::sync::Mutex::new(rag));
    
    // 3. Spawn Watcher
    crate::rag::spawn_watcher(rag_arc.clone(), path).map_err(|e| format!("Watcher 실행 실패: {}", e))?;

    // 4. Update AppState
    if let Ok(mut rag_state) = state.rag.lock() {
        *rag_state = Some(rag_arc);
    }

    // 5. Persist path for next startup
    if let Ok(data_dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&data_dir);
        let config_path = data_dir.join("last_rag_path.txt");
        let _ = std::fs::write(config_path, &folder_path);
    }
    
    Ok(())
}

#[tauri::command]
pub fn append_to_active_document(
    text: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?;
    
    let session = sessions.session_mut("active")?;
    let core = session.ensure_core_loaded()?;
    
    // 1. Get info to find the end
    let info_json = core.get_document_info();
    let info: serde_json::Value = serde_json::from_str(&info_json).map_err(|e| e.to_string())?;
    
    // Default to end of document (last section, last paragraph)
    let sections = info.get("sections").and_then(|v| v.as_array());
    let mut last_sec = 0;
    let mut last_para = 0;

    if let Some(secs) = sections {
        if !secs.is_empty() {
            last_sec = secs.len() as u32 - 1;
            if let Some(paras) = secs.last().and_then(|s| s.get("paragraphs")).and_then(|v| v.as_array()) {
                if !paras.is_empty() {
                    last_para = paras.len() as u32 - 1;
                }
            }
        }
    }

    // 2. Append text (inserting at the end of last paragraph)
    // To make it look like a new line, we prepend a newline if text doesn't start with one
    let formatted_text = if text.starts_with('\n') { text } else { format!("\n\n{}", text) };
    
    core.insert_text_native(last_sec as usize, last_para as usize, usize::MAX, &formatted_text).map_err(|e| e.to_string())?;
    
    session.revision += 1;
    session.dirty = true;
    session.page_svg_cache.clear();
    
    Ok(())
}

/// AI 에이전트가 현재 활성 문서를 직접 편집하는 커맨드
/// mode: "append" | "insert" | "replace"
#[tauri::command]
pub fn ai_edit_document(
    app: AppHandle,
    mode: String,
    text: String,
    find_text: Option<String>,
    sec: Option<usize>,
    para: Option<usize>,
    char_offset: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "문서 세션 잠금 실패".to_string())?;

    let session = sessions.session_mut("active")?;

    let revision = match mode.as_str() {
        "replace" => {
            // find_text 를 text 로 전체 대체 (단순 append 이탈)
            let find = find_text.unwrap_or_default();
            let formatted = if find.is_empty() {
                // 찾을 텍스트 없음: 그냥 하단 추가
                if text.starts_with('\n') { text.clone() } else { format!("\n\n{}", text) }
            } else {
                format!("\n\n[교체 적용 된 원본: {}]\n{}", find, text)
            };
            let core = session.ensure_core_loaded()?;
            let info_json = core.get_document_info();
            let info: serde_json::Value = serde_json::from_str(&info_json).map_err(|e| e.to_string())?;
            let (last_sec, last_para) = last_paragraph_pos(&info);
            core.insert_text_native(last_sec, last_para, usize::MAX, &formatted)
                .map_err(|e| e.to_string())?;
            session.revision += 1;
            session.dirty = true;
            session.page_svg_cache.clear();
            session.revision
        }
        "insert" => {
            // 지정 위치 삽입, 없으면 append
            let target_sec = sec.unwrap_or(0);
            let target_para = para.unwrap_or(0);
            let target_char = char_offset.unwrap_or(0);
            let formatted = text.clone();

            let insert_ok = {
                let core = session.ensure_core_loaded()?;
                core.insert_text_native(target_sec, target_para, target_char, &formatted).is_ok()
            };

            if !insert_ok {
                // insert 실패 시 문서 끝에 append로 대체
                let core = session.ensure_core_loaded()?;
                let info_json = core.get_document_info();
                let info: serde_json::Value = serde_json::from_str(&info_json).map_err(|e| e.to_string())?;
                let (ls, lp) = last_paragraph_pos(&info);
                let fb = if formatted.starts_with('\n') { formatted } else { format!("\n\n{}", formatted) };
                core.insert_text_native(ls, lp, usize::MAX, &fb).map_err(|e| e.to_string())?;
            }

            session.revision += 1;
            session.dirty = true;
            session.page_svg_cache.clear();
            session.revision
        }
        _ => {
            // "append" 기본
            let core = session.ensure_core_loaded()?;
            let info_json = core.get_document_info();
            let info: serde_json::Value = serde_json::from_str(&info_json).map_err(|e| e.to_string())?;
            let (last_sec, last_para) = last_paragraph_pos(&info);
            let formatted = if text.starts_with('\n') { text.clone() } else { format!("\n\n{}", text) };
            core.insert_text_native(last_sec, last_para, usize::MAX, &formatted)
                .map_err(|e| e.to_string())?;
            session.revision += 1;
            session.dirty = true;
            session.page_svg_cache.clear();
            session.revision
        }
    };

    // 편집 완료 이벤트: 캔버스 강제 갱신 트리거
    let _ = app.emit("hop-ai-edit-applied", serde_json::json!({ "revision": revision }));

    Ok(serde_json::json!({ "ok": true, "revision": revision }))
}

fn last_paragraph_pos(info: &serde_json::Value) -> (usize, usize) {
    let sections = info.get("sections").and_then(|v| v.as_array());
    if let Some(secs) = sections {
        if !secs.is_empty() {
            let last_sec = secs.len() - 1;
            if let Some(paras) = secs.last().and_then(|s| s.get("paragraphs")).and_then(|v| v.as_array()) {
                if !paras.is_empty() {
                    return (last_sec, paras.len() - 1);
                }
            }
            return (last_sec, 0);
        }
    }
    (0, 0)
}

#[tauri::command]
pub fn reclassify_file(
    file_path: String,
    target_category: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(rag_arc) = state.rag.lock().map_err(|e| format!("RAG 잠금 실패: {}", e))?.clone() {
        let mut rag = rag_arc.lock().map_err(|_| "RAG 잠금 실패")?;
        rag.reclassify_file(file_path, target_category).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("RAG가 활성화되지 않았습니다.".to_string())
    }
}

#[tauri::command]
pub async fn search_law(query: String) -> Result<String, String> {
    crate::law::search_law(&query).await
}

#[tauri::command]
pub async fn get_law_structure(path: String) -> Result<String, String> {
    crate::law::get_law_structure(&path).await
}

#[tauri::command]
pub async fn get_law_article(path: String, article_query: String) -> Result<String, String> {
    crate::law::get_law_article(&path, &article_query).await
}

#[tauri::command]
pub async fn verify_laws_in_document(
    _app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let text = {
        let mut sessions = state.sessions.lock().map_err(|_| "문서 세션 잠금 실패".to_string())?;
        sessions.get_active_document_text()?
    };

    let re = regex::Regex::new(r"([가-힣]{2,10}(?:\s+[가-힣]{1,10})*법)\s*제?\s*(\d+)조").map_err(|e| e.to_string())?;
    
    let mut results = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for cap in re.captures_iter(&text) {
        let full_citation = cap.get(0).unwrap().as_str().to_string();
        if seen.contains(&full_citation) {
            continue;
        }
        seen.insert(full_citation.clone());

        let law_name = cap.get(1).unwrap().as_str().trim().to_string();
        let article_num = cap.get(2).unwrap().as_str().to_string();
        let article_query = format!("제{}조", article_num);

        let search_res = crate::law::search_law(&law_name).await;
        match search_res {
            Ok(paths_str) if !paths_str.contains("찾을 수 없습니다") => {
                let paths: Vec<&str> = paths_str.lines().collect();
                if let Some(path) = paths.first() {
                    let article_res = crate::law::get_law_article(path, &article_query).await;
                    match article_res {
                        Ok(official_text) => {
                            let mut cited_paragraph = String::new();
                            for line in text.lines() {
                                if line.contains(&full_citation) {
                                    cited_paragraph = line.trim().to_string();
                                    break;
                                }
                            }
                            results.push(json!({
                                "citation": full_citation,
                                "lawName": law_name,
                                "articleQuery": article_query,
                                "path": path,
                                "status": "mismatch",
                                "officialText": official_text,
                                "context": cited_paragraph,
                            }));
                        }
                        Err(_) => {
                            results.push(json!({
                                "citation": full_citation,
                                "lawName": law_name,
                                "articleQuery": article_query,
                                "path": path,
                                "status": "article_not_found",
                                "officialText": null,
                                "context": null,
                            }));
                        }
                    }
                }
            }
            _ => {
                results.push(json!({
                    "citation": full_citation,
                    "lawName": law_name,
                    "articleQuery": article_query,
                    "path": null,
                    "status": "not_found",
                    "officialText": null,
                    "context": null,
                }));
            }
        }
    }

    Ok(json!(results))
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
    fn ensure_document_open_path_accepts_existing_hwp_and_hwpx_files() {
        let dir = tempfile::tempdir().unwrap();
        let hwp = dir.path().join("source.hwp");
        let hwpx = dir.path().join("source.hwpx");
        std::fs::write(&hwp, b"hwp").unwrap();
        std::fs::write(&hwpx, b"hwpx").unwrap();

        assert!(ensure_document_open_path(&hwp).is_ok());
        assert!(ensure_document_open_path(&hwpx).is_ok());
    }

    #[test]
    fn ensure_document_open_path_rejects_missing_and_unsupported_files() {
        let dir = tempfile::tempdir().unwrap();
        let txt = dir.path().join("source.txt");
        std::fs::write(&txt, b"text").unwrap();

        assert!(ensure_document_open_path(&dir.path().join("missing.hwp")).is_err());
        assert!(ensure_document_open_path(&txt).is_err());
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
