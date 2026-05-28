use anyhow::{Result, anyhow};
use std::path::Path;
use ocrs::{OcrEngine, OcrEngineParams};
use rten::Model;

pub struct LocalOcr {
    engine: OcrEngine,
}

impl LocalOcr {
    pub fn load() -> Result<Self> {
        // 실제 환경에서는 앱의 resource_dir에서 모델을 로드합니다.
        // 여기서는 예시 경로를 사용하거나, 에러 처리를 통해 모델 부재 시 안내합니다.
        let det_model_path = "assets/models/ocr/text-detection.rten";
        let rec_model_path = "assets/models/ocr/text-recognition.rten";
        
        if !Path::new(det_model_path).exists() || !Path::new(rec_model_path).exists() {
            return Err(anyhow!("OCR 모델 파일을 찾을 수 없습니다. (assets/models/ocr/ 경로 확인 필요)"));
        }

        let det_model = Model::load_file(det_model_path)?;
        let rec_model = Model::load_file(rec_model_path)?;

        let params = OcrEngineParams {
            detection_model: Some(det_model),
            recognition_model: Some(rec_model),
            ..Default::default()
        };

        Ok(Self {
            engine: OcrEngine::new(params)?,
        })
    }

    pub fn extract_text(&self, image_path: &Path) -> Result<String> {
        let img = image::open(image_path)?.into_rgb8();
        let (width, height) = img.dimensions();
        let layout = ocrs::ImageSource::from_bytes(img.as_raw(), [width, height])?;
        
        let ocr_input = self.engine.prepare_input(layout)?;
        let words = self.engine.get_words(&ocr_input)?;
        
        let mut full_text = String::new();
        for word in words {
            full_text.push_str(&word.to_string());
            full_text.push(' ');
        }

        Ok(full_text.trim().to_string())
    }
}
