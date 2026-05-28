use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::model::params::LlamaModelParams;
#[allow(deprecated)]
use llama_cpp_2::model::{LlamaModel, Special};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_batch::LlamaBatch;
#[allow(unused_imports)]
use llama_cpp_2::token::LlamaToken;
use std::num::NonZeroU32;
use std::path::Path;
use anyhow::{Result, anyhow};
use std::sync::Arc;

pub struct ModelManager {
    backend: Arc<LlamaBackend>,
    model: LlamaModel,
}

// LlamaBackend and LlamaModel are internally thread-safe when accessed through a Mutex.
unsafe impl Send for ModelManager {}
unsafe impl Sync for ModelManager {}

impl ModelManager {
    pub fn load(model_path: &Path, _context_size: u32) -> Result<Self> {
        let backend = LlamaBackend::init()?;
        let backend = Arc::new(backend);

        // 8GB RAM 환경 최적화: mmap 활성화(OS가 메모리 관리), mlock 비활성화
        let model_params = LlamaModelParams::default();

        let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
            .map_err(|e| anyhow!(
                "AI 모델 로드 실패 (파일 경로: {}). 파일이 누락되었거나 형식이 유효하지 않습니다. 오류: {:?}", 
                model_path.display(), 
                e
            ))?;

        Ok(Self { backend, model })
    }

    pub fn generate(&self, prompt: &str, max_tokens: usize) -> Result<String> {
        let physical_cores = num_cpus::get_physical() as i32;

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(2048))
            .with_n_threads(physical_cores)
            .with_n_threads_batch(physical_cores);

        let mut ctx = self.model.new_context(&self.backend, ctx_params)
            .map_err(|e| anyhow!("컨텍스트 생성 실패: {:?}", e))?;

        // Tokenise prompt
        let tokens_list = self.model
            .str_to_token(prompt, llama_cpp_2::model::AddBos::Always)
            .map_err(|e| anyhow!("토큰화 실패: {:?}", e))?;

        let n_len = tokens_list.len();
        let mut batch = LlamaBatch::new(2048, 1);

        for (i, &token) in tokens_list.iter().enumerate() {
            batch.add(token, i as i32, &[0], i == n_len - 1)
                .map_err(|e| anyhow!("배치 추가 실패: {:?}", e))?;
        }

        ctx.decode(&mut batch)
            .map_err(|e| anyhow!("디코딩 실패: {:?}", e))?;

        let mut n_cur = n_len as i32;
        let mut response = String::new();

        loop {
            if n_cur as usize >= n_len + max_tokens {
                break;
            }

            let mut candidates = ctx.token_data_array_ith(batch.n_tokens() - 1);
            let token = candidates.sample_token_greedy();

            if self.model.is_eog_token(token) {
                break;
            }

            #[allow(deprecated)]
            let piece = self.model.token_to_str(token, Special::Plaintext)
                .map_err(|e| anyhow!("토큰 변환 실패: {:?}", e))?;
            response.push_str(&piece);

            batch.clear();
            batch.add(token, n_cur, &[0], true)
                .map_err(|e| anyhow!("배치 추가 실패: {:?}", e))?;

            ctx.decode(&mut batch)
                .map_err(|e| anyhow!("디코딩 실패: {:?}", e))?;

            n_cur += 1;
        }

        Ok(response)
    }

    #[allow(dead_code)]
    pub fn model_name(&self) -> &str {
        "local-llama"
    }
}

#[allow(dead_code)]
pub fn format_qwen_prompt(system: &str, user: &str) -> String {
    format!(
        "<|im_start|>system\n{}<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n",
        system, user
    )
}

pub fn format_qwen_prompt_from_history(history: &[serde_json::Value]) -> String {
    let mut prompt = String::new();
    for msg in history {
        let role = msg["role"].as_str().unwrap_or("user");
        let content = msg["content"].as_str().unwrap_or("");
        prompt.push_str(&format!("<|im_start|>{}\n{}<|im_end|>\n", role, content));
    }
    prompt.push_str("<|im_start|>assistant\n");
    prompt
}
