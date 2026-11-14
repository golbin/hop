use std::collections::VecDeque;

use tauri::{AppHandle, Manager};
#[cfg(target_os = "macos")]
use tauri::{Emitter, RunEvent};

use crate::state::AppState;

#[cfg(target_os = "macos")]
const APP_QUIT_REQUEST_EVENT: &str = "hop-app-quit-requested";

#[derive(Default)]
pub struct AppQuitState {
    pending_window_labels: VecDeque<String>,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QuitAdvance {
    Idle,
    Next(String),
    Complete,
}

impl AppQuitState {
    #[cfg(any(target_os = "macos", test))]
    pub fn is_in_progress(&self) -> bool {
        !self.pending_window_labels.is_empty()
    }

    #[cfg(any(target_os = "macos", test))]
    pub fn begin(&mut self, labels: Vec<String>) -> Option<String> {
        self.pending_window_labels = labels.into();
        self.pending_window_labels.front().cloned()
    }

    pub fn cancel(&mut self) {
        self.pending_window_labels.clear();
    }

    #[cfg(any(target_os = "macos", test))]
    pub fn advance_after_close(&mut self, closed_label: &str) -> QuitAdvance {
        if self.pending_window_labels.is_empty() {
            return QuitAdvance::Idle;
        }

        if self.pending_window_labels.front().map(String::as_str) == Some(closed_label) {
            self.pending_window_labels.pop_front();
        } else {
            self.pending_window_labels
                .retain(|label| label != closed_label);
        }

        match self.pending_window_labels.front() {
            Some(next) => QuitAdvance::Next(next.clone()),
            None => QuitAdvance::Complete,
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn request_app_quit(app: &AppHandle) -> Result<(), String> {
    let next_label = {
        let state = app.state::<AppState>();
        let mut quit_requests = state
            .quit_requests
            .lock()
            .map_err(|_| crate::ui_text::text("quit.lockFailed").to_string())?;
        if quit_requests.is_in_progress() {
            return Ok(());
        }
        quit_requests.begin(ordered_quit_labels(app))
    };

    match next_label {
        Some(label) => emit_app_quit_request(app, &label),
        None => {
            app.exit(0);
            Ok(())
        }
    }
}

pub(crate) fn cancel_app_quit_request(app: &AppHandle) -> Result<(), String> {
    app.state::<AppState>()
        .quit_requests
        .lock()
        .map_err(|_| crate::ui_text::text("quit.lockFailed").to_string())?
        .cancel();
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn handle_run_event(app: &AppHandle, event: &RunEvent) -> Result<(), String> {
    match event {
        RunEvent::ExitRequested { code, api, .. } if code.is_none() => {
            api.prevent_exit();
            request_app_quit(app)
        }
        RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => handle_quit_window_destroyed(app, label),
        _ => Ok(()),
    }
}

#[cfg(target_os = "macos")]
fn handle_quit_window_destroyed(app: &AppHandle, label: &str) -> Result<(), String> {
    let advance = {
        let state = app.state::<AppState>();
        let mut quit_requests = state
            .quit_requests
            .lock()
            .map_err(|_| crate::ui_text::text("quit.lockFailed").to_string())?;
        quit_requests.advance_after_close(label)
    };

    match advance {
        QuitAdvance::Idle => Ok(()),
        QuitAdvance::Next(next_label) => emit_app_quit_request(app, &next_label),
        QuitAdvance::Complete => {
            app.exit(0);
            Ok(())
        }
    }
}

#[cfg(target_os = "macos")]
fn emit_app_quit_request(app: &AppHandle, label: &str) -> Result<(), String> {
    app.emit_to(label, APP_QUIT_REQUEST_EVENT, serde_json::json!({}))
        .map_err(|e| {
            let _ = cancel_app_quit_request(app);
            crate::ui_text::text_with("quit.emitFailed", &[&label, &e])
        })
}

#[cfg(target_os = "macos")]
fn ordered_quit_labels(app: &AppHandle) -> Vec<String> {
    let mut labels: Vec<String> = app.webview_windows().keys().cloned().collect();
    labels.sort();
    if let Some(target) = crate::windows::target_window_label(app) {
        labels.retain(|label| label != &target);
        labels.insert(0, target);
    }
    labels
}

#[cfg(test)]
mod tests {
    use super::{AppQuitState, QuitAdvance};

    #[test]
    fn app_quit_state_advances_windows_in_order() {
        let mut state = AppQuitState::default();
        assert_eq!(
            state.begin(vec!["main".to_string(), "main2".to_string()]),
            Some("main".to_string())
        );
        assert_eq!(
            state.advance_after_close("main"),
            QuitAdvance::Next("main2".to_string())
        );
        assert_eq!(state.advance_after_close("main2"), QuitAdvance::Complete);
    }

    #[test]
    fn app_quit_state_ignores_unrelated_closed_windows() {
        let mut state = AppQuitState::default();
        state.begin(vec!["main".to_string()]);
        assert_eq!(
            state.advance_after_close("other"),
            QuitAdvance::Next("main".to_string())
        );
        assert!(state.is_in_progress());
    }

    #[test]
    fn app_quit_state_can_be_cancelled() {
        let mut state = AppQuitState::default();
        state.begin(vec!["main".to_string()]);
        state.cancel();
        assert_eq!(state.advance_after_close("main"), QuitAdvance::Idle);
        assert!(!state.is_in_progress());
    }
}
