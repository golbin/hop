use anyhow::{anyhow, Result};
use candle_core::{Device, Tensor};
use candle_transformers::models::bert::{BertModel, Config};
use tokenizers::Tokenizer;
use std::path::Path;

pub struct EmbeddingEngine {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
}

impl EmbeddingEngine {
    pub fn load(model_dir: &Path) -> Result<Self> {
        let device = Device::Cpu; // 8GB RAM 환경에서는 CPU가 더 안정적일 수 있음

        let config_path = model_dir.join("config.json");
        let tokenizer_path = model_dir.join("tokenizer.json");
        let weights_path = model_dir.join("model.safetensors");

        let config_str = std::fs::read_to_string(config_path)?;
        let config: Config = serde_json::from_str(&config_str)?;
        
        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| anyhow!("Tokenization loading failed: {}", e))?;
        
        let vb = unsafe {
            candle_core::safetensors::MmapedSafetensors::new(weights_path)?
                .load(device.clone(), &candle_core::VarBuilder::from_mmaped_safetensors)?
        };

        let model = BertModel::load(vb, &config)?;

        Ok(Self {
            model,
            tokenizer,
            device,
        })
    }

    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        let tokens = self.tokenizer.encode(text, true)
            .map_err(|e| anyhow!("Encoding failed: {}", e))?;
        
        let token_ids = tokens.get_ids();
        let token_type_ids = tokens.get_type_ids();
        
        let token_ids_t = Tensor::new(token_ids, &self.device)?.unsqueeze(0)?;
        let token_type_ids_t = Tensor::new(token_type_ids, &self.device)?.unsqueeze(0)?;

        let embeddings = self.model.forward(&token_ids_t, &token_type_ids_t)?;
        
        // Use Mean Pooling (Sentence Transformers style)
        let (_n_batch, n_tokens, _hidden_size) = embeddings.dims3()?;
        let mean_embedding = (embeddings.sum(1)? / (n_tokens as f64))?;
        let vector = mean_embedding.flatten_all()?.to_vec1::<f32>()?;
        
        Ok(vector)
    }
}
