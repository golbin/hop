use crate::macos_print_capture::{
    rect_snapshot, snapshot_print_info, PrintInfoSnapshot, RectSnapshot,
};
use crate::print_probe::{write_probe_stage, PrintProbeInput, ProbeStage};
use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSModalPanelRunLoopMode, NSPrintInfo};
use objc2_foundation::{NSCopying, NSRange, NSRunLoop, NSRunLoopCommonModes, NSThread, NSTimer};
use objc2_web_kit::WKWebView;
use serde::Serialize;
use std::ffi::c_void;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::WebviewWindow;

const AUTO_ABORT_DELAY: Duration = Duration::from_secs(2);
const POLL_INTERVAL: Duration = Duration::from_millis(50);
const MAX_PAGE_RECTS: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CoordinatorDecision {
    Poll,
    AbortModal,
}

#[derive(Debug, Default)]
struct AutoAbortState {
    aborted: bool,
    timer_fired: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct FinitePageRange {
    location: usize,
    length: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageRectSnapshot {
    page: usize,
    rect: RectSnapshot,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrintViewSnapshot {
    frame: RectSnapshot,
    bounds: RectSnapshot,
    visible_rect: RectSnapshot,
    is_flipped: bool,
    pages: Vec<PageRectSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeometryObservation {
    schema_version: u32,
    mode: &'static str,
    run_operation_succeeded: bool,
    operation_outcome: &'static str,
    range: FinitePageRange,
    probe_input: PrintProbeInput,
    print_info: PrintInfoSnapshot,
    print_view: PrintViewSnapshot,
}

fn geometry_observation(
    operation_succeeded: bool,
    range: FinitePageRange,
    probe_input: PrintProbeInput,
    print_info: PrintInfoSnapshot,
    print_view: PrintViewSnapshot,
) -> Result<GeometryObservation, String> {
    if operation_succeeded {
        return Err("automatic print geometry probe unexpectedly succeeded".to_string());
    }
    Ok(GeometryObservation {
        schema_version: 1,
        mode: "attached-wkwebview-modal-auto-abort",
        run_operation_succeeded: false,
        operation_outcome: "auto-aborted-before-post-run-range-capture",
        range,
        probe_input,
        print_info,
        print_view,
    })
}

fn coordinator_decision(elapsed: Duration) -> CoordinatorDecision {
    if elapsed >= AUTO_ABORT_DELAY {
        CoordinatorDecision::AbortModal
    } else {
        CoordinatorDecision::Poll
    }
}

fn finite_page_range(range: NSRange) -> Result<FinitePageRange, String> {
    let ns_integer_max = isize::MAX as usize;
    if range.location == 0 || range.location >= ns_integer_max {
        return Err("print geometry probe range location is not finite".to_string());
    }
    if range.length == 0 || range.length == ns_integer_max {
        return Err("print geometry probe range length is not finite".to_string());
    }
    let last_page = range
        .location
        .checked_add(range.length - 1)
        .ok_or_else(|| "print geometry probe range overflow".to_string())?;
    if last_page > ns_integer_max {
        return Err("print geometry probe last page exceeds NSIntegerMax".to_string());
    }
    Ok(FinitePageRange {
        location: range.location,
        length: range.length,
    })
}

pub(crate) fn observe_attached_webview_geometry(
    window: &WebviewWindow,
    path: PathBuf,
    input: PrintProbeInput,
) -> Result<(), String> {
    input.validate()?;
    if !NSThread::isMainThread_class() {
        return Err("print geometry probe must start on the macOS main thread".to_string());
    }

    let outcome = Arc::new(OnceLock::new());
    let callback_outcome = Arc::clone(&outcome);
    window
        .with_webview(move |platform_webview| {
            let result =
                unsafe { observe_webview(platform_webview.inner(), path.as_path(), input) };
            let _ = callback_outcome.set(result);
        })
        .map_err(|error| format!("could not access attached webview: {error}"))?;

    Arc::try_unwrap(outcome)
        .map_err(|_| "print geometry probe callback was retained".to_string())?
        .into_inner()
        .ok_or_else(|| "print geometry probe returned no result".to_string())?
}

unsafe fn observe_webview(
    webview_pointer: *mut c_void,
    path: &Path,
    input: PrintProbeInput,
) -> Result<(), String> {
    let webview = webview_pointer
        .cast::<WKWebView>()
        .as_ref()
        .ok_or_else(|| "attached WKWebView pointer was null".to_string())?;

    let print_info = NSPrintInfo::sharedPrintInfo().copy();
    print_info.setTopMargin(0.0);
    print_info.setRightMargin(0.0);
    print_info.setBottomMargin(0.0);
    print_info.setLeftMargin(0.0);
    let operation = webview.printOperationWithPrintInfo(&print_info);
    operation.setCanSpawnSeparateThread(true);
    operation.setShowsPrintPanel(true);
    operation.setShowsProgressPanel(false);

    let (timer, auto_abort_state) = install_auto_abort_timer(path.to_path_buf());
    let operation_succeeded = operation.runOperation();
    timer.invalidate();
    let state = auto_abort_state
        .lock()
        .map_err(|_| "print geometry probe auto-abort state was poisoned".to_string())?;
    if !state.timer_fired {
        return Err("print geometry probe timer did not fire".to_string());
    }
    if !state.aborted {
        return Err("print operation ended before automatic modal abort".to_string());
    }
    drop(state);

    let operation_range = finite_page_range(operation.pageRange())?;
    write_probe_stage(path, ProbeStage::FiniteRangeCaptured)?;
    if operation_range.length > MAX_PAGE_RECTS {
        return Err(format!(
            "print geometry probe range exceeds {MAX_PAGE_RECTS} pages"
        ));
    }

    let view = operation
        .view()
        .ok_or_else(|| "print geometry probe operation had no retained view".to_string())?;
    let pages = (operation_range.location..operation_range.location + operation_range.length)
        .map(|page| PageRectSnapshot {
            page,
            rect: rect_snapshot(view.rectForPage(page as isize)),
        })
        .collect();
    let observation = geometry_observation(
        operation_succeeded,
        operation_range,
        input,
        snapshot_print_info(&operation.printInfo()),
        PrintViewSnapshot {
            frame: rect_snapshot(view.frame()),
            bounds: rect_snapshot(view.bounds()),
            visible_rect: rect_snapshot(view.visibleRect()),
            is_flipped: view.isFlipped(),
            pages,
        },
    )?;
    write_observation(path, &observation)
}

fn install_auto_abort_timer(
    observation_path: PathBuf,
) -> (objc2::rc::Retained<NSTimer>, Arc<Mutex<AutoAbortState>>) {
    let state = Arc::new(Mutex::new(AutoAbortState::default()));
    let timer_state = Arc::clone(&state);
    let started_at = Instant::now();
    let block = RcBlock::new(move |timer_pointer: NonNull<NSTimer>| {
        let first_tick = {
            let mut state = timer_state
                .lock()
                .expect("print geometry probe auto-abort state was poisoned");
            let first_tick = !state.timer_fired;
            state.timer_fired = true;
            first_tick
        };
        if first_tick {
            let _ = write_probe_stage(&observation_path, ProbeStage::TimerFired);
        }
        let decision = coordinator_decision(started_at.elapsed());
        if matches!(decision, CoordinatorDecision::Poll) {
            return;
        }

        {
            let mut state = timer_state
                .lock()
                .expect("print geometry probe auto-abort state was poisoned");
            state.aborted = true;
        }
        let _ = write_probe_stage(&observation_path, ProbeStage::ModalAborted);
        unsafe { timer_pointer.as_ref() }.invalidate();
        let marker =
            MainThreadMarker::new().expect("modal print timer did not execute on the main thread");
        NSApplication::sharedApplication(marker).abortModal();
    });
    let timer = unsafe {
        NSTimer::timerWithTimeInterval_repeats_block(POLL_INTERVAL.as_secs_f64(), true, &block)
    };
    unsafe {
        let run_loop = NSRunLoop::mainRunLoop();
        run_loop.addTimer_forMode(&timer, NSModalPanelRunLoopMode);
        run_loop.addTimer_forMode(&timer, NSRunLoopCommonModes);
    }
    (timer, state)
}

fn write_observation(path: &Path, observation: &GeometryObservation) -> Result<(), String> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("could not create print geometry observation: {error}"))?;
    serde_json::to_writer_pretty(file, observation)
        .map_err(|error| format!("could not write print geometry observation: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::macos_print_capture::{MarginsSnapshot, SizeSnapshot};
    use objc2_foundation::NSRange;

    fn print_info_fixture() -> PrintInfoSnapshot {
        PrintInfoSnapshot {
            paper_size: SizeSnapshot {
                width: 595.0,
                height: 842.0,
            },
            imageable_page_bounds: RectSnapshot {
                x: 12.0,
                y: 12.0,
                width: 571.0,
                height: 818.0,
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
            horizontal_pagination: 2,
            vertical_pagination: 0,
        }
    }

    fn input_fixture() -> PrintProbeInput {
        PrintProbeInput {
            engine_page_count: 1,
            dom_page_count: 1,
            page_width_mm: 210.0,
            page_height_mm: 297.0,
            final_break_is_auto: true,
        }
    }

    fn view_fixture() -> PrintViewSnapshot {
        PrintViewSnapshot {
            frame: RectSnapshot {
                x: 0.0,
                y: 0.0,
                width: 595.0,
                height: 843.0,
            },
            bounds: RectSnapshot {
                x: 0.0,
                y: 0.0,
                width: 595.0,
                height: 843.0,
            },
            visible_rect: RectSnapshot {
                x: 0.0,
                y: 0.0,
                width: 595.0,
                height: 843.0,
            },
            is_flipped: true,
            pages: vec![
                PageRectSnapshot {
                    page: 1,
                    rect: RectSnapshot {
                        x: 0.0,
                        y: 0.0,
                        width: 595.0,
                        height: 842.0,
                    },
                },
                PageRectSnapshot {
                    page: 2,
                    rect: RectSnapshot {
                        x: 0.0,
                        y: 842.0,
                        width: 595.0,
                        height: 1.0,
                    },
                },
            ],
        }
    }

    #[test]
    fn modal_is_aborted_only_after_the_pagination_settle_delay() {
        assert_eq!(
            coordinator_decision(AUTO_ABORT_DELAY - Duration::from_millis(1)),
            CoordinatorDecision::Poll
        );
        assert_eq!(
            coordinator_decision(AUTO_ABORT_DELAY),
            CoordinatorDecision::AbortModal
        );
    }

    #[test]
    fn unknown_or_zero_page_ranges_are_rejected_after_modal_abort() {
        assert!(finite_page_range(NSRange::new(1, isize::MAX as usize)).is_err());
        assert!(finite_page_range(NSRange::new(0, 2)).is_err());
        assert!(finite_page_range(NSRange::new(isize::MAX as usize, 2)).is_err());
    }

    #[test]
    fn observation_rejects_success_and_serializes_only_sanitized_geometry() {
        assert!(geometry_observation(
            true,
            FinitePageRange {
                location: 1,
                length: 2,
            },
            input_fixture(),
            print_info_fixture(),
            view_fixture(),
        )
        .unwrap_err()
        .contains("succeeded"));

        let observation = geometry_observation(
            false,
            FinitePageRange {
                location: 1,
                length: 2,
            },
            input_fixture(),
            print_info_fixture(),
            view_fixture(),
        )
        .unwrap();
        let json = serde_json::to_value(observation).unwrap();
        let mut keys = json
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        keys.sort();
        assert_eq!(
            keys,
            vec![
                "mode",
                "operationOutcome",
                "printInfo",
                "printView",
                "probeInput",
                "range",
                "runOperationSucceeded",
                "schemaVersion",
            ]
        );
        assert_eq!(json["printView"]["pages"][0]["page"], 1);
        assert_eq!(json["printView"]["pages"][1]["rect"]["height"], 1.0);
        let encoded = serde_json::to_string(&json).unwrap();
        for forbidden in [
            "documentPath",
            "fileName",
            "svg",
            "printer",
            "pdfPath",
            "private-sentinel",
        ] {
            assert!(!encoded.contains(forbidden));
        }
    }
}
