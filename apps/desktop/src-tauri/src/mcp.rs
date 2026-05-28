use tauri::AppHandle;
use tauri::Manager;
use crate::state::AppState;
use serde_json::json;
use mcp_sdk_rs::server::{Server, ServerHandler};
use mcp_sdk_rs::transport::stdio::StdioTransport;
use mcp_sdk_rs::types::{
    Tool, ToolResult, MessageContent, Implementation, ClientCapabilities, ServerCapabilities
};
use mcp_sdk_rs::error::{Error, ErrorCode};
use std::sync::Arc;
use async_trait::async_trait;

fn text_result(text: String) -> ToolResult {
    ToolResult {
        content: vec![MessageContent::Text { text }],
        structured_content: None,
    }
}

pub struct HopMcpHandler {
    app_handle: AppHandle,
}

#[async_trait]
impl ServerHandler for HopMcpHandler {
    async fn initialize(
        &self,
        _implementation: Implementation,
        _capabilities: ClientCapabilities,
    ) -> Result<ServerCapabilities, Error> {
        Ok(ServerCapabilities {
            tools: Some(json!({
                "listChanged": true
            })),
            ..Default::default()
        })
    }

    async fn shutdown(&self) -> Result<(), Error> {
        Ok(())
    }

    async fn handle_method(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, mcp_sdk_rs::Error> {
        let app = self.app_handle.clone();
        let params = params.unwrap_or(json!({}));

        match method {
            "read_hwp_table" => {
                let state = app.state::<AppState>();
                let mut sessions = state.sessions.lock().map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?;
                let active_doc_id = sessions.active_document_id()
                    .ok_or_else(|| Error::protocol(ErrorCode::InternalError, "활성 문서가 없습니다"))?;
                let tables = sessions.query_document(&active_doc_id, "tables", json!({}))
                    .map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?;
                Ok(serde_json::to_value(text_result(format!("{:?}", tables)))?)
            }
            "create_hwp_table" => {
                let sec = params.get("sec").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                let para = params.get("para").and_then(|v| v.as_u64()).ok_or_else(|| Error::protocol(ErrorCode::InternalError, "para가 필요합니다"))? as u32;
                let char_offset = params.get("char_offset").and_then(|v| v.as_u64()).ok_or_else(|| Error::protocol(ErrorCode::InternalError, "char_offset이 필요합니다"))? as u32;
                let rows = params.get("rows").and_then(|v| v.as_u64()).ok_or_else(|| Error::protocol(ErrorCode::InternalError, "rows가 필요합니다"))? as u32;
                let cols = params.get("cols").and_then(|v| v.as_u64()).ok_or_else(|| Error::protocol(ErrorCode::InternalError, "cols가 필요합니다"))? as u32;
                let data = params.get("data").cloned().unwrap_or(json!([]));

                let state = app.state::<AppState>();
                let mut sessions = state.sessions.lock().map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?;
                let active_doc_id = sessions.active_document_id()
                    .ok_or_else(|| Error::protocol(ErrorCode::InternalError, "활성 문서가 없습니다"))?;

                sessions.mutate_document(
                    &active_doc_id,
                    "insertTable",
                    json!({ "sec": sec, "para": para, "charOffset": char_offset, "rows": rows, "cols": cols, "data": data }),
                    None
                ).map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?;
                Ok(serde_json::to_value(text_result("success".to_string()))?)
            }
            "apply_standard_style" => {
                let state = app.state::<AppState>();
                let mut sessions = state.sessions.lock().map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?;
                let active_doc_id = sessions.active_document_id()
                    .ok_or_else(|| Error::protocol(ErrorCode::InternalError, "활성 문서가 없습니다"))?;
                sessions.apply_administrative_preset(&active_doc_id)
                    .map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?;
                Ok(serde_json::to_value(text_result("success: Seongdong Standard Preset Applied".to_string()))?)
            }
            "read_external_file" => {
                let path_str = params.get("path").and_then(|v| v.as_str())
                    .ok_or_else(|| Error::protocol(ErrorCode::InternalError, "path가 필요합니다"))?;
                let path = std::path::Path::new(path_str);
                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();

                let state = app.state::<AppState>();
                let rag_guard = state.rag.lock().map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?;
                if let Some(rag_arc) = rag_guard.as_ref() {
                    let rag = rag_arc.lock().map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?;
                    let (content, _) = match ext.as_str() {
                        "hwp" => rag.extract_hwp_text(path).map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?,
                        "xlsx" | "xls" => rag.extract_excel_text(path).map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?,
                        "pdf" => rag.extract_pdf_text(path).map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?,
                        "txt" | "csv" => {
                            let text = std::fs::read_to_string(path).map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?;
                            (text, String::new())
                        }
                        _ => return Err(Error::protocol(ErrorCode::InternalError, format!("지원하지 않는 파일 형식: {}", ext))),
                    };
                    Ok(serde_json::to_value(text_result(content))?)
                } else {
                    Err(Error::protocol(ErrorCode::InternalError, "RAG 관리자가 초기화되지 않았습니다"))
                }
            }
            "search_knowledge_base" => {
                let query = params.get("query").and_then(|v| v.as_str()).unwrap_or("");
                let state = app.state::<AppState>();
                let rag_guard = state.rag.lock().map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?;
                if let Some(rag_arc) = rag_guard.as_ref() {
                    let rag = rag_arc.lock().map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?;
                    let results = rag.search(query, 3).map_err(|e| Error::protocol(ErrorCode::InternalError, e.to_string()))?;
                    let results_json = results.iter()
                        .map(|r| json!({ "text": r.text, "file": r.file_path, "page": r.page }))
                        .collect::<Vec<_>>();
                    Ok(serde_json::to_value(text_result(format!("{:?}", results_json)))?)
                } else {
                    Ok(serde_json::to_value(text_result("success: No results (RAG not initialized)".to_string()))?)
                }
            }
            "tools/list" => {
                let tools = vec![
                    Tool {
                        name: "read_hwp_table".to_string(),
                        description: "활성화된 HWP 문서 내의 모든 표 데이터를 읽어옵니다.".to_string(),
                        input_schema: None,
                        annotations: None,
                    },
                    Tool {
                        name: "create_hwp_table".to_string(),
                        description: "HWP 문서에 표를 생성합니다. (args: para, char_offset, rows, cols, data)".to_string(),
                        input_schema: None,
                        annotations: None,
                    },
                    Tool {
                        name: "apply_standard_style".to_string(),
                        description: "성동구 표준 서식을 문서에 적용합니다.".to_string(),
                        input_schema: None,
                        annotations: None,
                    },
                    Tool {
                        name: "read_external_file".to_string(),
                        description: "로컬 경로의 파일(HWP, Excel, PDF, TXT)의 전체 내용을 읽어옵니다.".to_string(),
                        input_schema: None,
                        annotations: None,
                    },
                    Tool {
                        name: "search_knowledge_base".to_string(),
                        description: "로컬 지식 베이스(RAG)에서 관련 문서를 검색합니다.".to_string(),
                        input_schema: None,
                        annotations: None,
                    },
                ];
                Ok(json!({ "tools": tools }))
            }
            _ => Err(Error::protocol(ErrorCode::MethodNotFound, format!("Unknown method: {}", method))),
        }
    }
}

pub fn spawn_mcp_server(app_handle: AppHandle) {
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::watch::channel(false);

    // 셧다운 송신자를 AppState에 보관
    if let Ok(mut guard) = app_handle.state::<crate::state::AppState>().mcp_shutdown.lock() {
        *guard = Some(shutdown_tx);
    }

    tauri::async_runtime::spawn(async move {
        use tokio::io::{stdin, stdout, AsyncBufReadExt, AsyncWriteExt, BufReader};

        let (stdin_tx, stdin_rx) = tokio::sync::mpsc::channel::<String>(256);
        let (stdout_tx, mut stdout_rx) = tokio::sync::mpsc::channel::<String>(256);

        let transport = Arc::new(StdioTransport::new(stdin_rx, stdout_tx));
        let handler = Arc::new(HopMcpHandler { app_handle });

        let server = Server::new(transport, handler);

        // Pipe stdin -> stdin_tx
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stdin());
            let mut line = String::new();
            while let Ok(n) = reader.read_line(&mut line).await {
                if n == 0 { break; }
                if stdin_tx.send(line.clone()).await.is_err() { break; }
                line.clear();
            }
        });

        // Pipe stdout_rx -> stdout
        tauri::async_runtime::spawn(async move {
            let mut writer = stdout();
            while let Some(msg) = stdout_rx.recv().await {
                if writer.write_all(msg.as_bytes()).await.is_err() { break; }
                if writer.write_all(b"\n").await.is_err() { break; }
                if writer.flush().await.is_err() { break; }
            }
        });

        // shutdown_rx 변경 또는 server 완료 중 먼저 오는 쪽에서 종료
        tokio::select! {
            _ = shutdown_rx.changed() => {
                eprintln!("[MCP] 셧다운 시그널 수신 — 서버 종료");
            }
            result = server.start() => {
                if let Err(e) = result {
                    eprintln!("[MCP] 서버 오류: {}", e);
                }
            }
        }
    });
}
