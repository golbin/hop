mod pdf;
#[cfg(test)]
mod tests;

use hop_rhwp_adapter::{extract_thumbnail_only, DocumentCore, PngExportOptions};
use std::ffi::c_void;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;

const HOP_QL_OK: i32 = 0;
const HOP_QL_INVALID_INPUT: i32 = 1;
const HOP_QL_PARSE_FAILED: i32 = 2;
const HOP_QL_EMPTY_DOCUMENT: i32 = 3;
const HOP_QL_RENDER_FAILED: i32 = 4;
const HOP_QL_NO_THUMBNAIL: i32 = 5;
const PREVIEW_MAX_PIXEL_DIMENSION: u32 = 2048;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct HopQuickLookBytes {
    pub ptr: *mut u8,
    pub len: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct HopQuickLookRenderResult {
    pub status: i32,
    pub bytes: HopQuickLookBytes,
    pub page_count: u32,
    pub width: f64,
    pub height: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct HopQuickLookThumbnailResult {
    pub status: i32,
    pub bytes: HopQuickLookBytes,
    pub width: u32,
    pub height: u32,
}

#[no_mangle]
pub extern "C" fn hop_ql_render_preview_pdf(
    data: *const u8,
    len: usize,
) -> HopQuickLookRenderResult {
    ffi_render_result(|| {
        let bytes = borrowed_bytes(data, len)?;
        let core = DocumentCore::from_bytes(bytes).map_err(|_| HOP_QL_PARSE_FAILED)?;
        let page_count = core.page_count();
        if page_count == 0 {
            return Err(HOP_QL_EMPTY_DOCUMENT);
        }
        let mut png_pages = Vec::with_capacity(page_count as usize);
        let mut first_page_dimensions = None;
        for page in 0..page_count {
            let (width, height) = page_size(&core, page)?;
            if page == 0 {
                first_page_dimensions = Some((width, height));
            }
            png_pages.push(pdf::PngPage {
                png: render_page_png(&core, page, Some(PREVIEW_MAX_PIXEL_DIMENSION))?,
                width,
                height,
            });
        }
        let (width, height) = first_page_dimensions.ok_or(HOP_QL_RENDER_FAILED)?;
        let pdf = pdf::png_pages_to_pdf(png_pages).map_err(|_| HOP_QL_RENDER_FAILED)?;
        Ok(HopQuickLookRenderResult {
            status: HOP_QL_OK,
            bytes: owned_bytes(pdf),
            page_count,
            width,
            height,
        })
    })
}

#[no_mangle]
pub extern "C" fn hop_ql_render_first_page_png(
    data: *const u8,
    len: usize,
    max_dimension: u32,
) -> HopQuickLookRenderResult {
    ffi_render_result(|| {
        let bytes = borrowed_bytes(data, len)?;
        let core = DocumentCore::from_bytes(bytes).map_err(|_| HOP_QL_PARSE_FAILED)?;
        let page_count = core.page_count();
        if page_count == 0 {
            return Err(HOP_QL_EMPTY_DOCUMENT);
        }
        let (width, height) = page_size(&core, 0)?;
        let png = render_page_png(&core, 0, (max_dimension != 0).then_some(max_dimension))?;
        Ok(HopQuickLookRenderResult {
            status: HOP_QL_OK,
            bytes: owned_bytes(png),
            page_count,
            width,
            height,
        })
    })
}

#[no_mangle]
pub extern "C" fn hop_ql_extract_embedded_thumbnail(
    data: *const u8,
    len: usize,
) -> HopQuickLookThumbnailResult {
    ffi_thumbnail_result(|| {
        let bytes = borrowed_bytes(data, len)?;
        let Some(thumbnail) = extract_thumbnail_only(bytes) else {
            return Err(HOP_QL_NO_THUMBNAIL);
        };
        if thumbnail.data.is_empty() {
            return Err(HOP_QL_NO_THUMBNAIL);
        }
        Ok(HopQuickLookThumbnailResult {
            status: HOP_QL_OK,
            bytes: owned_bytes(thumbnail.data),
            width: thumbnail.width,
            height: thumbnail.height,
        })
    })
}

#[no_mangle]
/// # Safety
///
/// `ptr` and `len` must be a buffer previously returned by this crate's FFI
/// functions. Passing any other pointer, or passing the same pointer more than
/// once, is undefined behavior.
pub unsafe extern "C" fn hop_ql_free_bytes(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    unsafe {
        drop(Vec::from_raw_parts(ptr, len, len));
    }
}

#[no_mangle]
/// # Safety
///
/// `ptr` and `len` must be a buffer previously returned by this crate's FFI
/// functions. Passing any other pointer, or passing the same pointer more than
/// once, is undefined behavior.
pub unsafe extern "C" fn hop_ql_free(ptr: *mut c_void, len: usize) {
    unsafe {
        hop_ql_free_bytes(ptr.cast::<u8>(), len);
    }
}

fn borrowed_bytes<'a>(data: *const u8, len: usize) -> Result<&'a [u8], i32> {
    if data.is_null() || len == 0 {
        return Err(HOP_QL_INVALID_INPUT);
    }
    Ok(unsafe { std::slice::from_raw_parts(data, len) })
}

fn owned_bytes(bytes: Vec<u8>) -> HopQuickLookBytes {
    let mut bytes = bytes.into_boxed_slice();
    let len = bytes.len();
    let ptr = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    HopQuickLookBytes { ptr, len }
}

fn empty_bytes() -> HopQuickLookBytes {
    HopQuickLookBytes {
        ptr: ptr::null_mut(),
        len: 0,
    }
}

fn ffi_render_result(
    f: impl FnOnce() -> Result<HopQuickLookRenderResult, i32>,
) -> HopQuickLookRenderResult {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(result)) => result,
        Ok(Err(status)) => render_error(status),
        Err(_) => render_error(HOP_QL_RENDER_FAILED),
    }
}

