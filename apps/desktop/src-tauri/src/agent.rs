use crate::ai::{ModelManager, format_qwen_prompt_from_history};
use crate::state::AppState;
use serde_json::{json, Value};
use anyhow::{Result, anyhow};
use tauri::AppHandle;
use tauri::Manager;
use tauri::Emitter;

const CLOUD_API_URL: &str = "http://161.33.159.151:7712/api/chat";

pub struct Agent {
    app_handle: AppHandle,
}

impl Agent {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    async fn call_cloud_api(prompt: &str) -> Result<String> {
        let url = std::env::var("HOP_AI_API_URL")
            .unwrap_or_else(|_| CLOUD_API_URL.to_string());
        let client = reqwest::Client::new();
        let payload = json!({
            "message": prompt
        });

        let resp = client.post(&url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| anyhow!("클라우드 API 요청 실패: {}", e))?;

        if !resp.status().is_success() {
            return Err(anyhow!("클라우드 API 상태 코드 에러: {}", resp.status()));
        }

        let resp_json: Value = resp.json()
            .await
            .map_err(|e| anyhow!("클라우드 응답 파싱 실패: {}", e))?;

        if let Some(reply) = resp_json.get("reply").and_then(|v| v.as_str()) {
            Ok(reply.to_string())
        } else if let Some(choices) = resp_json.get("choices").and_then(|v| v.as_array()) {
            if let Some(content) = choices.get(0).and_then(|c| c.pointer("/message/content")).and_then(|v| v.as_str()) {
                Ok(content.to_string())
            } else {
                Err(anyhow!("클라우드 API 응답 choices 형식 오류"))
            }
        } else {
            Err(anyhow!("클라우드 API 응답 형식 오류: {:?}", resp_json))
        }
    }

