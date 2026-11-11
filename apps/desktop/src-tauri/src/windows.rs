use std::path::PathBuf;
use tauri::{
    AppHandle, DragDropEvent, Emitter, LogicalSize, Manager, Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use uuid::Uuid;

const MIN_EDITOR_WINDOW_WIDTH: f64 = 960.0;
const MIN_EDITOR_WINDOW_HEIGHT: f64 = 720.0;
const NEW_WINDOW_PREFERRED_WIDTH: f64 = 1100.0;
const NEW_WINDOW_PREFERRED_HEIGHT: f64 = 760.0;
const NEW_WINDOW_MAX_WORK_AREA_RATIO: f64 = 0.85;
const NEW_WINDOW_WORK_AREA_MARGIN: f64 = 24.0;
const NEW_WINDOW_FRAME_HEIGHT_RESERVE: f64 = 72.0;

pub fn create_editor_window(app: &AppHandle) -> Result<String, String> {
    let label = new_editor_window_label();
    create_editor_window_with_label(app, &label)?;
    Ok(label)
}

pub fn new_editor_window_label() -> String {
    format!("main{}", Uuid::new_v4().simple())
}

pub fn create_editor_window_with_label(app: &AppHandle, label: &str) -> Result<(), String> {
    let geometry = new_window_geometry(app);

    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("HOP")
        .inner_size(geometry.width, geometry.height)
        .min_inner_size(geometry.min_width, geometry.min_height)
        .prevent_overflow_with_margin(Size::Logical(LogicalSize::new(
            NEW_WINDOW_WORK_AREA_MARGIN,
            NEW_WINDOW_WORK_AREA_MARGIN,
        )));
    let builder = if let Some((x, y)) = geometry.position {
        builder.position(x, y)
    } else {
        builder.center()
    };
    #[cfg(windows)]
    let builder = builder.zoom_hotkeys_enabled(true);

    let window = builder
        .build()
        .map_err(|e| format!("새 창 생성 실패: {}", e))?;
    install_editor_window_minimum_with_size(&window, geometry.min_width, geometry.min_height);
    configure_editor_webview(app, &window);
    attach_pending_open_cleanup(app, &window);
    let _ = window.set_focus();

    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct NewWindowGeometry {
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
    position: Option<(f64, f64)>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct LogicalWorkArea {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn new_window_geometry(app: &AppHandle) -> NewWindowGeometry {
    new_window_geometry_for_work_area(active_monitor_logical_work_area(app))
}

fn new_window_geometry_for_work_area(work_area: Option<LogicalWorkArea>) -> NewWindowGeometry {
    let Some(work_area) = work_area else {
        return NewWindowGeometry {
            width: NEW_WINDOW_PREFERRED_WIDTH,
            height: NEW_WINDOW_PREFERRED_HEIGHT,
            min_width: MIN_EDITOR_WINDOW_WIDTH,
            min_height: MIN_EDITOR_WINDOW_HEIGHT,
            position: None,
        };
    };

    let usable_width = (work_area.width - NEW_WINDOW_WORK_AREA_MARGIN * 2.0).max(1.0);
    let usable_height =
        (work_area.height - NEW_WINDOW_WORK_AREA_MARGIN * 2.0 - NEW_WINDOW_FRAME_HEIGHT_RESERVE)
            .max(1.0);
    let max_width = (usable_width * NEW_WINDOW_MAX_WORK_AREA_RATIO).floor();
    let max_height = (usable_height * NEW_WINDOW_MAX_WORK_AREA_RATIO).floor();

    let width = clamped_new_window_dimension(
        NEW_WINDOW_PREFERRED_WIDTH,
        MIN_EDITOR_WINDOW_WIDTH,
        max_width,
    );
    let height = clamped_new_window_dimension(
        NEW_WINDOW_PREFERRED_HEIGHT,
        MIN_EDITOR_WINDOW_HEIGHT,
        max_height,
    );
    let min_width = MIN_EDITOR_WINDOW_WIDTH.min(width);
    let min_height = MIN_EDITOR_WINDOW_HEIGHT.min(height);
    let position = Some(centered_window_position(work_area, width, height));

    NewWindowGeometry {
        width,
        height,
        min_width,
        min_height,
        position,
    }
}

fn centered_window_position(work_area: LogicalWorkArea, width: f64, height: f64) -> (f64, f64) {
    (
        work_area.x + ((work_area.width - width) / 2.0).max(NEW_WINDOW_WORK_AREA_MARGIN),
        work_area.y
            + ((work_area.height - height - NEW_WINDOW_FRAME_HEIGHT_RESERVE) / 2.0)
                .max(NEW_WINDOW_WORK_AREA_MARGIN),
    )
}

fn active_monitor_logical_work_area(app: &AppHandle) -> Option<LogicalWorkArea> {
    let monitor = target_window_label(app)
        .and_then(|label| app.get_webview_window(&label))
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let scale_factor = monitor.scale_factor();
    if scale_factor <= 0.0 {
        return None;
    }
    let work_area = monitor.work_area();
    Some(LogicalWorkArea {
        x: f64::from(work_area.position.x) / scale_factor,
        y: f64::from(work_area.position.y) / scale_factor,
        width: f64::from(work_area.size.width) / scale_factor,
        height: f64::from(work_area.size.height) / scale_factor,
    })
}

fn clamped_new_window_dimension(preferred: f64, min: f64, max: f64) -> f64 {
    if max <= 0.0 {
        return preferred.max(min);
    }
    preferred.min(max).max(min.min(max))
}

pub fn install_editor_window_minimum(window: &WebviewWindow) {
    install_editor_window_minimum_with_size(
        window,
        MIN_EDITOR_WINDOW_WIDTH,
        MIN_EDITOR_WINDOW_HEIGHT,
    );
}

fn install_editor_window_minimum_with_size(
    window: &WebviewWindow,
    min_width: f64,
    min_height: f64,
) {
    let minimum = LogicalSize::new(min_width, min_height);
    let _ = window.set_min_size(Some(Size::Logical(minimum)));
}

pub fn configure_editor_webview(app: &AppHandle, window: &WebviewWindow) {
    #[cfg(target_os = "linux")]
    crate::linux_runtime::enable_inline_preedit(window);

    let app = app.clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event else {
            return;
        };
        let paths = document_paths(paths);
        if paths.is_empty() {
            return;
        }
        let _ = app.emit_to(
            label.as_str(),
            "hop-open-paths",
            serde_json::json!({ "paths": paths }),
        );
    });
}

fn attach_pending_open_cleanup(app: &AppHandle, window: &WebviewWindow) {
    let app = app.clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            app.state::<crate::state::AppState>()
                .pending_open_paths
                .discard_for_window(&label);
        }
    });
}

