use objc2_app_kit::{NSPaperOrientation, NSPrintInfo, NSPrintingPaginationMode};
use objc2_foundation::{NSCopying, NSRange, NSRect, NSThread};
use objc2_web_kit::WKWebView;
use serde::Serialize;
use std::ffi::{c_void, OsString};
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tauri::WebviewWindow;

const OBSERVATION_ENV: &str = "HOP_PRINT_OBSERVATION_PATH";

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
struct FinitePageRange {
    location: usize,
    length: usize,
    page_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrintObservation {
    schema_version: u32,
    mode: &'static str,
    run_operation_succeeded: bool,
    operation_outcome: &'static str,
    protocol_requires: &'static str,
    range_location: usize,
    range_length: usize,
    page_count: usize,
    print_info: PrintInfoSnapshot,
}

pub(crate) fn configured_observation_path() -> Result<Option<PathBuf>, String> {
    observation_path_from_value(std::env::var_os(OBSERVATION_ENV))
}

fn observation_path_from_value(value: Option<OsString>) -> Result<Option<PathBuf>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!("{OBSERVATION_ENV} must be an absolute path"));
    }
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("json"))
    {
        return Err(format!("{OBSERVATION_ENV} must use a .json extension"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("{OBSERVATION_ENV} must have a parent directory"))?;
    if !parent.is_dir() {
        return Err(format!("{OBSERVATION_ENV} parent directory does not exist"));
    }
    if path.exists() {
        return Err(format!("{OBSERVATION_ENV} destination already exists"));
    }
    Ok(Some(path))
}

fn finite_page_range(range: NSRange) -> Result<FinitePageRange, String> {
    let ns_integer_max = isize::MAX as usize;
    if range.location == 0 {
        return Err("print observation page range location must be one-based".to_string());
    }
    if range.location >= ns_integer_max {
        return Err(
            "print observation page range location must be below NSNotFound/NSIntegerMax"
                .to_string(),
        );
    }
    if range.length == 0 {
        return Err("print observation page range has zero pages".to_string());
    }
    if range.length == ns_integer_max {
        return Err("print observation page range is unknown (NSIntegerMax)".to_string());
    }
    let last_page = range
        .location
        .checked_add(range.length - 1)
        .ok_or_else(|| "print observation page range overflow".to_string())?;
    if last_page > ns_integer_max {
        return Err("print observation last page exceeds NSIntegerMax".to_string());
    }
    Ok(FinitePageRange {
        location: range.location,
        length: range.length,
        page_count: range.length,
    })
}

fn operation_observation(
    operation_succeeded: bool,
    range: NSRange,
    print_info: PrintInfoSnapshot,
) -> Result<PrintObservation, String> {
    if operation_succeeded {
        return Err("Cancel-only print observation was approved instead of cancelled".to_string());
    }
    let range = finite_page_range(range)?;
    Ok(PrintObservation {
        schema_version: 1,
        mode: "attached-wkwebview-modal-cancel",
        run_operation_succeeded: false,
        operation_outcome: "cancel-or-error",
        protocol_requires: "human-cancel-attestation",
        range_location: range.location,
        range_length: range.length,
        page_count: range.page_count,
        print_info,
    })
}

pub(crate) fn observe_attached_webview(
    window: &WebviewWindow,
    observation_path: PathBuf,
) -> Result<(), String> {
    if !NSThread::isMainThread_class() {
        return Err("print observation must start on the macOS main thread".to_string());
    }

    // Tauri 2.10.3 handles WithWebview inline when called from its macOS main
    // thread. OnceLock propagates the synchronous modal result without sending
    // the main-thread-only NSPrintOperation to another thread.
    let outcome = Arc::new(OnceLock::new());
    let callback_outcome = Arc::clone(&outcome);
    window
        .with_webview(move |platform_webview| {
            let result =
                unsafe { observe_webview(platform_webview.inner(), observation_path.as_path()) };
            let _ = callback_outcome.set(result);
        })
        .map_err(|error| format!("could not access attached webview: {error}"))?;

    Arc::try_unwrap(outcome)
        .map_err(|_| "attached webview observation did not execute synchronously".to_string())?
        .into_inner()
        .ok_or_else(|| "attached webview observation returned no result".to_string())?
}

unsafe fn observe_webview(webview_pointer: *mut c_void, path: &Path) -> Result<(), String> {
    let webview = webview_pointer
        .cast::<WKWebView>()
        .as_ref()
        .ok_or_else(|| "attached WKWebView pointer was null".to_string())?;

    // Preserve the live printer/paper/scaling state without mutating the shared
    // object. The four zero margins and separate-thread permission mirror wry
    // 0.54.4's normal macOS print inputs.
    let print_info = NSPrintInfo::sharedPrintInfo().copy();
    print_info.setTopMargin(0.0);
    print_info.setRightMargin(0.0);
    print_info.setBottomMargin(0.0);
    print_info.setLeftMargin(0.0);

    let operation = webview.printOperationWithPrintInfo(&print_info);
    operation.setCanSpawnSeparateThread(true);
    operation.setShowsPrintPanel(true);
    operation.setShowsProgressPanel(false);

    let operation_succeeded = operation.runOperation();
    if operation_succeeded {
        return Err("Cancel-only print observation was approved instead of cancelled".to_string());
    }
    let page_range = operation.pageRange();
    let effective_print_info = operation.printInfo();
    let observation = operation_observation(
        operation_succeeded,
        page_range,
        snapshot_print_info(&effective_print_info),
    )?;
    write_observation(path, &observation)
}

fn write_observation(path: &Path, observation: &PrintObservation) -> Result<(), String> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("could not create print observation JSON: {error}"))?;
    serde_json::to_writer_pretty(file, observation)
        .map_err(|error| format!("could not write print observation JSON: {error}"))
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
    use objc2_foundation::NSRange;
    use std::ffi::OsString;

    fn print_info_fixture() -> PrintInfoSnapshot {
        PrintInfoSnapshot {
            paper_size: SizeSnapshot {
                width: 595.0,
                height: 842.0,
            },
            imageable_page_bounds: RectSnapshot {
                x: 18.0,
                y: 41.0,
                width: 559.0,
                height: 783.0,
            },
            margins: MarginsSnapshot {
                top: 0.0,
                right: 0.0,
                bottom: 0.0,
                left: 0.0,
            },
            scaling_factor: 1.0,
            paper_name: Some("iso-a4".to_string()),
            orientation: 0,
            horizontal_pagination: 0,
            vertical_pagination: 0,
        }
    }

    #[test]
    fn observation_path_is_disabled_when_environment_value_is_absent() {
        assert_eq!(observation_path_from_value(None).unwrap(), None);
    }

    #[test]
    fn observation_path_accepts_a_new_absolute_json_in_an_existing_directory() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("observation.json");

        assert_eq!(
            observation_path_from_value(Some(path.as_os_str().to_owned())).unwrap(),
            Some(path)
        );
    }

    #[test]
    fn observation_path_rejects_relative_non_json_and_existing_destinations() {
        assert!(
            observation_path_from_value(Some(OsString::from("observation.json")))
                .unwrap_err()
                .contains("absolute")
        );

        let directory = tempfile::tempdir().unwrap();
        let non_json = directory.path().join("observation.pdf");
        assert!(observation_path_from_value(Some(non_json.into_os_string()))
            .unwrap_err()
            .contains(".json"));

        let existing = directory.path().join("observation.json");
        std::fs::write(&existing, b"do not overwrite").unwrap();
        assert!(observation_path_from_value(Some(existing.into_os_string()))
            .unwrap_err()
            .contains("already exists"));
    }

    #[test]
    fn observation_path_rejects_a_missing_parent_directory() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("missing/observation.json");

        assert!(observation_path_from_value(Some(path.into_os_string()))
            .unwrap_err()
            .contains("parent directory"));
    }

    #[test]
    fn finite_page_range_preserves_location_and_uses_length_as_page_count() {
        let range = finite_page_range(NSRange::new(3, 2)).unwrap();

        assert_eq!(range.location, 3);
        assert_eq!(range.length, 2);
        assert_eq!(range.page_count, 2);
    }

    #[test]
    fn finite_page_range_accepts_a_last_page_at_ns_integer_max() {
        let ns_integer_max = isize::MAX as usize;
        let range = finite_page_range(NSRange::new(ns_integer_max - 1, 2)).unwrap();

        assert_eq!(range.location, ns_integer_max - 1);
        assert_eq!(range.length, 2);
        assert_eq!(range.page_count, 2);
    }

    #[test]
    fn finite_page_range_rejects_zero_unknown_not_found_and_overflowing_ranges() {
        let ns_integer_max = isize::MAX as usize;

        assert!(finite_page_range(NSRange::new(1, 0))
            .unwrap_err()
            .contains("zero"));
        assert!(finite_page_range(NSRange::new(1, ns_integer_max))
            .unwrap_err()
            .contains("unknown"));
        assert!(finite_page_range(NSRange::new(ns_integer_max, 1))
            .unwrap_err()
            .contains("location"));
        assert!(finite_page_range(NSRange::new(ns_integer_max + 1, 1))
            .unwrap_err()
            .contains("location"));
        assert!(finite_page_range(NSRange::new(ns_integer_max - 1, 3))
            .unwrap_err()
            .contains("NSIntegerMax"));
        assert!(
            finite_page_range(NSRange::new(ns_integer_max - 1, usize::MAX))
                .unwrap_err()
                .contains("overflow")
        );
    }

    #[test]
    fn operation_observation_rejects_successful_operations() {
        assert!(
            operation_observation(true, NSRange::new(1, 2), print_info_fixture(),)
                .unwrap_err()
                .contains("Cancel")
        );
    }

    #[test]
    fn operation_observation_serializes_ambiguous_outcome_without_claiming_cancel() {
        let observation =
            operation_observation(false, NSRange::new(1, 2), print_info_fixture()).unwrap();
        let json = serde_json::to_value(observation).unwrap();

        assert_eq!(json["schemaVersion"], 1);
        assert_eq!(json["mode"], "attached-wkwebview-modal-cancel");
        assert_eq!(json["runOperationSucceeded"], false);
        assert_eq!(json["operationOutcome"], "cancel-or-error");
        assert_eq!(json["protocolRequires"], "human-cancel-attestation");
        assert!(json.get("operatorAction").is_none());
        assert_eq!(json["rangeLocation"], 1);
        assert_eq!(json["rangeLength"], 2);
        assert_eq!(json["pageCount"], 2);
        assert_eq!(json["printInfo"]["paperSize"]["width"], 595.0);
        assert!(json.get("pdfPath").is_none());
        assert!(json.get("documentPath").is_none());
    }
}
