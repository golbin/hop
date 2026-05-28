use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(not(debug_assertions))]
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::state::AppState;

const UPDATE_STATE_EVENT: &str = "hop-update-state";

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum UpdateNoticeState {
    #[default]
    Idle,
    Available {
        version: String,
    },
    Downloading {
        version: String,
        #[serde(rename = "downloadedBytes")]
        downloaded_bytes: u64,
        #[serde(rename = "totalBytes")]
        total_bytes: Option<u64>,
    },
    Ready {
        version: String,
    },
    Error {
        version: String,
        message: String,
    },
}

#[derive(Default)]
pub struct UpdateManagerState {
    notice: UpdateNoticeState,
    #[cfg(not(debug_assertions))]
    pending_update: Option<Update>,
}

impl UpdateManagerState {
    pub fn current_notice(&self) -> UpdateNoticeState {
        self.notice.clone()
    }

    #[cfg(not(debug_assertions))]
    fn set_available(&mut self, update: Update) {
        self.notice = UpdateNoticeState::Available {
            version: update.version.clone(),
        };
        self.pending_update = Some(update);
    }

    #[cfg(not(debug_assertions))]
    fn begin_install(&mut self) -> Result<(Update, String), String> {
        let version = match &self.notice {
            UpdateNoticeState::Available { version } | UpdateNoticeState::Error { version, .. } => {
                version.clone()
            }
            UpdateNoticeState::Idle => {
                return Err("새 업데이트가 준비되지 않았습니다.".to_string());
            }
            UpdateNoticeState::Downloading { .. } => {
                return Err("업데이트를 이미 준비하고 있습니다.".to_string());
            }
            UpdateNoticeState::Ready { .. } => {
                return Err("업데이트가 이미 준비되었습니다. 다시 시작해서 적용하세요.".to_string());
            }
        };

        let update = self
            .pending_update
            .take()
            .ok_or_else(|| "업데이트 준비 정보가 없어 다시 확인이 필요합니다.".to_string())?;

        self.notice = UpdateNoticeState::Downloading {
            version: version.clone(),
            downloaded_bytes: 0,
            total_bytes: None,
        };

        Ok((update, version))
    }

    #[cfg(not(debug_assertions))]
    fn update_download_progress(&mut self, version: &str, downloaded: u64, total: Option<u64>) {
        self.notice = UpdateNoticeState::Downloading {
            version: version.to_string(),
            downloaded_bytes: downloaded,
            total_bytes: total,
        };
    }

    #[cfg(not(debug_assertions))]
    fn set_ready(&mut self, version: &str) {
        self.notice = UpdateNoticeState::Ready {
            version: version.to_string(),
        };
    }

    #[cfg(not(debug_assertions))]
    fn set_retryable_error(&mut self, update: Update, version: &str, message: String) {
        self.pending_update = Some(update);
        self.notice = UpdateNoticeState::Error {
            version: version.to_string(),
            message,
        };
    }
}

pub fn install_startup_update_check(app: &AppHandle) {
    let _ = app;
}

#[cfg(not(debug_assertions))]
async fn discover_update(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };

    if let Ok(mut updater) = app.state::<AppState>().updater.lock() {
        updater.set_available(update);
    }

    emit_update_state(&app);
    Ok(())
}

#[tauri::command]
pub fn get_update_state(app: AppHandle) -> Result<UpdateNoticeState, String> {
    Ok(app
        .state::<AppState>()
        .updater
        .lock()
        .map_err(|_| "업데이트 상태 잠금 실패".to_string())?
        .current_notice())
}

