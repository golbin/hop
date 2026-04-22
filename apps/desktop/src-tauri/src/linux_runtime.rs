use std::{
    collections::BTreeSet,
    env,
    fs,
    path::{Path, PathBuf},
};

const HOST_GTK_DIR_CANDIDATES: &[&str] = &[
    "/usr/lib/x86_64-linux-gnu/gtk-3.0",
    "/usr/lib64/gtk-3.0",
    "/usr/lib/gtk-3.0",
];

const HOST_GTK_IM_MODULE_CACHE_CANDIDATES: &[&str] = &[
    "/usr/lib/x86_64-linux-gnu/gtk-3.0/3.0.0/immodules.cache",
    "/usr/lib64/gtk-3.0/3.0.0/immodules.cache",
    "/usr/lib/gtk-3.0/3.0.0/immodules.cache",
];

pub fn apply_linux_appimage_runtime_fixes() {
    if !is_appimage_runtime() {
        return;
    }

    let Some(requested_module) = requested_gtk_im_module() else {
        return;
    };
    let Some(cache_path) = find_host_im_module_cache(&requested_module) else {
        return;
    };

    env::set_var("GTK_IM_MODULE_FILE", &cache_path);
    if let Some(gtk_path) =
        merged_gtk_path(env::var_os("GTK_PATH").as_deref(), HOST_GTK_DIR_CANDIDATES)
    {
        env::set_var("GTK_PATH", gtk_path);
    }
}

fn is_appimage_runtime() -> bool {
    env::var_os("APPIMAGE").is_some() || env::var_os("APPDIR").is_some()
}

fn requested_gtk_im_module() -> Option<String> {
    env::var("GTK_IM_MODULE")
        .ok()
        .and_then(|value| normalize_im_module(value.trim()))
        .or_else(|| {
            env::var("XMODIFIERS")
                .ok()
                .and_then(|value| value.split("@im=").nth(1))
                .and_then(normalize_im_module)
        })
}

fn normalize_im_module(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        None
    } else if normalized == "fcitx5" {
        Some("fcitx".to_string())
    } else {
        Some(normalized)
    }
}

fn find_host_im_module_cache(requested_module: &str) -> Option<PathBuf> {
    HOST_GTK_IM_MODULE_CACHE_CANDIDATES
        .iter()
        .map(Path::new)
        .find(|path| cache_supports_module(path, requested_module))
        .map(Path::to_path_buf)
}

fn cache_supports_module(path: &Path, requested_module: &str) -> bool {
    let Ok(contents) = fs::read_to_string(path) else {
        return false;
    };
    let needle = format!("\"{requested_module}\"");
    contents.contains(&needle)
}

fn merged_gtk_path(current: Option<&std::ffi::OsStr>, host_dirs: &[&str]) -> Option<String> {
    let mut values = Vec::new();
    let mut seen = BTreeSet::new();

    for dir in host_dirs {
        if seen.insert((*dir).to_string()) {
            values.push((*dir).to_string());
        }
    }

    if let Some(current) = current.and_then(|value| value.to_str()) {
        for segment in current.split(':').filter(|segment| !segment.is_empty()) {
            if seen.insert(segment.to_string()) {
                values.push(segment.to_string());
            }
        }
    }

    if values.is_empty() {
        None
    } else {
        Some(values.join(":"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_supports_requested_input_method() {
        let dir = tempfile::tempdir().unwrap();
        let cache_path = dir.path().join("immodules.cache");
        fs::write(&cache_path, "\"fcitx\"\n\"ibus\"\n").unwrap();

        assert!(cache_supports_module(&cache_path, "fcitx"));
        assert!(cache_supports_module(&cache_path, "ibus"));
        assert!(!cache_supports_module(&cache_path, "xim"));
    }

    #[test]
    fn merged_gtk_path_prefers_host_directories_without_duplicates() {
        let path = merged_gtk_path(
            Some(std::ffi::OsStr::new(
                "/usr/lib64/gtk-3.0:/opt/hop/gtk-3.0:/usr/lib/gtk-3.0",
            )),
            HOST_GTK_DIR_CANDIDATES,
        )
        .unwrap();

        assert_eq!(
            path,
            "/usr/lib/x86_64-linux-gnu/gtk-3.0:/usr/lib64/gtk-3.0:/usr/lib/gtk-3.0:/opt/hop/gtk-3.0"
        );
    }

    #[test]
    fn normalize_im_module_rejects_empty_values() {
        assert_eq!(normalize_im_module(" fcitx "), Some("fcitx".to_string()));
        assert_eq!(normalize_im_module("fcitx5"), Some("fcitx".to_string()));
        assert_eq!(normalize_im_module(""), None);
        assert_eq!(normalize_im_module("   "), None);
    }
}