fn document_paths(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .filter_map(super::document_path_from_path)
        .collect()
}

pub fn target_window_label(app: &AppHandle) -> Option<String> {
    let windows = app.webview_windows();
    windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label.clone())
        .or_else(|| windows.keys().next().cloned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_paths_keeps_only_supported_documents() {
        let a = PathBuf::from("/tmp/a.hwp");
        let b = PathBuf::from("/tmp/b.HWPX");
        let paths = document_paths(&[
            a.clone(),
            b.clone(),
            PathBuf::from("/tmp/c.pdf"),
            PathBuf::from("/tmp/no-extension"),
        ]);

        assert_eq!(
            paths,
            vec![
                a.to_string_lossy().to_string(),
                b.to_string_lossy().to_string()
            ]
        );
    }

    #[test]
    fn document_paths_preserves_input_order() {
        let first = PathBuf::from("/tmp/first.hwp");
        let second = PathBuf::from("/tmp/second.hwpx");
        let paths = document_paths(&[first.clone(), second.clone()]);

        assert_eq!(
            paths,
            vec![
                first.to_string_lossy().to_string(),
                second.to_string_lossy().to_string()
            ]
        );
    }

    #[test]
    fn clamped_new_window_dimension_prefers_default_within_work_area() {
        assert_eq!(clamped_new_window_dimension(1100.0, 960.0, 1400.0), 1100.0);
    }

    #[test]
    fn clamped_new_window_dimension_caps_to_work_area() {
        assert_eq!(clamped_new_window_dimension(1100.0, 960.0, 1000.0), 1000.0);
    }

    #[test]
    fn clamped_new_window_dimension_keeps_minimum_on_small_screens() {
        assert_eq!(clamped_new_window_dimension(1100.0, 720.0, 578.0), 578.0);
    }

    #[test]
    fn new_window_geometry_uses_work_area_size_and_position() {
        let geometry = new_window_geometry_for_work_area(Some(LogicalWorkArea {
            x: 1200.0,
            y: 40.0,
            width: 1600.0,
            height: 1000.0,
        }));

        assert_eq!(geometry.width, 1100.0);
        assert_eq!(geometry.height, 748.0);
        assert_eq!(geometry.min_width, 960.0);
        assert_eq!(geometry.min_height, 720.0);
        assert_eq!(geometry.position, Some((1450.0, 130.0)));
    }

    #[test]
    fn new_window_geometry_stays_inside_small_work_area() {
        let geometry = new_window_geometry_for_work_area(Some(LogicalWorkArea {
            x: 0.0,
            y: 0.0,
            width: 1024.0,
            height: 680.0,
        }));

        assert_eq!(geometry.width, 829.0);
        assert_eq!(geometry.height, 476.0);
        assert_eq!(geometry.min_width, 829.0);
        assert_eq!(geometry.min_height, 476.0);
        assert_eq!(geometry.position, Some((97.5, 66.0)));
    }

    #[test]
    fn new_window_geometry_falls_back_without_monitor_data() {
        let geometry = new_window_geometry_for_work_area(None);

        assert_eq!(
            geometry,
            NewWindowGeometry {
                width: 1100.0,
                height: 760.0,
                min_width: 960.0,
                min_height: 720.0,
                position: None,
            }
        );
    }
}
