use super::*;

#[test]
fn rejects_empty_preview_input() {
    let result = hop_ql_render_preview_pdf(ptr::null(), 0);
    assert_eq!(result.status, HOP_QL_INVALID_INPUT);
    assert!(result.bytes.ptr.is_null());
}

#[test]
fn rejects_non_document_preview_input() {
    let data = b"not a hwp document";
    let result = hop_ql_render_preview_pdf(data.as_ptr(), data.len());
    assert_eq!(result.status, HOP_QL_PARSE_FAILED);
    assert!(result.bytes.ptr.is_null());
}

#[test]
fn reports_missing_embedded_thumbnail() {
    let data = b"not a hwp document";
    let result = hop_ql_extract_embedded_thumbnail(data.as_ptr(), data.len());
    assert_eq!(result.status, HOP_QL_NO_THUMBNAIL);
    assert!(result.bytes.ptr.is_null());
}

#[test]
fn free_accepts_null() {
    unsafe {
        hop_ql_free_bytes(ptr::null_mut(), 0);
    }
}

#[test]
fn renders_sample_preview_pdf() {
    let data = std::fs::read(sample_path()).expect("sample hwp");
    let result = hop_ql_render_preview_pdf(data.as_ptr(), data.len());
    assert_eq!(result.status, HOP_QL_OK);
    assert!(result.page_count > 0);
    assert!(result.bytes.len > 0);
    assert!(!result.bytes.ptr.is_null());
    let pdf = unsafe { std::slice::from_raw_parts(result.bytes.ptr, result.bytes.len) };
    assert!(pdf.starts_with(b"%PDF-"));
    unsafe {
        hop_ql_free_bytes(result.bytes.ptr, result.bytes.len);
    }
}

#[test]
fn renders_sample_first_page_png() {
    let data = std::fs::read(sample_path()).expect("sample hwp");
    let result = hop_ql_render_first_page_png(data.as_ptr(), data.len(), 512);
    assert_eq!(result.status, HOP_QL_OK);
    assert!(result.page_count > 0);
    assert!(result.bytes.len > 0);
    assert!(!result.bytes.ptr.is_null());
    let png = unsafe { std::slice::from_raw_parts(result.bytes.ptr, result.bytes.len) };
    assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
    unsafe {
        hop_ql_free_bytes(result.bytes.ptr, result.bytes.len);
    }
}

#[test]
fn preserves_raster_pdf_page_count_and_physical_dimensions() {
    let png = include_bytes!("../../../../../assets/logo/logo-16.png").to_vec();
    let pages = vec![
        pdf::PngPage {
            png: png.clone(),
            width: 96.0,
            height: 192.0,
        },
        pdf::PngPage {
            png,
            width: 192.0,
            height: 96.0,
        },
    ];
    let bytes = pdf::png_pages_to_pdf(pages).unwrap();
    let content = String::from_utf8_lossy(&bytes);
    assert!(content.contains("/Count 2"));
    assert!(content.contains("/MediaBox [0 0 72 144]"));
    assert!(content.contains("/MediaBox [0 0 144 72]"));
    assert!(content.contains("/Subtype /Image"));
}

#[test]
fn rejects_empty_raster_pdf_pages() {
    assert!(pdf::png_pages_to_pdf(Vec::new()).is_err());
    assert!(pdf::png_pages_to_pdf(vec![pdf::PngPage {
        png: Vec::new(),
        width: 96.0,
        height: 96.0,
    }])
    .is_err());
}

fn sample_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../third_party/rhwp/samples/text-align-2.hwp")
}
