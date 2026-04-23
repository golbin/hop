use rhwp::DocumentCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hasher};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tempfile::NamedTempFile;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DocumentFormat {
    Hwp,
    Hwpx,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentWarning {
    pub code: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOpenResult {
    pub doc_id: String,
    pub file_name: String,
    pub source_path: Option<String>,
    pub format: DocumentFormat,
    pub page_count: u32,
    pub revision: u64,
    pub dirty: bool,
    pub warnings: Vec<DocumentWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub doc_id: String,
    pub source_path: Option<String>,
    pub format: DocumentFormat,
    pub revision: u64,
    pub dirty: bool,
    pub warnings: Vec<DocumentWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalModificationStatus {
    pub changed: bool,
    pub source_path: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileFingerprint {
    len: u64,
    modified_nanos: u128,
    content_hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    pub doc_id: String,
    pub revision: u64,
    pub page_count: u32,
    pub dirty: bool,
    pub cursor: Option<Value>,
    pub warnings: Vec<DocumentWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSvgResult {
    pub doc_id: String,
    pub page_index: u32,
    pub revision: u64,
    pub svg: String,
    pub warnings: Vec<DocumentWarning>,
}

pub struct DocumentSession {
    pub doc_id: String,
    pub source_path: Option<PathBuf>,
    pub source_format: DocumentFormat,
    pub source_fingerprint: Option<FileFingerprint>,
    pub dirty: bool,
    pub revision: u64,
    pub core: DocumentCore,
    pub page_svg_cache: HashMap<u32, (u64, String)>,
}

#[derive(Default)]
pub struct DocumentSessionManager {
    sessions: HashMap<String, DocumentSession>,
    active_doc_id: Option<String>,
}

#[derive(Default)]
pub struct AppState {
    pub sessions: Mutex<DocumentSessionManager>,
    pub pending_open_paths: Mutex<Vec<String>>,
    pub quit_requests: Mutex<crate::app_quit::AppQuitState>,
    pub updater: Mutex<crate::updates::UpdateManagerState>,
}

impl DocumentSessionManager {
    pub fn create_document(&mut self) -> Result<DocumentOpenResult, String> {
        let mut core = DocumentCore::new_empty();
        core.create_blank_document_native()
            .map_err(|e| format!("빈 문서 생성 실패: {}", e))?;
        let doc_id = Uuid::new_v4().to_string();
        let session = DocumentSession {
            doc_id: doc_id.clone(),
            source_path: None,
            source_format: DocumentFormat::Hwp,
            source_fingerprint: None,
            dirty: false,
            revision: 1,
            core,
            page_svg_cache: HashMap::new(),
        };
        let result = session.open_result("새 문서.hwp".to_string());
        self.sessions.insert(doc_id.clone(), session);
        self.active_doc_id = Some(doc_id);
        Ok(result)
    }

    pub fn open_document_from_bytes(
        &mut self,
        path: PathBuf,
        bytes: &[u8],
    ) -> Result<DocumentOpenResult, String> {
        let format = DocumentFormat::from_path(&path)?;

        let mut core =
            DocumentCore::from_bytes(bytes).map_err(|e| format!("문서 파싱 실패: {}", e))?;
        core.convert_to_editable_native()
            .map_err(|e| format!("편집 가능 문서 변환 실패: {}", e))?;

        let doc_id = Uuid::new_v4().to_string();
        let file_name = path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("document.hwp")
            .to_string();
        let session = DocumentSession {
            doc_id: doc_id.clone(),
            source_fingerprint: file_fingerprint_from_bytes(&path, bytes).ok(),
            source_path: Some(path),
            source_format: format,
            dirty: false,
            revision: 1,
            core,
            page_svg_cache: HashMap::new(),
        };
        let result = session.open_result(file_name);
        self.sessions.insert(doc_id.clone(), session);
        self.active_doc_id = Some(doc_id);
        Ok(result)
    }

    pub fn close_document(&mut self, doc_id: &str) -> Result<(), String> {
        self.sessions
            .remove(doc_id)
            .ok_or_else(|| format!("문서 세션을 찾을 수 없습니다: {}", doc_id))?;
        if self.active_doc_id.as_deref() == Some(doc_id) {
            self.active_doc_id = self.sessions.keys().next().cloned();
        }
        Ok(())
    }

    #[cfg(not(debug_assertions))]
    pub fn has_dirty_sessions(&self) -> bool {
        self.sessions.values().any(|session| session.dirty)
    }

    pub fn mark_document_dirty(&mut self, doc_id: &str) -> Result<(), String> {
        let session = self.session_mut(doc_id)?;
        session.dirty = true;
        Ok(())
    }

    pub fn commit_staged_hwp_save(
        &mut self,
        doc_id: &str,
        staged_path: PathBuf,
        target_path: PathBuf,
        expected_revision: Option<u64>,
        allow_external_overwrite: bool,
    ) -> Result<SaveResult, String> {
        let session = self.session_mut(doc_id)?;
        session.check_revision(expected_revision)?;
        if !allow_external_overwrite {
            session.check_external_modification_for_path(&target_path)?;
        }
        let format = DocumentFormat::from_path(&target_path)?;
        if format == DocumentFormat::Hwpx {
            return Err(
                "HWPX 경로에는 HWP 바이트를 저장할 수 없습니다. .hwp 파일로 저장하세요."
                    .to_string(),
            );
        }
        let bytes = std::fs::read(&staged_path).map_err(|e| {
            format!(
                "staging 파일을 읽을 수 없습니다: {} ({})",
                staged_path.display(),
                e
            )
        })?;
        let mut core = DocumentCore::from_bytes(&bytes)
            .map_err(|e| format!("저장 바이트 검증 실패: {}", e))?;
        core.convert_to_editable_native()
            .map_err(|e| format!("저장 문서 변환 실패: {}", e))?;
        session.finish_hwp_save(target_path, &bytes, Some(core))?;
        let _ = std::fs::remove_file(&staged_path);
        Ok(session.save_result())
    }

    pub fn external_modification_status(
        &self,
        doc_id: &str,
        target_path: Option<PathBuf>,
    ) -> Result<ExternalModificationStatus, String> {
        let session = self.session(doc_id)?;
        session.external_modification_status(target_path.as_deref())
    }

    pub fn render_page_svg(
        &mut self,
        doc_id: &str,
        page_index: u32,
        revision: Option<u64>,
    ) -> Result<PageSvgResult, String> {
        let session = self.session_mut(doc_id)?;
        if let Some(rev) = revision {
            if rev != session.revision {
                session.page_svg_cache.remove(&page_index);
            }
        }
        if let Some((cached_revision, svg)) = session.page_svg_cache.get(&page_index) {
            if *cached_revision == session.revision {
                return Ok(PageSvgResult {
                    doc_id: session.doc_id.clone(),
                    page_index,
                    revision: session.revision,
                    svg: svg.clone(),
                    warnings: Vec::new(),
                });
            }
        }
        let svg = session
            .core
            .render_page_svg_native(page_index)
            .map_err(|e| format!("페이지 렌더링 실패: {}", e))?;
        session
            .page_svg_cache
            .insert(page_index, (session.revision, svg.clone()));
        Ok(PageSvgResult {
            doc_id: session.doc_id.clone(),
            page_index,
            revision: session.revision,
            svg,
            warnings: Vec::new(),
        })
    }

    pub fn query_document(&self, doc_id: &str, query: &str, args: Value) -> Result<Value, String> {
        let session = self.session(doc_id)?;
        match query {
            "documentInfo" => parse_json_string(session.core.get_document_info()),
            "pageCount" => Ok(json!(session.core.page_count())),
            "pageInfo" => {
                let page_index = number_arg(&args, "pageIndex")?;
                parse_json_string(
                    session
                        .core
                        .get_page_info_native(page_index)
                        .map_err(|e| e.to_string())?,
                )
            }
            "pageDef" => {
                let section_index = number_arg(&args, "sectionIndex")?;
                parse_json_string(
                    session
                        .core
                        .get_page_def_native(section_index as usize)
                        .map_err(|e| e.to_string())?,
                )
            }
            "cursorRect" => {
                let sec = number_arg(&args, "sec")?;
                let para = number_arg(&args, "para")?;
                let char_offset = number_arg(&args, "charOffset")?;
                parse_json_string(
                    session
                        .core
                        .get_cursor_rect_native(sec as usize, para as usize, char_offset as usize)
                        .map_err(|e| e.to_string())?,
                )
            }
            "hitTest" => {
                let page_num = number_arg(&args, "pageNum")?;
                let x = float_arg(&args, "x")?;
                let y = float_arg(&args, "y")?;
                parse_json_string(
                    session
                        .core
                        .hit_test_native(page_num, x, y)
                        .map_err(|e| e.to_string())?,
                )
            }
            "paragraphLength" => {
                let sec = number_arg(&args, "sec")?;
                let para = number_arg(&args, "para")?;
                Ok(json!(session
                    .core
                    .get_paragraph_length_native(sec as usize, para as usize)
                    .map_err(|e| e.to_string())?))
            }
            "paragraphCount" => {
                let sec = number_arg(&args, "sec")?;
                Ok(json!(session
                    .core
                    .get_paragraph_count_native(sec as usize)
                    .map_err(|e| e.to_string())?))
            }
            _ => Err(format!("지원하지 않는 query입니다: {}", query)),
        }
    }

    pub fn mutate_document(
        &mut self,
        doc_id: &str,
        operation: &str,
        args: Value,
        expected_revision: Option<u64>,
    ) -> Result<MutationResult, String> {
        let session = self.session_mut(doc_id)?;
        session.check_revision(expected_revision)?;
        let cursor = match operation {
            "insertText" => {
                let sec = number_arg(&args, "sec")?;
                let para = number_arg(&args, "para")?;
                let char_offset = number_arg(&args, "charOffset")?;
                let text = string_arg(&args, "text")?;
                Some(parse_json_string(
                    session
                        .core
                        .insert_text_native(sec as usize, para as usize, char_offset as usize, text)
                        .map_err(|e| e.to_string())?,
                )?)
            }
            "deleteText" => {
                let sec = number_arg(&args, "sec")?;
                let para = number_arg(&args, "para")?;
                let char_offset = number_arg(&args, "charOffset")?;
                let count = number_arg(&args, "count")?;
                Some(parse_json_string(
                    session
                        .core
                        .delete_text_native(
                            sec as usize,
                            para as usize,
                            char_offset as usize,
                            count as usize,
                        )
                        .map_err(|e| e.to_string())?,
                )?)
            }
            "splitParagraph" => {
                let sec = number_arg(&args, "sec")?;
                let para = number_arg(&args, "para")?;
                let char_offset = number_arg(&args, "charOffset")?;
                Some(parse_json_string(
                    session
                        .core
                        .split_paragraph_native(sec as usize, para as usize, char_offset as usize)
                        .map_err(|e| e.to_string())?,
                )?)
            }
            "mergeParagraph" => {
                let sec = number_arg(&args, "sec")?;
                let para = number_arg(&args, "para")?;
                Some(parse_json_string(
                    session
                        .core
                        .merge_paragraph_native(sec as usize, para as usize)
                        .map_err(|e| e.to_string())?,
                )?)
            }
            _ => return Err(format!("지원하지 않는 mutation입니다: {}", operation)),
        };
        session.dirty = true;
        session.revision += 1;
        session.page_svg_cache.clear();
        Ok(MutationResult {
            doc_id: session.doc_id.clone(),
            revision: session.revision,
            page_count: session.core.page_count(),
            dirty: session.dirty,
            cursor,
            warnings: Vec::new(),
        })
    }

    pub fn session(&self, doc_id: &str) -> Result<&DocumentSession, String> {
        self.sessions
            .get(doc_id)
            .ok_or_else(|| format!("문서 세션을 찾을 수 없습니다: {}", doc_id))
    }

    fn session_mut(&mut self, doc_id: &str) -> Result<&mut DocumentSession, String> {
        self.sessions
            .get_mut(doc_id)
            .ok_or_else(|| format!("문서 세션을 찾을 수 없습니다: {}", doc_id))
    }
}

impl DocumentSession {
    fn open_result(&self, file_name: String) -> DocumentOpenResult {
        DocumentOpenResult {
            doc_id: self.doc_id.clone(),
            file_name,
            source_path: self
                .source_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            format: self.source_format,
            page_count: self.core.page_count(),
            revision: self.revision,
            dirty: self.dirty,
            warnings: Vec::new(),
        }
    }

    fn check_revision(&self, expected_revision: Option<u64>) -> Result<(), String> {
        if let Some(expected) = expected_revision {
            if expected != self.revision {
                return Err(format!(
                    "문서 revision이 변경되었습니다: expected {}, actual {}",
                    expected, self.revision
                ));
            }
        }
        Ok(())
    }

    fn check_external_modification_for_path(&self, target_path: &Path) -> Result<(), String> {
        let status = self.external_modification_status(Some(target_path))?;
        if status.changed {
            return Err(format!(
                "EXTERNAL_MODIFICATION: {}",
                status
                    .reason
                    .unwrap_or_else(|| "파일이 외부에서 변경되었습니다".to_string())
            ));
        }
        Ok(())
    }

    fn external_modification_status(
        &self,
        target_path: Option<&Path>,
    ) -> Result<ExternalModificationStatus, String> {
        let Some(source_path) = self.source_path.as_deref() else {
            return Ok(ExternalModificationStatus {
                changed: false,
                source_path: None,
                reason: None,
            });
        };

        let Some(baseline) = self.source_fingerprint.as_ref() else {
            return Ok(ExternalModificationStatus {
                changed: false,
                source_path: Some(source_path.to_string_lossy().to_string()),
                reason: None,
            });
        };

        if let Some(target) = target_path {
            if !same_path(source_path, target) {
                return Ok(ExternalModificationStatus {
                    changed: false,
                    source_path: Some(source_path.to_string_lossy().to_string()),
                    reason: None,
                });
            }
        }

        let current = match file_fingerprint(source_path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(ExternalModificationStatus {
                    changed: true,
                    source_path: Some(source_path.to_string_lossy().to_string()),
                    reason: Some("원본 파일이 삭제되었거나 이동되었습니다".to_string()),
                });
            }
            Err(error) => {
                return Err(format!(
                    "원본 파일 상태를 확인할 수 없습니다: {} ({})",
                    source_path.display(),
                    error
                ));
            }
        };

        if current != *baseline {
            return Ok(ExternalModificationStatus {
                changed: true,
                source_path: Some(source_path.to_string_lossy().to_string()),
                reason: Some("원본 파일이 HOP 밖에서 변경되었습니다".to_string()),
            });
        }

        Ok(ExternalModificationStatus {
            changed: false,
            source_path: Some(source_path.to_string_lossy().to_string()),
            reason: None,
        })
    }

    fn refresh_source_fingerprint_from_bytes(&mut self, bytes: &[u8]) -> Result<(), String> {
        if let Some(path) = self.source_path.as_deref() {
            self.source_fingerprint =
                Some(file_fingerprint_from_bytes(path, bytes).map_err(|e| {
                    format!(
                        "저장 후 파일 상태를 확인할 수 없습니다: {} ({})",
                        path.display(),
                        e
                    )
                })?);
        } else {
            self.source_fingerprint = None;
        }
        Ok(())
    }

    fn finish_hwp_save(
        &mut self,
        target_path: PathBuf,
        bytes: &[u8],
        core_override: Option<DocumentCore>,
    ) -> Result<(), String> {
        atomic_write(&target_path, bytes)?;
        if let Some(core) = core_override {
            self.core = core;
        }
        self.source_path = Some(target_path);
        self.source_format = DocumentFormat::Hwp;
        self.refresh_source_fingerprint_from_bytes(bytes)?;
        self.revision += 1;
        self.dirty = false;
        self.page_svg_cache.clear();
        Ok(())
    }

    fn save_result(&self) -> SaveResult {
        SaveResult {
            doc_id: self.doc_id.clone(),
            source_path: self
                .source_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            format: self.source_format,
            revision: self.revision,
            dirty: self.dirty,
            warnings: Vec::new(),
        }
    }
}

impl DocumentFormat {
    pub fn from_path(path: &Path) -> Result<Self, String> {
        match path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "hwp" => Ok(Self::Hwp),
            "hwpx" => Ok(Self::Hwpx),
            _ => Err(format!(
                "지원하지 않는 문서 확장자입니다: {}",
                path.display()
            )),
        }
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| {
            format!(
                "저장 경로의 상위 디렉터리를 찾을 수 없습니다: {}",
                path.display()
            )
        })?;
    let mut tmp = NamedTempFile::new_in(parent)
        .map_err(|e| format!("임시 파일 생성 실패: {} ({})", parent.display(), e))?;
    tmp.write_all(bytes)
        .map_err(|e| format!("임시 파일 쓰기 실패: {}", e))?;
    tmp.as_file()
        .sync_all()
        .map_err(|e| format!("임시 파일 flush 실패: {}", e))?;
    tmp.persist(path)
        .map_err(|e| format!("파일 교체 실패: {} ({})", path.display(), e.error))?;
    Ok(())
}

fn file_fingerprint(path: &Path) -> std::io::Result<FileFingerprint> {
    let metadata = std::fs::metadata(path)?;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = DefaultHasher::new();
    hash_reader(&mut file, &mut hasher)?;
    file_fingerprint_from_metadata(metadata, hasher.finish())
}

fn file_fingerprint_from_bytes(path: &Path, bytes: &[u8]) -> std::io::Result<FileFingerprint> {
    let metadata = std::fs::metadata(path)?;
    let mut hasher = DefaultHasher::new();
    hasher.write(bytes);
    file_fingerprint_from_metadata(metadata, hasher.finish())
}

fn file_fingerprint_from_metadata(
    metadata: std::fs::Metadata,
    content_hash: u64,
) -> std::io::Result<FileFingerprint> {
    let modified = metadata.modified()?;
    let modified_nanos = modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    Ok(FileFingerprint {
        len: metadata.len(),
        modified_nanos,
        content_hash,
    })
}

fn hash_reader(reader: &mut impl Read, hasher: &mut impl Hasher) -> std::io::Result<()> {
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(());
        }
        hasher.write(&buffer[..read]);
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

pub fn parse_json_string(raw: String) -> Result<Value, String> {
    serde_json::from_str(&raw).map_err(|e| format!("JSON 파싱 실패: {}", e))
}

fn number_arg(args: &Value, key: &str) -> Result<u32, String> {
    args.get(key)
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .ok_or_else(|| format!("숫자 인자가 필요합니다: {}", key))
}

fn float_arg(args: &Value, key: &str) -> Result<f64, String> {
    args.get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| format!("실수 인자가 필요합니다: {}", key))
}

fn string_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("문자열 인자가 필요합니다: {}", key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_format_from_path() {
        assert_eq!(
            DocumentFormat::from_path(Path::new("a.hwp")).unwrap(),
            DocumentFormat::Hwp
        );
        assert_eq!(
            DocumentFormat::from_path(Path::new("a.HWPX")).unwrap(),
            DocumentFormat::Hwpx
        );
        assert!(DocumentFormat::from_path(Path::new("a.txt")).is_err());
    }

    #[test]
    fn atomic_write_replaces_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.hwp");
        atomic_write(&path, b"first").unwrap();
        atomic_write(&path, b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");
    }

    #[test]
    fn new_document_starts_clean() {
        let mut manager = DocumentSessionManager::default();
        let result = manager.create_document().unwrap();
        assert!(!result.dirty);
    }

    #[test]
    fn byte_and_stream_fingerprints_match_for_large_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.hwp");
        let bytes = vec![7_u8; 128 * 1024 + 17];
        atomic_write(&path, &bytes).unwrap();

        assert_eq!(
            file_fingerprint_from_bytes(&path, &bytes).unwrap(),
            file_fingerprint(&path).unwrap()
        );
    }

    #[test]
    fn external_modification_detects_changed_source() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.hwp");
        atomic_write(&path, b"first").unwrap();

        let mut session = DocumentSession {
            doc_id: "doc".to_string(),
            source_path: Some(path.clone()),
            source_format: DocumentFormat::Hwp,
            source_fingerprint: Some(file_fingerprint(&path).unwrap()),
            dirty: false,
            revision: 1,
            core: DocumentCore::new_empty(),
            page_svg_cache: HashMap::new(),
        };

        atomic_write(&path, b"changed").unwrap();
        assert!(
            session
                .external_modification_status(Some(&path))
                .unwrap()
                .changed
        );

        session
            .refresh_source_fingerprint_from_bytes(b"changed")
            .unwrap();
        assert!(
            !session
                .external_modification_status(Some(&path))
                .unwrap()
                .changed
        );
    }

    #[test]
    fn external_modification_ignores_different_save_target() {
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("doc.hwp");
        let target_path = dir.path().join("copy.hwp");
        atomic_write(&source_path, b"first").unwrap();

        let session = DocumentSession {
            doc_id: "doc".to_string(),
            source_path: Some(source_path.clone()),
            source_format: DocumentFormat::Hwp,
            source_fingerprint: Some(file_fingerprint(&source_path).unwrap()),
            dirty: false,
            revision: 1,
            core: DocumentCore::new_empty(),
            page_svg_cache: HashMap::new(),
        };

        atomic_write(&source_path, b"changed").unwrap();
        assert!(
            !session
                .external_modification_status(Some(&target_path))
                .unwrap()
                .changed
        );
    }

    #[test]
    fn external_modification_detects_deleted_source() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.hwp");
        atomic_write(&path, b"first").unwrap();

        let session = DocumentSession {
            doc_id: "doc".to_string(),
            source_path: Some(path.clone()),
            source_format: DocumentFormat::Hwp,
            source_fingerprint: Some(file_fingerprint(&path).unwrap()),
            dirty: false,
            revision: 1,
            core: DocumentCore::new_empty(),
            page_svg_cache: HashMap::new(),
        };

        std::fs::remove_file(&path).unwrap();
        let status = session.external_modification_status(Some(&path)).unwrap();
        assert!(status.changed);
        assert_eq!(
            status.reason,
            Some("원본 파일이 삭제되었거나 이동되었습니다".to_string())
        );
    }

    #[test]
    fn mutation_rejects_stale_revision_before_touching_document() {
        let mut manager = DocumentSessionManager::default();
        let opened = manager.create_document().unwrap();

        let error = manager
            .mutate_document(
                &opened.doc_id,
                "insertText",
                json!({ "sec": 0, "para": 0, "charOffset": 0, "text": "x" }),
                Some(opened.revision + 1),
            )
            .unwrap_err();

        assert!(error.contains("문서 revision이 변경되었습니다"));
        assert_eq!(
            manager.session(&opened.doc_id).unwrap().revision,
            opened.revision
        );
        assert!(!manager.session(&opened.doc_id).unwrap().dirty);
    }

    #[test]
    fn commit_staged_hwp_save_reads_staged_file_and_updates_session() {
        let mut manager = DocumentSessionManager::default();
        let opened = manager.create_document().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let staged_path = dir.path().join("save.tmp");
        let target_path = dir.path().join("saved.hwp");

        let bytes = manager
            .session(&opened.doc_id)
            .unwrap()
            .core
            .export_hwp_native()
            .unwrap();
        std::fs::write(&staged_path, &bytes).unwrap();

        let result = manager
            .commit_staged_hwp_save(
                &opened.doc_id,
                staged_path.clone(),
                target_path.clone(),
                Some(opened.revision),
                false,
            )
            .unwrap();

        assert_eq!(
            result.source_path.as_deref(),
            Some(target_path.to_string_lossy().as_ref())
        );
        assert_eq!(std::fs::read(&target_path).unwrap(), bytes);
        assert!(!staged_path.exists());
        assert_eq!(
            manager.session(&opened.doc_id).unwrap().revision,
            opened.revision + 1
        );
        assert!(!manager.session(&opened.doc_id).unwrap().dirty);
    }

    #[test]
    fn commit_staged_hwp_save_rejects_hwpx_target_before_reading_staged_bytes() {
        let mut manager = DocumentSessionManager::default();
        let opened = manager.create_document().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let staged_path = dir.path().join("save.tmp");
        let target_path = dir.path().join("saved.hwpx");

        std::fs::write(&staged_path, b"not a hwp document").unwrap();

        let error = manager
            .commit_staged_hwp_save(
                &opened.doc_id,
                staged_path.clone(),
                target_path,
                Some(opened.revision),
                false,
            )
            .unwrap_err();

        assert!(error.contains("HWPX 경로에는 HWP 바이트를 저장할 수 없습니다"));
        assert!(staged_path.exists());
    }

    #[test]
    fn close_document_selects_remaining_session_as_active() {
        let mut manager = DocumentSessionManager::default();
        let first = manager.create_document().unwrap();
        let second = manager.create_document().unwrap();

        manager.close_document(&second.doc_id).unwrap();

        assert_eq!(manager.active_doc_id, Some(first.doc_id));
        assert!(manager.close_document("missing").is_err());
    }

    #[test]
    fn mark_document_dirty_updates_session_dirty_state() {
        let mut manager = DocumentSessionManager::default();
        let opened = manager.create_document().unwrap();

        manager.mark_document_dirty(&opened.doc_id).unwrap();

        assert!(manager.session(&opened.doc_id).unwrap().dirty);
        assert!(manager.mark_document_dirty("missing").is_err());
    }
}