#[tauri::command]
pub fn start_update_install(app: AppHandle) -> Result<(), String> {
    if has_dirty_documents(&app) {
        return Err(
            "저장되지 않은 변경사항이 있어 지금은 업데이트할 수 없습니다. 저장 후 다시 시도하세요."
                .to_string(),
        );
    }

    #[cfg(debug_assertions)]
    {
        let _ = app;
        Err("업데이트 설치는 릴리즈 빌드에서만 사용할 수 있습니다.".to_string())
    }

    #[cfg(not(debug_assertions))]
    {
        let (update, info) = {
            let state = app.state::<AppState>();
            let mut updater = state
                .updater
                .lock()
                .map_err(|_| "업데이트 상태 잠금 실패".to_string())?;
            updater.begin_install()?
        };

        emit_update_state(&app);

        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            run_update_install(app_handle, update, info).await;
        });

        Ok(())
    }
}

#[cfg(not(debug_assertions))]
async fn run_update_install(app: AppHandle, update: Update, version: String) {
    let mut downloaded = 0_u64;
    let bytes = match update
        .download(
            |chunk_len, total| {
                downloaded = downloaded.saturating_add(chunk_len as u64);
                if let Ok(mut updater) = app.state::<AppState>().updater.lock() {
                    updater.update_download_progress(&version, downloaded, total);
                }
                emit_update_state(&app);
            },
            || {},
        )
        .await
    {
        Ok(bytes) => bytes,
        Err(error) => {
            restore_update_error(
                &app,
                update,
                &version,
                format_retryable_error(
                    "업데이트 다운로드에 실패했습니다. 네트워크를 확인하고 다시 시도하세요.",
                    &error,
                ),
            );
            return;
        }
    };

    if has_dirty_documents(&app) {
        restore_update_error(
            &app,
            update,
            &version,
            "업데이트를 준비하는 동안 저장되지 않은 변경사항이 생겨 적용을 보류했습니다. 저장 후 다시 시도하세요."
                .to_string(),
        );
        return;
    }

    if let Err(error) = update.install(bytes) {
        restore_update_error(
            &app,
            update,
            &version,
            format_retryable_error("업데이트 설치에 실패했습니다. 다시 시도하세요.", &error),
        );
        return;
    }

    if let Ok(mut updater) = app.state::<AppState>().updater.lock() {
        updater.set_ready(&version);
    }
    emit_update_state(&app);
}

#[cfg(not(debug_assertions))]
fn restore_update_error(app: &AppHandle, update: Update, version: &str, message: String) {
    if let Ok(mut updater) = app.state::<AppState>().updater.lock() {
        updater.set_retryable_error(update, version, message);
    }
    emit_update_state(app);
}

#[tauri::command]
pub fn restart_to_apply_update(app: AppHandle) -> Result<(), String> {
    let ready = {
        let state = app.state::<AppState>();
        let updater = state
            .updater
            .lock()
            .map_err(|_| "업데이트 상태 잠금 실패".to_string())?;
        matches!(updater.current_notice(), UpdateNoticeState::Ready { .. })
    };

    if !ready {
        return Err("적용할 업데이트가 아직 준비되지 않았습니다.".to_string());
    }

    if has_dirty_documents(&app) {
        return Err(
            "저장되지 않은 변경사항이 있어 다시 시작할 수 없습니다. 저장 후 다시 시도하세요."
                .to_string(),
        );
    }

    app.restart();
}

#[allow(dead_code)]
fn emit_update_state(app: &AppHandle) {
    let payload = match app.state::<AppState>().updater.lock() {
        Ok(updater) => updater.current_notice(),
        Err(_) => UpdateNoticeState::Idle,
    };

    let _ = app.emit(UPDATE_STATE_EVENT, payload);
}

fn has_dirty_documents(app: &AppHandle) -> bool {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        false
    }

    #[cfg(not(debug_assertions))]
    {
        app.state::<AppState>()
            .sessions
            .lock()
            .map(|sessions| sessions.has_dirty_sessions())
            .unwrap_or(true)
    }
}

#[cfg(not(debug_assertions))]
fn format_retryable_error(fallback: &str, error: &tauri_plugin_updater::Error) -> String {
    let detail = error.to_string();
    if detail.trim().is_empty() {
        return fallback.to_string();
    }
    format!("{fallback}\n{detail}")
}
