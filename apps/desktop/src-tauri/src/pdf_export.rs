use hop_rhwp_adapter::{searchable_pdf_from_svg_pages, DocumentCore};
use std::path::{Path, PathBuf};

use crate::commands::PageRange;
use crate::pdf_font_fallbacks::add_font_fallbacks;
use crate::state::atomic_write;

pub fn export_core_to_pdf(
    core: &DocumentCore,
    target_path: &Path,
    page_range: Option<PageRange>,
    font_dirs: Vec<PathBuf>,
    mut on_progress: impl FnMut(&str, u32, u32, String),
) -> Result<u32, String> {
    ensure_pdf_path(target_path)?;
    on_progress("start", 0, 1, crate::ui_text::text("pdf.start").to_string());

    let page_count = core.page_count();
    let pages = resolve_page_range(page_range, page_count)?;
    let total = pages.len() as u32;

    let mut svg_pages = Vec::with_capacity(pages.len());
    for (idx, page) in pages.iter().enumerate() {
        let svg = core
            .render_page_svg_native(*page)
            .map_err(|e| crate::ui_text::text_with("pdf.pageRenderFailed", &[&(page + 1), &e]))?;
        svg_pages.push(add_font_fallbacks(&svg));
        on_progress(
            "render",
            idx as u32 + 1,
            total,
            crate::ui_text::text_with("pdf.pageProgress", &[&(idx + 1), &total]),
        );
    }

    let pdf_bytes = searchable_pdf_from_svg_pages(&svg_pages, font_dirs)?;
    atomic_write(target_path, &pdf_bytes)?;
    on_progress("write", total, total, crate::ui_text::text("pdf.written").to_string());

    Ok(total)
}

pub(crate) fn ensure_pdf_path(path: &Path) -> Result<(), String> {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        != Some(true)
    {
        return Err(crate::ui_text::text("pdf.extensionRequired").to_string());
    }
    Ok(())
}

fn resolve_page_range(page_range: Option<PageRange>, page_count: u32) -> Result<Vec<u32>, String> {
    if page_count == 0 {
        return Err(crate::ui_text::text("pdf.noPages").to_string());
    }
    let Some(range) = page_range else {
        return Ok((0..page_count).collect());
    };
    let start = range.start.unwrap_or(0);
    let end = range.end.unwrap_or(page_count - 1);
    if start > end || end >= page_count {
        return Err(crate::ui_text::text_with("pdf.invalidRange", &[&(start + 1), &(end + 1), &page_count]));
    }
    Ok((start..=end).collect())
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
    fn searchable_pdf_contains_a_unicode_text_map() {
        let font_dir =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../third_party/rhwp/ttfs/opensource");
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120">
          <text x="16" y="64" font-family="Noto Sans KR" font-size="24">검색 가능한 PDF</text>
        </svg>"#;

        let pdf = searchable_pdf_from_svg_pages(&[svg.to_string()], vec![font_dir]).unwrap();

        assert!(pdf
            .windows(b"/ToUnicode".len())
            .any(|bytes| bytes == b"/ToUnicode"));
    }
}
