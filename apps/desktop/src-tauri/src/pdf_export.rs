use pdf_writer::{Finish, Pdf, Ref};
use rhwp::DocumentCore;
use std::collections::HashMap;
use std::path::Path;

use crate::commands::PageRange;
use crate::font_catalog;
use crate::state::atomic_write;

pub fn export_core_to_pdf(
    core: &DocumentCore,
    target_path: &Path,
    page_range: Option<PageRange>,
    mut on_progress: impl FnMut(&str, u32, u32, String),
) -> Result<u32, String> {
    ensure_pdf_path(target_path)?;
    on_progress("start", 0, 1, "PDF 내보내기를 시작합니다".to_string());

    let page_count = core.page_count();
    let pages = resolve_page_range(page_range, page_count)?;
    let total = pages.len() as u32;

    let mut svg_pages = Vec::with_capacity(pages.len());
    for (idx, page) in pages.iter().enumerate() {
        let svg = core
            .render_page_svg_native(*page)
            .map_err(|e| format!("페이지 {} 렌더링 실패: {}", page + 1, e))?;
        svg_pages.push(svg);
        on_progress(
            "render",
            idx as u32 + 1,
            total,
            format!("{} / {} 페이지 렌더링", idx + 1, total),
        );
    }

    let pdf_bytes = svgs_to_pdf(&svg_pages)?;
    atomic_write(target_path, &pdf_bytes)?;
    on_progress("write", total, total, "PDF 파일을 저장했습니다".to_string());

    Ok(total)
}

pub(crate) fn ensure_pdf_path(path: &Path) -> Result<(), String> {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        != Some(true)
    {
        return Err("PDF 파일 경로는 .pdf 확장자여야 합니다".to_string());
    }
    Ok(())
}

fn resolve_page_range(page_range: Option<PageRange>, page_count: u32) -> Result<Vec<u32>, String> {
    if page_count == 0 {
        return Err("내보낼 페이지가 없습니다".to_string());
    }
    let Some(range) = page_range else {
        return Ok((0..page_count).collect());
    };
    let start = range.start.unwrap_or(0);
    let end = range.end.unwrap_or(page_count - 1);
    if start > end || end >= page_count {
        return Err(format!(
            "페이지 범위가 올바르지 않습니다: {}..{} / 총 {}페이지",
            start + 1,
            end + 1,
            page_count
        ));
    }
    Ok((start..=end).collect())
}

fn add_font_fallbacks(svg: &str) -> String {
    svg.replace(
        "font-family=\"휴먼명조\"",
        "font-family=\"휴먼명조, 바탕, AppleMyungjo, serif\"",
    )
    .replace(
        "font-family=\"HCI Poppy\"",
        "font-family=\"HCI Poppy, 맑은 고딕, Apple SD Gothic Neo, sans-serif\"",
    )
    .replace(
        "font-family=\"바탕체,",
        "font-family=\"바탕체, 바탕, AppleMyungjo, ",
    )
    .replace(
        "font-family=\"굴림체,",
        "font-family=\"굴림체, 굴림, 맑은 고딕, Apple SD Gothic Neo, ",
    )
}

fn conversion_options() -> svg2pdf::ConversionOptions {
    svg2pdf::ConversionOptions {
        embed_text: false,
        ..svg2pdf::ConversionOptions::default()
    }
}

fn pdf_usvg_options() -> usvg::Options<'static> {
    usvg::Options {
        fontdb: std::sync::Arc::new(font_catalog::create_pdf_font_database()),
        ..Default::default()
    }
}

fn parse_svg_tree_for_pdf(
    svg_content: &str,
    options: &usvg::Options<'static>,
) -> Result<usvg::Tree, String> {
    let svg_with_fallback = add_font_fallbacks(svg_content);
    usvg::Tree::from_str(&svg_with_fallback, options).map_err(|e| format!("SVG 파싱 실패: {}", e))
}

fn svg_to_pdf(svg_content: &str) -> Result<Vec<u8>, String> {
    let options = pdf_usvg_options();
    let tree = parse_svg_tree_for_pdf(svg_content, &options)?;
    svg2pdf::to_pdf(&tree, conversion_options(), svg2pdf::PageOptions::default())
        .map_err(|e| format!("PDF 변환 실패: {:?}", e))
}

