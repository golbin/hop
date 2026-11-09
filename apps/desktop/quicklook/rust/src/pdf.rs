use base64::Engine;
use hop_rhwp_adapter::searchable_pdf_from_svg_pages;

pub(crate) fn png_pages_to_pdf(pages: Vec<PngPage>) -> Result<Vec<u8>, String> {
    let svg_pages = pages
        .into_iter()
        .map(PngPage::into_svg)
        .collect::<Result<Vec<_>, _>>()?;
    searchable_pdf_from_svg_pages(&svg_pages, Vec::new())
}

pub(crate) struct PngPage {
    pub png: Vec<u8>,
    pub width: f64,
    pub height: f64,
}

impl PngPage {
    fn into_svg(self) -> Result<String, String> {
        if self.png.is_empty() || self.width <= 0.0 || self.height <= 0.0 {
            return Err("invalid png page".to_string());
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(&self.png);
        Ok(format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><image width="{width}" height="{height}" href="data:image/png;base64,{encoded}"/></svg>"#,
            width = self.width,
            height = self.height,
        ))
    }
}
