use anyhow::{anyhow, Result};
use notify::{Watcher, RecursiveMode};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::panic::{self, AssertUnwindSafe};
use rhwp::DocumentCore;
use serde::{Serialize, Deserialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct ChunkMetadata {
    pub file_path: String,
    pub text: String,
    pub project_name: String,
    pub page: u32,
    pub year: u32,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CategorizedFiles {
    pub public: Vec<String>,      // 홍보/보도
    pub internal: Vec<String>,    // 내부 보고/검토
    pub plan: Vec<String>,        // 계획서
    pub result: Vec<String>,      // 결과보고서
    pub cooperation: Vec<String>,  // 협조 공문
    pub others: Vec<String>,
}

/// Simple TF-IDF style keyword index — no external ML crates required.
pub struct RagManager {
    chunks: Vec<ChunkMetadata>,
    project_map: HashMap<String, Vec<String>>,
    pub watch_folder: Option<PathBuf>,
    manual_overrides: HashMap<String, String>, // file_path -> category
}

impl RagManager {
    pub fn new() -> Self {
        Self {
            chunks: Vec::new(),
            project_map: HashMap::new(),
            watch_folder: None,
            manual_overrides: HashMap::new(),
        }
    }

    pub fn index_folder(&mut self, folder: &Path) -> Result<(usize, usize)> {
        self.watch_folder = Some(folder.to_path_buf());
        let mut success_count = 0;
        let mut fail_count = 0;
        
        let mut stack = vec![folder.to_path_buf()];
        
        while let Some(current_dir) = stack.pop() {
            if let Ok(entries) = std::fs::read_dir(current_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        stack.push(path);
                        continue;
                    }

                    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                    match ext.as_str() {
                        "hwp" | "hwpx" | "xlsx" | "xls" | "pdf" | "txt" | "csv" => {
                            let _file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("unknown");
                            
                            if let Ok(meta) = std::fs::metadata(&path) {
                                if meta.len() > 50 * 1024 * 1024 {
                                    fail_count += 1;
                                    continue;
                                }
                            }

                            let result = panic::catch_unwind(AssertUnwindSafe(|| {
                                self.index_file(&path)
                            }));

                            match result {
                                Ok(Ok(_)) => { success_count += 1; }
                                _ => { fail_count += 1; }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        
        println!("[RAG] 재귀적 인덱싱 완료: 성공 {}, 실패 {}", success_count, fail_count);
        Ok((success_count, fail_count))
    }


    fn detect_project(&self, path: &Path) -> (String, u32) {
        let filename = path.file_stem().and_then(|s| s.to_str()).unwrap_or("알 수 없는 프로젝트");

        // Extract year heuristically (4-digit number 1900-2099)
        let year = filename
            .split(|c: char| !c.is_ascii_digit())
            .filter_map(|s| s.parse::<u32>().ok())
            .find(|&y| (1900..=2099).contains(&y))
            .unwrap_or(0);

        let stop_words = ["계획서", "결과보고서", "보고서", "안", "최종", "수정", "정산", "기획서", "기획"];
        let mut project_name = filename.to_string();
        for word in stop_words {
            project_name = project_name.replace(word, "");
        }
        project_name = project_name
            .trim_matches(|c| c == '_' || c == '-' || c == ' ')
            .to_string();

        (project_name, year)
    }

    pub fn index_file(&mut self, path: &Path) -> Result<()> {
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        let paged_chunks: Vec<(u32, String)> = match ext.as_str() {
            "hwp" => self.extract_hwp_text_paged(path)?,
            "pdf" => self.extract_pdf_text_paged(path)?,
            "xlsx" | "xls" => {
                let (txt, _) = self.extract_excel_text(path)?;
                vec![(1, txt)]
            }
            "txt" | "csv" => {
                let text = std::fs::read_to_string(path)?;
                vec![(1, text)]
            }
            _ => return Ok(()),
        };

        let (project_name, year) = self.detect_project(path);
        let file_path_str = path.to_string_lossy().to_string();

        self.project_map
            .entry(project_name.clone())
            .or_default()
            .push(file_path_str.clone());

        for (page, content) in paged_chunks {
            // Split into ~500-char chunks
            let chars: Vec<char> = content.chars().collect();
            for window in chars.chunks(500) {
                let chunk: String = window.iter().collect();
                if chunk.trim().is_empty() {
                    continue;
                }
                self.chunks.push(ChunkMetadata {
                    file_path: file_path_str.clone(),
                    text: chunk,
                    project_name: project_name.clone(),
                    page,
                    year,
                });
            }
        }
        Ok(())
    }

    pub fn extract_hwp_text_paged(&self, path: &Path) -> Result<Vec<(u32, String)>> {
        let bytes = std::fs::read(path)?;
        let core = DocumentCore::from_bytes(&bytes)
            .map_err(|e| anyhow!("RAG HWP Extraction Failure: {}", e))?;

        let info_json = core.get_document_info();
        let info: serde_json::Value = serde_json::from_str(&info_json)?;

        let mut paged_chunks = Vec::new();

        if let Some(sections) = info.get("sections").and_then(|v| v.as_array()) {
            for (s_idx, section) in sections.iter().enumerate() {
                let mut section_text = String::new();
                if let Some(paragraphs) = section.get("paragraphs").and_then(|v| v.as_array()) {
                    for para in paragraphs {
                        if let Some(text) = para.get("text").and_then(|v| v.as_str()) {
                            section_text.push_str(text);
                            section_text.push('\n');
                        }
                    }
                }
                paged_chunks.push((s_idx as u32 + 1, section_text));
            }
        }
        Ok(paged_chunks)
    }

    pub fn extract_hwp_text(&self, path: &Path) -> Result<(String, String)> {
        let paged = self.extract_hwp_text_paged(path)?;
        let full = paged.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>().join("\n");
        Ok((full, String::new()))
    }

    pub fn extract_excel_text(&self, path: &Path) -> Result<(String, String)> {
        use calamine::{Reader, Xlsx, open_workbook, Data};
        let mut workbook: Xlsx<_> = open_workbook(path).map_err(|e| anyhow!("Excel Open Error: {}", e))?;
        let mut full_text = String::new();
        let mut first_text = String::new();

        for sheet_name in workbook.sheet_names() {
            if let Ok(range) = workbook.worksheet_range(&sheet_name) {
                full_text.push_str(&format!("\n[Sheet: {}]\n", sheet_name));
                for row in range.rows() {
                    let row_str = row.iter().map(|c| match c {
                        Data::String(s) => s.clone(),
                        Data::Float(f) => f.to_string(),
                        Data::Int(i) => i.to_string(),
                        Data::Bool(b) => b.to_string(),
                        _ => "".to_string(),
                    }).collect::<Vec<_>>().join(" | ");
                    full_text.push_str(&row_str);
                    full_text.push('\n');
                    if first_text.len() < 200 { first_text.push_str(&row_str); }
                }
            }
        }
        Ok((full_text, first_text))
    }

    pub fn extract_pdf_text_paged(&self, path: &Path) -> Result<Vec<(u32, String)>> {
        use lopdf::Document;
        let doc = Document::load(path).map_err(|e| anyhow!("PDF Load Error: {}", e))?;
        let mut paged_chunks = Vec::new();

        for (idx, page) in doc.get_pages().keys().enumerate() {
            let text = doc.extract_text(&[*page]).unwrap_or_default();
            paged_chunks.push((idx as u32 + 1, text));
        }
        Ok(paged_chunks)
    }

    pub fn extract_pdf_text(&self, path: &Path) -> Result<(String, String)> {
        let paged = self.extract_pdf_text_paged(path)?;
        let full = paged.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>().join("\n");
        Ok((full, String::new()))
    }

    /// BM25-style keyword search — no external vector library required.
    pub fn search(&self, query: &str, k: usize) -> Result<Vec<ChunkMetadata>> {
        if self.chunks.is_empty() {
            return Ok(vec![]);
        }

        let query_tokens: Vec<String> = tokenize(query);
        let current_year: u32 = 2026;

        let mut scored: Vec<(f32, usize)> = self.chunks
            .iter()
            .enumerate()
            .map(|(idx, chunk)| {
                let mut score = keyword_score(&query_tokens, &chunk.text);

                // Recency boost
                if chunk.year > 0 {
                    let diff = current_year as i32 - chunk.year as i32;
                    if diff <= 1 { score *= 1.25; }
                }

                // Admin & Template keyword boost
                let path_lower = chunk.file_path.to_lowercase();
                if path_lower.contains("조례") || path_lower.contains("계획") || path_lower.contains("보고") || path_lower.contains("공문") {
                    score *= 1.25;
                }
                if path_lower.contains("서식") || path_lower.contains("양식") || path_lower.contains("템플릿") || path_lower.contains("기준") {
                    score *= 1.4; // Strong boost for templates
                }

                (score, idx)
            })
            .filter(|(score, _)| *score > 0.0)
            .collect();

        // k개만 필요하므로 전체 정렬(O(n log n)) 대신 partial sort(O(n + k log k)) 사용
        if scored.len() > k {
            scored.select_nth_unstable_by(k, |a, b| {
                b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal)
            });
            scored.truncate(k);
        }
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        Ok(scored
            .into_iter()
            .map(|(_, idx)| self.chunks[idx].clone())
            .collect())
    }

    pub fn get_related_project_files(&self, file_path: &str) -> Option<(String, Vec<String>)> {
        let project_name = self.chunks.iter()
            .find(|m| m.file_path == file_path)
            .map(|m| m.project_name.clone())?;

        let files = self.project_map.get(&project_name)?.clone();
        let filtered: Vec<String> = files.into_iter().filter(|p| p != file_path).collect();
        Some((project_name, filtered))
    }

    pub fn reclassify_file(&mut self, file_path: String, category: String) -> Result<()> {
        self.manual_overrides.insert(file_path.clone(), category);
        
        // If file is not indexed yet, index it now
        let exists = self.chunks.iter().any(|c| c.file_path == file_path);
        if !exists {
            let path = std::path::PathBuf::from(&file_path);
            if path.exists() {
                let _ = self.index_file(&path);
            }
        }
        Ok(())
    }

    pub fn get_watch_folder(&self) -> Option<&Path> {
        self.watch_folder.as_deref()
    }

    pub fn get_projects(&self) -> Vec<String> {
        self.project_map.keys().cloned().collect()
    }

    pub fn get_all_projects(&self) -> Vec<String> {
        self.get_projects()
    }

    pub fn get_categorized_files(&self) -> CategorizedFiles {
        let mut public = Vec::new();
        let mut internal = Vec::new();
        let mut plan = Vec::new();
        let mut result = Vec::new();
        let mut cooperation = Vec::new();
        let mut others = Vec::new();

        let mut seen_files = std::collections::HashSet::new();

        for chunk in &self.chunks {
            if seen_files.contains(&chunk.file_path) {
                continue;
            }
            
            let fname = std::path::Path::new(&chunk.file_path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("알 수 없는 파일");

            // --- 1. Check for Manual Override FIRST ---
            if let Some(category) = self.manual_overrides.get(&chunk.file_path) {
                match category.as_str() {
                    "public" => public.push(fname.to_string()),
                    "internal" => internal.push(fname.to_string()),
                    "plan" => plan.push(fname.to_string()),
                    "result" => result.push(fname.to_string()),
                    "cooperation" => cooperation.push(fname.to_string()),
                    _ => others.push(fname.to_string()),
                }
                seen_files.insert(chunk.file_path.clone());
                continue;
            }

            // --- 2. Automatic Keyword Matching ---
            let text_lower = chunk.text.to_lowercase();
            let fname_lower = fname.to_lowercase();

            // Categorization priority based on Filename FIRST, then content
            if fname_lower.contains("보도") || fname_lower.contains("알림") || fname_lower.contains("뉴스") || fname_lower.contains("배포") || fname_lower.contains("소식") || text_lower.contains("보도자료") || text_lower.contains("배포") {
                public.push(fname.to_string());
                seen_files.insert(chunk.file_path.clone());
            } else if fname_lower.contains("결과") || fname_lower.contains("성과") || fname_lower.contains("종료") || text_lower.contains("결과보고") || text_lower.contains("성과보고") {
                result.push(fname.to_string());
                seen_files.insert(chunk.file_path.clone());
            } else if fname_lower.contains("계획") || fname_lower.contains("추진") || fname_lower.contains("실시") || fname_lower.contains("실행") || fname_lower.contains("안") || text_lower.contains("추진계획") || text_lower.contains("실시계획") {
                plan.push(fname.to_string());
                seen_files.insert(chunk.file_path.clone());
            } else if fname_lower.contains("홍보") || fname_lower.contains("주민") || fname_lower.contains("내문") || fname_lower.contains("광고") || text_lower.contains("소식지") || text_lower.contains("안내문") {
                public.push(fname.to_string());
                seen_files.insert(chunk.file_path.clone());
            } else if fname_lower.contains("보고") || fname_lower.contains("검토") || fname_lower.contains("방침") || fname_lower.contains("기획") || text_lower.contains("검토보고") || text_lower.contains("기획안") {
                internal.push(fname.to_string());
                seen_files.insert(chunk.file_path.clone());
            } else if fname_lower.contains("공문") || fname_lower.contains("협조") || fname_lower.contains("발신") || fname_lower.contains("수신") || text_lower.contains("협조요청") {
                cooperation.push(fname.to_string());
                seen_files.insert(chunk.file_path.clone());
            }
        }
        
        // Add remaining files that were not caught by keywords to 'others'
        for chunk in &self.chunks {
            if !seen_files.contains(&chunk.file_path) {
                let fname = std::path::Path::new(&chunk.file_path)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("알 수 없는 파일");
                others.push(fname.to_string());
                seen_files.insert(chunk.file_path.clone());
            }
        }

        CategorizedFiles {
            public,
            internal,
            plan,
            result,
            cooperation,
            others,
        }
    }
}

/// Simple whitespace + punctuation tokenizer.
pub fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| c.is_whitespace() || ".,!?;:\"'()[]{}".contains(c))
        .filter(|s| s.len() > 1)
        .map(|s| s.to_string())
        .collect()
}

/// Count how many query tokens appear in the chunk text.
pub fn keyword_score(query_tokens: &[String], text: &str) -> f32 {
    let text_lower = text.to_lowercase();
    let mut hits = 0u32;
    for token in query_tokens {
        if text_lower.contains(&token.to_lowercase()) {
            hits += 1;
        }
    }
    hits as f32 / (query_tokens.len().max(1) as f32)
}

pub fn spawn_watcher(rag: Arc<Mutex<RagManager>>, folder: PathBuf) -> Result<()> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx)?;
    watcher.watch(&folder, RecursiveMode::Recursive)?;

    std::thread::spawn(move || {
        // Keep watcher alive in this thread
        let _watcher = watcher;
        for res in rx {
            match res {
                Ok(event) => {
                    if let notify::event::EventKind::Modify(_)
                        | notify::event::EventKind::Create(_) = event.kind
                    {
                        for path in event.paths {
                            let ext = path.extension()
                                .and_then(|s| s.to_str())
                                .unwrap_or("")
                                .to_lowercase();
                            if ["hwp", "pdf", "txt", "csv"].contains(&ext.as_str()) {
                                if let Ok(mut r) = rag.lock() {
                                    let _ = r.index_file(&path);
                                }
                            }
                        }
                    }
                }
                Err(e) => eprintln!("watch error: {:?}", e),
            }
        }
    });

    Ok(())
}
