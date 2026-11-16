use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const RECENT_DOCUMENTS_FILE: &str = "recent-documents.json";
const MAX_RECENT_DOCUMENTS: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentDocument {
    pub path: String,
    pub file_name: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentDocumentStore {
    documents: Vec<RecentDocument>,
}

pub fn list_documents(app: &AppHandle) -> Result<Vec<RecentDocument>, String> {
    list_documents_at(&store_path(app)?)
}

pub fn clear_documents(app: &AppHandle) -> Result<(), String> {
    write_store(&store_path(app)?, &RecentDocumentStore::default())
}

pub fn record_document(app: &AppHandle, path: &Path) -> Result<(), String> {
    record_document_at(&store_path(app)?, path)?;
    Ok(())
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| crate::ui_text::text_with("recent.locationMissing", &[&e]))?;
    Ok(dir.join(RECENT_DOCUMENTS_FILE))
}

fn list_documents_at(store_path: &Path) -> Result<Vec<RecentDocument>, String> {
    let store = read_store(store_path)?;
    Ok(store
        .documents
        .into_iter()
        .filter(|document| is_existing_supported_document(&document.path))
        .take(MAX_RECENT_DOCUMENTS)
        .collect())
}

fn record_document_at(store_path: &Path, path: &Path) -> Result<bool, String> {
    if !is_existing_supported_document_path(path) {
        return Ok(false);
    }

    let normalized_path = normalized_document_path(path);
    let Some(file_name) = Path::new(&normalized_path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
    else {
        return Ok(false);
    };

    let mut documents = list_documents_at(store_path)?;
    documents.retain(|document| !same_document_path(&document.path, &normalized_path));
    documents.insert(
        0,
        RecentDocument {
            path: normalized_path,
            file_name,
        },
    );
    documents.truncate(MAX_RECENT_DOCUMENTS);
    write_store(store_path, &RecentDocumentStore { documents })?;
    Ok(true)
}

fn read_store(store_path: &Path) -> Result<RecentDocumentStore, String> {
    match fs::read_to_string(store_path) {
        Ok(content) => Ok(serde_json::from_str(&content).unwrap_or_default()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(RecentDocumentStore::default())
        }
        Err(error) => Err(crate::ui_text::text_with("recent.readFailed", &[&error])),
    }
}

fn write_store(store_path: &Path, store: &RecentDocumentStore) -> Result<(), String> {
    if let Some(parent) = store_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| crate::ui_text::text_with("recent.locationCreateFailed", &[&e]))?;
    }
    let content = serde_json::to_vec_pretty(store)
        .map_err(|e| crate::ui_text::text_with("recent.saveFailed", &[&e]))?;
    fs::write(store_path, content)
        .map_err(|e| crate::ui_text::text_with("recent.saveFailed", &[&e]))
}

fn is_existing_supported_document(path: &str) -> bool {
    is_existing_supported_document_path(Path::new(path))
}

fn is_existing_supported_document_path(path: &Path) -> bool {
    path.is_file() && is_supported_document_path(path)
}

fn is_supported_document_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("hwp" | "hwpx")
    )
}

fn normalized_document_path(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn same_document_path(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_document_keeps_most_recent_first_and_deduplicates() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("recent.json");
        let first = dir.path().join("first.hwp");
        let second = dir.path().join("second.hwpx");
        fs::write(&first, b"first").unwrap();
        fs::write(&second, b"second").unwrap();

        assert!(record_document_at(&store, &first).unwrap());
        assert!(record_document_at(&store, &second).unwrap());
        assert!(record_document_at(&store, &first).unwrap());

        let documents = list_documents_at(&store).unwrap();
        assert_eq!(documents.len(), 2);
        assert_eq!(documents[0].file_name, "first.hwp");
        assert_eq!(documents[1].file_name, "second.hwpx");
    }

    #[test]
    fn record_document_skips_unsupported_paths() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("recent.json");
        let unsupported = dir.path().join("notes.txt");
        fs::write(&unsupported, b"notes").unwrap();

        assert!(!record_document_at(&store, &unsupported).unwrap());
        assert!(!store.exists());
    }

    #[test]
    fn record_document_skips_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("recent.json");

        assert!(!record_document_at(&store, &dir.path().join("missing.hwp")).unwrap());
        assert!(!store.exists());
    }

    #[test]
    fn list_documents_filters_missing_and_unsupported_entries() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("recent.json");
        let kept = dir.path().join("kept.hwp");
        let unsupported = dir.path().join("notes.txt");
        fs::write(&kept, b"kept").unwrap();
        fs::write(&unsupported, b"notes").unwrap();
        write_store(
            &store,
            &RecentDocumentStore {
                documents: vec![
                    RecentDocument {
                        path: unsupported.to_string_lossy().to_string(),
                        file_name: "notes.txt".to_string(),
                    },
                    RecentDocument {
                        path: dir
                            .path()
                            .join("missing.hwpx")
                            .to_string_lossy()
                            .to_string(),
                        file_name: "missing.hwpx".to_string(),
                    },
                    RecentDocument {
                        path: kept.to_string_lossy().to_string(),
                        file_name: "kept.hwp".to_string(),
                    },
                ],
            },
        )
        .unwrap();

        assert_eq!(
            list_documents_at(&store).unwrap(),
            vec![RecentDocument {
                path: kept.to_string_lossy().to_string(),
                file_name: "kept.hwp".to_string(),
            }]
        );
    }

    #[test]
    fn record_document_limits_list_size() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("recent.json");
        for index in 0..12 {
            let path = dir.path().join(format!("doc-{index}.hwp"));
            fs::write(&path, b"doc").unwrap();
            assert!(record_document_at(&store, &path).unwrap());
        }

        let documents = list_documents_at(&store).unwrap();
        assert_eq!(documents.len(), MAX_RECENT_DOCUMENTS);
        assert_eq!(documents[0].file_name, "doc-11.hwp");
        assert_eq!(documents[9].file_name, "doc-2.hwp");
    }

    #[test]
    fn malformed_store_is_treated_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("recent.json");
        fs::write(&store, b"not json").unwrap();

        assert_eq!(
            list_documents_at(&store).unwrap(),
            Vec::<RecentDocument>::new()
        );
    }
}
