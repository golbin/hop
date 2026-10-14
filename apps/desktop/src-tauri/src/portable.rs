use std::path::Path;

pub(crate) fn is_portable() -> bool {
    cfg!(windows)
        && std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(has_portable_marker))
            .unwrap_or(false)
}

fn has_portable_marker(directory: &Path) -> bool {
    directory.join("hop-portable.json").is_file()
}

/// Select an optional app-local runtime before Tauri creates any webviews.
#[cfg(windows)]
pub(crate) fn configure_runtime() {
    if !is_portable() {
        return;
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            let runtime = directory.join("WebView2");
            if runtime.join("msedgewebview2.exe").is_file() {
                std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", runtime);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_marker_must_be_a_file_beside_the_executable() {
        let directory = tempfile::tempdir().unwrap();
        assert!(!has_portable_marker(directory.path()));
        let marker = directory.path().join("hop-portable.json");
        std::fs::create_dir(&marker).unwrap();
        assert!(!has_portable_marker(directory.path()));
        std::fs::remove_dir(&marker).unwrap();
        std::fs::write(marker, "{}").unwrap();
        assert!(has_portable_marker(directory.path()));
    }
}