fn svgs_to_pdf(svg_pages: &[String]) -> Result<Vec<u8>, String> {
    if svg_pages.is_empty() {
        return Err("페이지가 없습니다".to_string());
    }
    if svg_pages.len() == 1 {
        return svg_to_pdf(&svg_pages[0]);
    }

    let options = pdf_usvg_options();

    let mut alloc = Ref::new(1);
    let catalog_ref = alloc.bump();
    let page_tree_ref = alloc.bump();

    struct PageData {
        chunk: pdf_writer::Chunk,
        svg_ref: Ref,
        width: f32,
        height: f32,
    }

    let mut page_datas: Vec<PageData> = Vec::new();

    for svg in svg_pages {
        let tree = parse_svg_tree_for_pdf(svg, &options)?;

        let (chunk, svg_ref) = svg2pdf::to_chunk(&tree, conversion_options())
            .map_err(|e| format!("SVG->chunk 변환 실패: {:?}", e))?;

        let dpi_ratio = 72.0 / 96.0;
        let w = tree.size().width() * dpi_ratio;
        let h = tree.size().height() * dpi_ratio;

        page_datas.push(PageData {
            chunk,
            svg_ref,
            width: w,
            height: h,
        });
    }

    let mut page_refs: Vec<Ref> = Vec::new();
    let mut renumbered_chunks: Vec<pdf_writer::Chunk> = Vec::new();
    let mut svg_refs_remapped: Vec<Ref> = Vec::new();

    for pd in &page_datas {
        let page_ref = alloc.bump();
        page_refs.push(page_ref);

        let mut map = HashMap::new();
        let renumbered = pd
            .chunk
            .renumber(|old| *map.entry(old).or_insert_with(|| alloc.bump()));

        let remapped_svg_ref = map.get(&pd.svg_ref).copied().unwrap_or(pd.svg_ref);
        svg_refs_remapped.push(remapped_svg_ref);
        renumbered_chunks.push(renumbered);
    }

    let mut pdf = Pdf::new();
    pdf.catalog(catalog_ref).pages(page_tree_ref);
    pdf.pages(page_tree_ref)
        .count(page_refs.len() as i32)
        .kids(page_refs.iter().copied());

    let svg_name = pdf_writer::Name(b"S1");

    for (i, pd) in page_datas.iter().enumerate() {
        let page_ref = page_refs[i];
        let content_ref = alloc.bump();
        let svg_ref = svg_refs_remapped[i];

        let mut page = pdf.page(page_ref);
        page.media_box(pdf_writer::Rect::new(0.0, 0.0, pd.width, pd.height));
        page.parent(page_tree_ref);
        page.contents(content_ref);

        let mut resources = page.resources();
        resources.x_objects().pair(svg_name, svg_ref);
        resources.finish();
        page.finish();

        let mut content = pdf_writer::Content::new();
        content.transform([pd.width, 0.0, 0.0, pd.height, 0.0, 0.0]);
        content.x_object(svg_name);

        pdf.stream(content_ref, &content.finish());
    }

    for chunk in &renumbered_chunks {
        pdf.extend(chunk);
    }

    let info_ref = alloc.bump();
    pdf.document_info(info_ref)
        .producer(pdf_writer::TextStr("hop-desktop"));

    Ok(pdf.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_pdf_path_accepts_pdf_case_insensitively() {
        assert!(ensure_pdf_path(Path::new("out.pdf")).is_ok());
        assert!(ensure_pdf_path(Path::new("out.PDF")).is_ok());
    }

    #[test]
    fn ensure_pdf_path_rejects_non_pdf_paths() {
        assert_eq!(
            ensure_pdf_path(Path::new("out.hwp")).unwrap_err(),
            "PDF 파일 경로는 .pdf 확장자여야 합니다"
        );
        assert!(ensure_pdf_path(Path::new("out")).is_err());
    }

    #[test]
    fn resolve_page_range_defaults_to_all_pages() {
        assert_eq!(resolve_page_range(None, 3).unwrap(), vec![0, 1, 2]);
    }

    #[test]
    fn resolve_page_range_supports_open_ended_ranges() {
        assert_eq!(
            resolve_page_range(
                Some(PageRange {
                    start: Some(1),
                    end: None,
                }),
                4,
            )
            .unwrap(),
            vec![1, 2, 3]
        );
        assert_eq!(
            resolve_page_range(
                Some(PageRange {
                    start: None,
                    end: Some(1),
                }),
                4,
            )
            .unwrap(),
            vec![0, 1]
        );
    }

    #[test]
    fn resolve_page_range_rejects_empty_and_invalid_ranges() {
        assert_eq!(
            resolve_page_range(None, 0).unwrap_err(),
            "내보낼 페이지가 없습니다"
        );
        assert!(resolve_page_range(
            Some(PageRange {
                start: Some(2),
                end: Some(1),
            }),
            4,
        )
        .unwrap_err()
        .contains("페이지 범위가 올바르지 않습니다"));
        assert!(resolve_page_range(
            Some(PageRange {
                start: Some(0),
                end: Some(4),
            }),
            4,
        )
        .unwrap_err()
        .contains("총 4페이지"));
    }

    #[test]
    fn svgs_to_pdf_rejects_empty_pages() {
        assert_eq!(svgs_to_pdf(&[]).unwrap_err(), "페이지가 없습니다");
    }
}
