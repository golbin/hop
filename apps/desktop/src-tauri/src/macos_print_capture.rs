use objc2::runtime::ProtocolObject;
use objc2_app_kit::{
    NSPaperOrientation, NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPrintingPaginationMode,
};
use objc2_core_graphics::{
    CGBitmapContextCreate, CGColorSpace, CGContext, CGDataProvider, CGImageAlphaInfo,
    CGImageByteOrderInfo, CGPDFBox, CGPDFDocument, CGPDFPage,
};
use objc2_foundation::{NSCopying, NSPoint, NSRect, NSSize, NSString, NSURL};
use objc2_web_kit::WKWebView;
use serde::Serialize;
use std::ffi::{c_void, CString, OsString};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use tauri::WebviewWindow;

const CAPTURE_ENV: &str = "HOP_PRINT_CAPTURE_PATH";
const RASTER_SIZE: usize = 256;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RectSnapshot {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SizeSnapshot {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarginsSnapshot {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrintInfoSnapshot {
    pub paper_size: SizeSnapshot,
    pub imageable_page_bounds: RectSnapshot,
    pub margins: MarginsSnapshot,
    pub scaling_factor: f64,
    pub paper_name: Option<String>,
    pub orientation: i64,
    pub horizontal_pagination: i64,
    pub vertical_pagination: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfPageInspection {
    pub media_box: RectSnapshot,
    pub is_visually_blank: bool,
    pub non_white_pixel_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfInspection {
    pub page_count: usize,
    pub pages: Vec<PdfPageInspection>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrintCaptureResult {
    pub operation_succeeded: bool,
    pub pdf_path: String,
    pub metadata_path: String,
    pub print_info: PrintInfoSnapshot,
    pub pdf: PdfInspection,
}

pub(crate) fn configured_capture_path() -> Result<Option<PathBuf>, String> {
    capture_path_from_value(std::env::var_os(CAPTURE_ENV))
}

fn capture_path_from_value(value: Option<OsString>) -> Result<Option<PathBuf>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!("{CAPTURE_ENV} must be an absolute path"));
    }
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("pdf"))
    {
        return Err(format!("{CAPTURE_ENV} must use a .pdf extension"));
    }
    if path.to_str().is_none() {
        return Err(format!("{CAPTURE_ENV} must be valid UTF-8"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("{CAPTURE_ENV} must have a parent directory"))?;
    if !parent.is_dir() {
        return Err(format!("{CAPTURE_ENV} parent directory does not exist"));
    }
    if path.exists() {
        return Err(format!("{CAPTURE_ENV} destination already exists"));
    }
    let metadata_path = metadata_path_for(&path);
    if metadata_path.exists() {
        return Err(format!("{CAPTURE_ENV} metadata destination already exists"));
    }
    Ok(Some(path))
}

fn metadata_path_for(pdf_path: &Path) -> PathBuf {
    pdf_path.with_extension("pdf.json")
}

pub(crate) async fn capture_attached_webview(
    window: &WebviewWindow,
    pdf_path: PathBuf,
) -> Result<PrintCaptureResult, String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    window
        .with_webview(move |platform_webview| {
            let result = unsafe { capture_webview(platform_webview.inner(), &pdf_path) };
            let _ = sender.send(result);
        })
        .map_err(|error| format!("could not access attached webview: {error}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv()
            .map_err(|_| "attached webview print capture ended without a result".to_string())?
    })
    .await
    .map_err(|error| format!("print capture worker failed: {error}"))?
}

unsafe fn capture_webview(
    webview_pointer: *mut c_void,
    pdf_path: &Path,
) -> Result<PrintCaptureResult, String> {
    let webview = webview_pointer
        .cast::<WKWebView>()
        .as_ref()
        .ok_or_else(|| "attached WKWebView pointer was null".to_string())?;

    // Copy shared state so the diagnostic preserves printer/paper/scaling without
    // mutating the process-global print settings. The four margin writes mirror
    // wry 0.54.4 PrintOptions::default() exactly.
    let print_info = NSPrintInfo::sharedPrintInfo().copy();
    print_info.setTopMargin(0.0);
    print_info.setRightMargin(0.0);
    print_info.setBottomMargin(0.0);
    print_info.setLeftMargin(0.0);
    print_info.setJobDisposition(NSPrintSaveJob);

    let path_string = NSString::from_str(
        pdf_path
            .to_str()
            .ok_or_else(|| "capture path must be valid UTF-8".to_string())?,
    );
    let output_url = NSURL::fileURLWithPath(&path_string);
    let print_dictionary = print_info.dictionary();
    print_dictionary.setObject_forKey(&output_url, ProtocolObject::from_ref(NSPrintJobSavingURL));

    let snapshot = snapshot_print_info(&print_info);
    let operation = webview.printOperationWithPrintInfo(&print_info);
    operation.setCanSpawnSeparateThread(true);
    operation.setShowsPrintPanel(false);
    operation.setShowsProgressPanel(false);
    let operation_succeeded = operation.runOperation();
    if !operation_succeeded {
        return Err("attached WKWebView print operation failed".to_string());
    }
    if !pdf_path.is_file() {
        return Err("print operation completed without creating a PDF".to_string());
    }

    let pdf = inspect_pdf(pdf_path)?;
    let metadata_path = metadata_path_for(pdf_path);
    let result = PrintCaptureResult {
        operation_succeeded,
        pdf_path: pdf_path.display().to_string(),
        metadata_path: metadata_path.display().to_string(),
        print_info: snapshot,
        pdf,
    };
    let metadata = serde_json::to_vec_pretty(&result)
        .map_err(|error| format!("could not serialize print capture metadata: {error}"))?;
    std::fs::write(&metadata_path, metadata)
        .map_err(|error| format!("could not write print capture metadata: {error}"))?;
    Ok(result)
}

fn snapshot_print_info(print_info: &NSPrintInfo) -> PrintInfoSnapshot {
    let paper_size = print_info.paperSize();
    let imageable = print_info.imageablePageBounds();
    PrintInfoSnapshot {
        paper_size: SizeSnapshot {
            width: paper_size.width,
            height: paper_size.height,
        },
        imageable_page_bounds: rect_snapshot(imageable),
        margins: MarginsSnapshot {
            top: print_info.topMargin(),
            right: print_info.rightMargin(),
            bottom: print_info.bottomMargin(),
            left: print_info.leftMargin(),
        },
        scaling_factor: print_info.scalingFactor(),
        paper_name: print_info.paperName().map(|name| name.to_string()),
        orientation: orientation_value(print_info.orientation()),
        horizontal_pagination: pagination_value(print_info.horizontalPagination()),
        vertical_pagination: pagination_value(print_info.verticalPagination()),
    }
}

fn orientation_value(value: NSPaperOrientation) -> i64 {
    value.0 as i64
}

fn pagination_value(value: NSPrintingPaginationMode) -> i64 {
    value.0 as i64
}

fn inspect_pdf(path: &Path) -> Result<PdfInspection, String> {
    use std::os::unix::ffi::OsStrExt;

    let filename = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| "could not open PDF: path contains a NUL byte".to_string())?;
    let provider = unsafe { CGDataProvider::with_filename(filename.as_ptr()) }
        .ok_or_else(|| "could not open PDF data provider".to_string())?;
    let document = CGPDFDocument::with_provider(Some(&provider))
        .ok_or_else(|| "could not open PDF document".to_string())?;
    let page_count = CGPDFDocument::number_of_pages(Some(&document));
    if page_count == 0 {
        return Err("could not open PDF document with at least one page".to_string());
    }

    let mut pages = Vec::with_capacity(page_count);
    for page_number in 1..=page_count {
        let page = CGPDFDocument::page(Some(&document), page_number)
            .ok_or_else(|| format!("could not open PDF page {page_number}"))?;
        let media_box = CGPDFPage::box_rect(Some(&page), CGPDFBox::MediaBox);
        let non_white_pixel_count = count_non_white_pixels(&page)?;
        pages.push(PdfPageInspection {
            media_box: rect_snapshot(media_box),
            is_visually_blank: non_white_pixel_count == 0,
            non_white_pixel_count,
        });
    }
    Ok(PdfInspection { page_count, pages })
}

fn count_non_white_pixels(page: &CGPDFPage) -> Result<usize, String> {
    let mut pixels = vec![255_u8; RASTER_SIZE * RASTER_SIZE * 4];
    let color_space = CGColorSpace::new_device_rgb()
        .ok_or_else(|| "could not create PDF inspection color space".to_string())?;
    let bitmap_info = CGImageAlphaInfo::PremultipliedLast.0 | CGImageByteOrderInfo::Order32Big.0;
    let context = unsafe {
        CGBitmapContextCreate(
            pixels.as_mut_ptr().cast(),
            RASTER_SIZE,
            RASTER_SIZE,
            8,
            RASTER_SIZE * 4,
            Some(&color_space),
            bitmap_info,
        )
    }
    .ok_or_else(|| "could not create PDF inspection bitmap".to_string())?;
    let target = NSRect::new(
        NSPoint::new(0.0, 0.0),
        NSSize::new(RASTER_SIZE as f64, RASTER_SIZE as f64),
    );
    let transform = CGPDFPage::drawing_transform(Some(page), CGPDFBox::MediaBox, target, 0, true);
    CGContext::concat_ctm(Some(&context), transform);
    CGContext::draw_pdf_page(Some(&context), Some(page));
    CGContext::flush(Some(&context));
    drop(context);

    Ok(pixels
        .chunks_exact(4)
        .filter(|pixel| pixel[0] < 250 || pixel[1] < 250 || pixel[2] < 250)
        .count())
}

fn rect_snapshot(rect: NSRect) -> RectSnapshot {
    RectSnapshot {
        x: rect.origin.x,
        y: rect.origin.y,
        width: rect.size.width,
        height: rect.size.height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pdf_writer::{Content, Finish, Pdf, Rect, Ref};
    use std::ffi::OsString;

    fn two_page_fixture() -> Vec<u8> {
        let mut pdf = Pdf::new();
        let catalog = Ref::new(1);
        let pages = Ref::new(2);
        let first_page = Ref::new(3);
        let first_content = Ref::new(4);
        let second_page = Ref::new(5);

        pdf.catalog(catalog).pages(pages);
        pdf.pages(pages).kids([first_page, second_page]).count(2);

        let mut page = pdf.page(first_page);
        page.media_box(Rect::new(0.0, 0.0, 595.0, 842.0));
        page.parent(pages);
        page.contents(first_content);
        page.finish();

        let mut content = Content::new();
        content.rect(100.0, 100.0, 200.0, 200.0);
        content.fill_nonzero();
        pdf.stream(first_content, &content.finish());

        let mut page = pdf.page(second_page);
        page.media_box(Rect::new(0.0, 0.0, 595.0, 842.0));
        page.parent(pages);
        page.finish();

        pdf.finish()
    }

    #[test]
    fn capture_path_is_disabled_when_environment_value_is_absent() {
        assert_eq!(capture_path_from_value(None).unwrap(), None);
    }

    #[test]
    fn capture_path_accepts_a_new_absolute_pdf_in_an_existing_directory() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("capture.pdf");

        assert_eq!(
            capture_path_from_value(Some(path.as_os_str().to_owned())).unwrap(),
            Some(path)
        );
    }

    #[test]
    fn capture_path_rejects_relative_non_pdf_and_existing_destinations() {
        assert!(capture_path_from_value(Some(OsString::from("capture.pdf")))
            .unwrap_err()
            .contains("absolute"));

        let directory = tempfile::tempdir().unwrap();
        let non_pdf = directory.path().join("capture.json");
        assert!(capture_path_from_value(Some(non_pdf.into_os_string()))
            .unwrap_err()
            .contains(".pdf"));

        let existing = directory.path().join("capture.pdf");
        std::fs::write(&existing, b"do not overwrite").unwrap();
        assert!(capture_path_from_value(Some(existing.into_os_string()))
            .unwrap_err()
            .contains("already exists"));
    }

    #[test]
    fn inspect_pdf_reports_page_geometry_and_visual_blankness() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fixture.pdf");
        std::fs::write(&path, two_page_fixture()).unwrap();

        let inspection = inspect_pdf(&path).unwrap();

        assert_eq!(inspection.page_count, 2);
        assert_eq!(inspection.pages.len(), 2);
        assert_eq!(inspection.pages[0].media_box.width, 595.0);
        assert_eq!(inspection.pages[0].media_box.height, 842.0);
        assert!(!inspection.pages[0].is_visually_blank);
        assert!(inspection.pages[1].is_visually_blank);
    }

    #[test]
    fn inspect_pdf_rejects_invalid_input() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("missing.pdf");

        assert!(inspect_pdf(&path).unwrap_err().contains("open PDF"));
    }
}