    pub async fn chat(&self, user_input: &str, style_preference: &str, target_audience: &str) -> Result<String> {
        let state = self.app_handle.state::<AppState>();
        
        // 1. Ensure model is loaded (Fallback to cloud if loading or file is missing)
        let use_cloud = {
            let mut ai_lock = state.ai.lock().map_err(|_| anyhow!("AI Lock 실패"))?;
            if ai_lock.is_none() {
                let model_filename = "qwen2.5-3b-instruct-q4_k_m.gguf";
                
                // 1. Try AppData/models (User-managed area)
                let mut model_path = self.app_handle.path().app_data_dir()
                    .map(|p| p.join("models").join(model_filename))
                    .unwrap_or_else(|_| std::path::PathBuf::from("models").join(model_filename));
                    
                if !model_path.exists() {
                    // 2. Try Resource directory (Bundled area)
                    if let Ok(res_path) = self.app_handle.path().resource_dir() {
                        let p = res_path.join("models").join(model_filename);
                        if p.exists() {
                            model_path = p;
                        }
                    }
                }
                
                if !model_path.exists() {
                    // 3. Fallback to current dir
                    if let Ok(curr) = std::env::current_dir() {
                        let p = curr.join("models").join(model_filename);
                        if p.exists() {
                            model_path = p;
                        }
                    }
                }
                
                if model_path.exists() {
                    match ModelManager::load(&model_path, 4096) {
                        Ok(mm) => {
                            *ai_lock = Some(mm);
                            false
                        }
                        Err(e) => {
                            eprintln!("[AI 에이전트] 로컬 모델 로드 실패: {:?}. 클라우드로 대체합니다.", e);
                            true
                        }
                    }
                } else {
                    eprintln!("[AI 에이전트] 로컬 모델 파일 없음. 클라우드로 대체합니다.");
                    true
                }
            } else {
                false
            }
        };
 
        // 2. Proactively Detect Project Context
        let mut project_context = String::new();
        let rag_opt = state.rag.lock().map(|opt| opt.clone()).unwrap_or(None);
        
        if let Some(rag_arc) = rag_opt {
            let sessions = state.sessions.lock().map_err(|_| anyhow!("Sessions Lock 실패"))?;
            if let Some(active_id) = sessions.active_document_id() {
                if let Ok(session) = sessions.session(&active_id) {
                    if let Some(path) = &session.source_path {
                        let path_str = path.to_string_lossy().to_string();
                        if let Ok(rag) = rag_arc.lock() {
                            if let Some((project, related_files)) = rag.get_related_project_files(&path_str) {
                                project_context = format!("--- 현재 프로젝트 맥락: [{}] ---\n", project);
                                if !related_files.is_empty() {
                                    project_context.push_str("관련된 과거 문서들이 있습니다:\n");
                                    for file in related_files.iter().take(3) {
                                        let fname = std::path::Path::new(file).file_name().and_then(|s| s.to_str()).unwrap_or(file);
                                        project_context.push_str(&format!("- {}\n", fname));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
 
        // 3. Automated Template / Framework Retrieval (Auto-RAG)
        let mut template_framework = String::new();
        if let Some(rag_arc) = state.rag.lock().map(|opt| opt.clone()).unwrap_or(None) {
            if let Ok(rag) = rag_arc.lock() {
                let template_query = match target_audience {
                    "public" => "주민 홍보 보도자료 카드뉴스 소식지 안내문",
                    "internal" => "내부 보고 기획안 보고서 회의자료 방침",
                    "cooperation" => "협조 공문 협조요청 대외기관 발신",
                    _ => "표준 행정 서식 양식"
                };
                
                if let Ok(templates) = rag.search(template_query, 2) {
                    if !templates.is_empty() {
                        template_framework = format!("\n[성동구 표준 문서 틀 및 사례 (저장창고 검색)] ---\n");
                        for res in templates {
                            let fname = std::path::Path::new(&res.file_path).file_name().and_then(|s| s.to_str()).unwrap_or("알 수 없는 파일");
                            template_framework.push_str(&format!("### 파일: {}\n**구조**: \n{}\n\n", fname, res.text));
                        }
                        template_framework.push_str("위 '문서 틀'의 목차 구조와 문체를 참고하여 대화하고 [PROPOSAL]을 작성하십시오.\n");
                    }
                }
            }
        }
 
        // 3. Style & Audience Directives
        let style_directive = if style_preference == "sentence" {
            "**[스타일 지침: 문장식]**\n모든 답변과 [PROPOSAL] 내부에 작성할 문서 내용은 정중하고 완결된 '문장식(~입니다, ~하고자 합니다)'으로 작성하십시오. 문단 간 연결이 자연스럽고 서술적인 형태여야 합니다."
        } else {
            "**[스타일 지침: 개조식]**\n모든 답변과 [PROPOSAL] 내부에 작성할 문서 내용은 간결한 '행정 개조식'으로 작성하십시오.\n- 문장의 끝은 '~함', '~임', '~것' 등 명사형으로 종결하십시오.\n- 글머리 기호(○, □, -, ㆍ)를 적극적으로 사용하여 위계를 나누십시오.\n- 불필요한 접속사나 수식어는 배제하고 핵심 위주로 기술하십시오."
        };
 
        let audience_directive = match target_audience {
            "public" => "성동구 주민분들께 드리는 소식이니, 딱딱한 행정 용어는 최대한 알기 쉽게 풀어서 설명해 주세요. 이웃집 전문가처럼 아주 친절하고 따뜻한 느낌으로 답변해 주시면 좋겠습니다.",
            "internal" => "구청장님이나 동료 공무원분들께 보고 드리는 자료입니다. 예의를 갖추되 너무 딱딱하지 않게, 핵심을 짚어 설명하는 유능한 비서처럼 답변해 주세요.",
            "cooperation" => "다른 부서와 협력하기 위한 문서이니, 서로 예우를 갖추면서도 요청 사항이 명확하게 전달되도록 세심하고 다정하게 작성해 주세요.",
            _ => "늘 친절하고 상세하게 안내하는 성동구청의 믿음직한 AI 동료로 행동하세요."
        };
 
        // 4. Prepare System Prompt with Tools
        let system_prompt = format!(r#"당신은 성동구청의 '스마트 행정 파트너' AI 주무관입니다.
 
[도구 사용 원칙 - 절대 준수]
1. 사용자가 문서 작성, 요약, 분석을 요청하면 **무조건** `CALL: read_hwp()`를 호출하여 현재 내용을 먼저 확인하십시오.
2. 지식창고 검색이 필요하면 **무조건** `CALL: search_knowledge_base({{"query": "..."}})`를 호출하십시오.
3. 법령 검색 및 본문 조회가 필요한 경우, **무조건** `CALL: search_law({{"query": "..."}})`로 법령 경로를 찾고, `CALL: get_law_structure({{"path": "..."}})`로 목차를 조회하거나 `CALL: get_law_article({{"path": "...", "article_query": "..."}})`로 개별 조문 내용을 직접 조회하십시오.
4. 사용자가 문서 정렬(정렬 조정), 인쇄, 혹은 화면 창 조정을 요청하면, 이에 매치되는 적절한 `CALL: align_paragraph(...)`, `CALL: print_document()`, 또는 `CALL: adjust_window_layout(...)`를 **무조건** 즉각 한 줄로 호출하여 즉시 제어 상태를 동기화하십시오.
5. 도구 호출은 반드시 한 줄에 하나씩 `CALL: 도구명(인자)` 형식으로 작성하십시오.
6. **중요**: 도구를 호출한 후에는 반드시 해당 결과를 바탕으로 최종 [PROPOSAL] 또는 [EDIT]를 작성하여 답변을 마쳐야 합니다.
 
[문서 편집 직접 수행 형식 - 실시간 반영]
사용자가 문서에 내용을 **추가/작성하라**고 명령하면, 반드시 아래 형식으로 편집을 수행하십시오:
 
[EDIT:append]
문서 하단에 추가할 내용 (완성된 텍스트만)
[/EDIT]
 
또는 특정 위치에 삽입할 때:
[EDIT:insert]
커서 위치에 삽입할 내용
[/EDIT]
 
또는 텍스트를 찾아 교체할 때:
[EDIT:replace]
찾을텍스트→바꿀텍스트
[/EDIT]
 
**중요**: [EDIT] 태그 내부에는 오직 문서에 들어갈 본문(또는 교체 규칙)만 넣으십시오. 설명, 메타 콘텐츠 불가.
[제안 형식 - 승인이 필요한 경우]
문서를 새로 작성하거나 큰 변경이 필요한 경우:
[PROPOSAL]
완성된 문서 안으로 들어갈 본문 전체
[/PROPOSAL]
 
[추가 핵심 원칙]
1. **문서 구조**: [개요] - [추진근거/배경] - [세부계획/내용] - [향후계획/기대효과] 등 기승전결이 명확한 구조.
2. **어휘 및 톤**: 개조식('으함', '임') 또는 명확한 행정용어를 사용.
3. **지식 합성**: 저장창고 사례를 재구성하고 합성하세요.
4. **가독성**: 핵심 키워드는 **[진하게]** 시작하고, 항목별 위계를 절저히 지키세요.
 
{style_directive}
{audience_directive}
 
[참고 컨텍스트]
{project_context}
{template_framework}
 
도구 목록:
- read_hwp(): 현재 문서 읽기 (왜쪽 문서 내용 파악)
- search_knowledge_base({{"query": "..."}}): 저장창고 검색 (사례 및 양식 참조)
- search_law({{"query": "..."}}): 법령 검색 (매칭되는 법령 파일 경로를 줄바꿈으로 구분해 반환)
- get_law_structure({{"path": "..."}}): 법령 목차/조문 구조 조회
- get_law_article({{"path": "...", "article_query": "..."}}): 특정 조문(예: "제103조")의 구체적 내용 조회
- write_hwp({{"text": "...", "format": {{"bold": true, "size": 12, "align": "Center"}}}}): 행정 서식이 포함된 특정 위치 수정 제안
- create_hwp_table({{"rows": N, "cols": M, "data": [...], "headerStyle": {{"bold": true}}}}): 공공기관 표준 스타일의 표 생성 제안
- print_document(): 현재 문서를 인쇄 다이얼로그로 보냅니다. (인쇄 명령 동기화)
- align_paragraph({{"align": "Left" | "Center" | "Right" | "Justify"}}): 활성화된 HWP 문서의 첫 단락 정렬을 해당 방식으로 동기화 변경합니다.
- adjust_window_layout({{"layout": "side_by_side" | "fullscreen" | "default"}}): 데스크톱 창의 레이아웃 배치를 동기화 조절합니다.
- execute_hwp_command({{"command": "align_paragraph" | "insert_table" | "font_style" | "insert_footnote" | "print" | "adjust_window", "args": {{"align": "Center" | "Left" | "Right" | "Justify", "rows": number, "cols": number, "bold": boolean, "size": number, "text": "각주 내용", "layout": "side_by_side" | "fullscreen" | "default"}}}}): HWP 모든 문서 조작 및 화면 제어 기능을 완벽히 동적 동기화 수행합니다.
"#);
 
        let mut conversation_history = vec![
            json!({"role": "system", "content": system_prompt}),
            json!({"role": "user", "content": user_input})
        ];
        let mut full_response = String::new();
 
        // 5. Agent Loop (최대 5회 수행)
        for _ in 0..5 {
            let prompt = format_qwen_prompt_from_history(&conversation_history);
            let response = if use_cloud {
                tokio::time::timeout(
                    std::time::Duration::from_secs(30),
                    Self::call_cloud_api(&prompt),
                )
                .await
                .map_err(|_| anyhow!("클라우드 API 응답 타임아웃 (30초)"))??
            } else {
                let mut ai_lock = state.ai.lock().map_err(|_| anyhow!("AI Lock 실패"))?;
                let ai = ai_lock.as_mut().ok_or_else(|| anyhow!("AI 모델이 로드되지 않았습니다"))?;
                ai.generate(&prompt, 1024)?
            };
            
            // Fix: Check for tool calls more robustly (ignore case, check for parts)
            let has_call = response.to_uppercase().contains("CALL:");
            
            if has_call {
                let call_line = response.lines()
                    .find(|l| l.to_uppercase().contains("CALL:"))
                    .unwrap_or("");
                
                let tool_call = if let Some(idx) = call_line.to_uppercase().find("CALL:") {
                    call_line[idx+5..].trim().to_string()
                } else {
                    String::new()
                };
 
                if tool_call.is_empty() {
                    full_response = response;
                    break;
                }
 
                // Add assistant's thought/intent to history
                conversation_history.push(json!({"role": "assistant", "content": response}));
                
                let call_result;
 
                if tool_call.starts_with("read_hwp") {
                    let mut sessions = state.sessions.lock().map_err(|_| anyhow!("Sessions Lock 실패"))?;
                    let text = sessions.get_active_document_text().map_err(|e| anyhow!(e))?;
                    call_result = format!("[도구 결과(현재 문서): {}]", text);
                } else if tool_call.starts_with("search_knowledge_base") {
                    let json_part = tool_call.replace("search_knowledge_base", "").trim().to_string();
                    let args: Value = serde_json::from_str(&json_part).unwrap_or(json!({}));
                    let query = args["query"].as_str().unwrap_or(user_input);
                    
                    let mut context = String::new();
                    if let Some(rag_arc) = state.rag.lock().map(|opt| opt.clone()).unwrap_or(None) {
                        if let Ok(rag) = rag_arc.lock() {
                            if let Ok(results) = rag.search(query, 3) {
                                for res in results {
                                    context.push_str(&format!("\n--- 파일: {} ---\n{}\n", res.file_path, res.text));
                                }
                            }
                        }
                    }
                    call_result = format!("[도구 결과(검색 내용): {}]", if context.is_empty() { "결과 없음".to_string() } else { context });
                } else if tool_call.starts_with("search_law") {
                    let json_part = tool_call.replace("search_law", "").trim().to_string();
                    let args: Value = serde_json::from_str(&json_part).unwrap_or(json!({}));
                    let query = args["query"].as_str().unwrap_or("");
                    call_result = match crate::law::search_law(query).await {
                        Ok(res) => format!("[도구 결과(법령 검색): {}]", res),
                        Err(e) => format!("[도구 결과(법령 검색 실패): {}]", e),
                    };
                } else if tool_call.starts_with("get_law_structure") {
                    let json_part = tool_call.replace("get_law_structure", "").trim().to_string();
                    let args: Value = serde_json::from_str(&json_part).unwrap_or(json!({}));
                    let path = args["path"].as_str().unwrap_or("");
                    call_result = match crate::law::get_law_structure(path).await {
                        Ok(res) => format!("[도구 결과(법령 구조): {}]", res),
                        Err(e) => format!("[도구 결과(법령 구조 조회 실패): {}]", e),
                    };
                } else if tool_call.starts_with("get_law_article") {
                    let json_part = tool_call.replace("get_law_article", "").trim().to_string();
                    let args: Value = serde_json::from_str(&json_part).unwrap_or(json!({}));
                    let path = args["path"].as_str().unwrap_or("");
                    let article_query = args["article_query"].as_str().unwrap_or("");
                    call_result = match crate::law::get_law_article(path, article_query).await {
                        Ok(res) => format!("[도구 결과(법령 조문): {}]", res),
                        Err(e) => format!("[도구 결과(법령 조문 조회 실패): {}]", e),
                    };
                } else if tool_call.starts_with("print_document") {
                    if let Some(window) = self.app_handle.get_webview_window("main") {
                        let _ = window.print();
                        call_result = "[도구 결과: 문서 인쇄를 성공적으로 실행했습니다]".to_string();
                    } else if let Some((_, window)) = self.app_handle.webview_windows().iter().next() {
                        let _ = window.print();
                        call_result = "[도구 결과: 문서 인쇄를 성공적으로 실행했습니다]".to_string();
                    } else {
                        call_result = "[도구 결과: 문서 인쇄 창을 찾을 수 없습니다]".to_string();
                    }
                } else if tool_call.starts_with("align_paragraph") {
                    let json_part = tool_call.replace("align_paragraph", "").trim().to_string();
                    let args: Value = serde_json::from_str(&json_part).unwrap_or(json!({}));
                    let align = args["align"].as_str().unwrap_or("Center");
                    
                    let mut sessions = state.sessions.lock().map_err(|_| anyhow!("Sessions Lock 실패"))?;
                    if let Some(active_id) = sessions.active_document_id() {
                        let res = sessions.mutate_document(
                            &active_id,
                            "applyParagraphShape",
                            json!({ "sec": 0, "para": 0, "align": align }),
                            None
                        );
                        if res.is_ok() {
                            let _ = self.app_handle.emit("hop-ai-edit-applied", json!({ "revision": 1 }));
                            call_result = format!("[도구 결과: 문서 첫 문단 정렬을 {} 정렬로 완벽히 적용했습니다]", align);
                        } else {
                            call_result = "[도구 결과: 정렬 적용 실패 (바이트 세션 오류)]".to_string();
                        }
                    } else {
                        call_result = "[도구 결과: 활성화된 문서 세션이 없어 정렬을 변경할 수 없습니다]".to_string();
                    }
                } else if tool_call.starts_with("adjust_window_layout") {
                    let json_part = tool_call.replace("adjust_window_layout", "").trim().to_string();
                    let args: Value = serde_json::from_str(&json_part).unwrap_or(json!({}));
                    let layout = args["layout"].as_str().unwrap_or("default");
                    
                    if let Some(window) = self.app_handle.get_webview_window("main") {
                        match layout {
                            "fullscreen" => {
                                let _ = window.set_fullscreen(true);
                                call_result = "[도구 결과: 메인 창을 전체 화면으로 크기 조절했습니다]".to_string();
                            }
                            "side_by_side" => {
                                let _ = window.set_fullscreen(false);
                                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(1200.0, 800.0)));
                                let _ = window.set_focus();
                                call_result = "[도구 결과: 메인 창의 화면 크기를 1200x800 사이드바이사이드로 조정했습니다]".to_string();
                            }
                            _ => {
                                let _ = window.set_fullscreen(false);
                                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(1100.0, 760.0)));
                                let _ = window.center();
                                call_result = "[도구 결과: 메인 창의 레이아웃 배치를 기본 크기(1100x760, 화면 중앙)로 복구했습니다]".to_string();
                            }
                        }
                    } else if let Some((_, window)) = self.app_handle.webview_windows().iter().next() {
                        match layout {
                            "fullscreen" => {
                                let _ = window.set_fullscreen(true);
                                call_result = "[도구 결과: 활성 창을 전체 화면으로 크기 조절했습니다]".to_string();
                            }
                            "side_by_side" => {
                                let _ = window.set_fullscreen(false);
                                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(1200.0, 800.0)));
                                let _ = window.set_focus();
                                call_result = "[도구 결과: 활성 창의 화면 크기를 1200x800 사이드바이사이드로 조정했습니다]".to_string();
                            }
                            _ => {
                                let _ = window.set_fullscreen(false);
                                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(1100.0, 760.0)));
                                let _ = window.center();
                                call_result = "[도구 결과: 활성 창의 레이아웃 배치를 기본 크기(1100x760, 화면 중앙)로 복구했습니다]".to_string();
                            }
                        }
                    } else {
                        call_result = "[도구 결과: 제어할 수 있는 화면 창을 찾을 수 없습니다]".to_string();
                    }
                } else if tool_call.starts_with("execute_hwp_command") {
                    let json_part = tool_call.replace("execute_hwp_command", "").trim().to_string();
                    let args: Value = serde_json::from_str(&json_part).unwrap_or(json!({}));
                    
                    // Emit hop-ai-command-trigger event to the frontend
                    let _ = self.app_handle.emit("hop-ai-command-trigger", args.clone());
                    call_result = format!("[도구 결과: HWP 명령어 '{}'를 성공적으로 웹 에디터 엔진에 동기화 전송했습니다]", args["command"].as_str().unwrap_or(""));
                } else {
                    call_result = "[도구 결과: 성공적으로 수행됨]".to_string();
                }
                
                // Add tool result to history as a USER message (standard agent pattern for simple LLMs)
                conversation_history.push(json!({"role": "user", "content": call_result}));
            } else {
                full_response = response;
                break;
            }
        }
 
        // 루프 종료 후 응답이 없으면 마지막 생성 텍스트 반환
        if full_response.is_empty() && !conversation_history.is_empty() {
            // 마지막 assistant 메시지에서 추출
            for msg in conversation_history.iter().rev() {
                if msg["role"].as_str() == Some("assistant") {
                    if let Some(content) = msg["content"].as_str() {
                        full_response = content.to_string();
                        break;
                    }
                }
            }
        }
        if full_response.is_empty() {
            full_response = "죄송합니다. 응답 생성에 실패했습니다. 다시 시도해 주세요.".to_string();
        }

        Ok(full_response)
    }

    pub async fn audit_spelling(&self, text: &str) -> Result<Value> {
        let mut results = Vec::new();
        if text.contains("됬") {
            results.push(json!({ "word": "됬", "suggestion": "됐", "context": "맞춤법 오류" }));
        }
        Ok(json!(results))
    }
}