fn ffi_thumbnail_result(
    f: impl FnOnce() -> Result<HopQuickLookThumbnailResult, i32>,
) -> HopQuickLookThumbnailResult {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(result)) => result,
        Ok(Err(status)) => thumbnail_error(status),
        Err(_) => thumbnail_error(HOP_QL_RENDER_FAILED),
    }
}

fn render_error(status: i32) -> HopQuickLookRenderResult {
    HopQuickLookRenderResult {
        status,
        bytes: empty_bytes(),
        page_count: 0,
        width: 0.0,
        height: 0.0,
    }
}

fn thumbnail_error(status: i32) -> HopQuickLookThumbnailResult {
    HopQuickLookThumbnailResult {
        status,
        bytes: empty_bytes(),
        width: 0,
        height: 0,
    }
}

fn render_page_png(
    core: &DocumentCore,
    page: u32,
    max_dimension: Option<u32>,
) -> Result<Vec<u8>, i32> {
    let options = PngExportOptions {
        scale: None,
        max_dimension: max_dimension.map(|value| value.min(i32::MAX as u32) as i32),
        vlm_target: None,
        dpi: None,
        font_paths: Vec::new(),
    };
    core.render_page_png_native_with_export_options(page, &options)
        .map_err(|_| HOP_QL_RENDER_FAILED)
}

fn page_size(core: &DocumentCore, page: u32) -> Result<(f64, f64), i32> {
    let raw = core
        .get_page_info_native(page)
        .map_err(|_| HOP_QL_RENDER_FAILED)?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|_| HOP_QL_RENDER_FAILED)?;
    let width = value
        .get("width")
        .and_then(|v| v.as_f64())
        .filter(|v| *v > 0.0)
        .ok_or(HOP_QL_RENDER_FAILED)?;
    let height = value
        .get("height")
        .and_then(|v| v.as_f64())
        .filter(|v| *v > 0.0)
        .ok_or(HOP_QL_RENDER_FAILED)?;
    Ok((width, height))
}
