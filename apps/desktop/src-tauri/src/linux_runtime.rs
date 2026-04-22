use std::{
    env, fs,
    path::{Path, PathBuf},
};

const APPIMAGE_GTK_IM_MODULE_CACHE_CANDIDATES: &[&str] = &[
    "usr/lib/x86_64-linux-gnu/gtk-3.0/3.0.0/immodules.cache",
    "usr/lib64/gtk-3.0/3.0.0/immodules.cache",
    "usr/lib/gtk-3.0/3.0.0/immodules.cache",
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
    if has_explicit_im_module_cache_override() {
        return;
    }

    let Some(requested_module) = requested_gtk_im_module() else {
        return;
    };
    if active_cache_supports_module(&requested_module) {
        return;
    }
    let Some(cache_path) = find_host_im_module_cache(&requested_module) else {
        return;
    };

    env::set_var("GTK_IM_MODULE_FILE", &cache_path);
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

fn has_explicit_im_module_cache_override() -> bool {
    env::var_os("GTK_IM_MODULE_FILE").is_some()
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

fn active_cache_supports_module(requested_module: &str) -> bool {
    current_im_module_cache()
        .as_deref()
        .is_some_and(|path| cache_supports_module(path, requested_module))
}

fn current_im_module_cache() -> Option<PathBuf> {
    if let Some(path) = env::var_os("GTK_IM_MODULE_FILE") {
        return Some(PathBuf::from(path));
    }

    let appdir = env::var_os("APPDIR")?;
    APPIMAGE_GTK_IM_MODULE_CACHE_CANDIDATES
        .iter()
        .map(|relative| PathBuf::from(&appdir).join(relative))
        .find(|path| path.is_file())
}

fn cache_supports_module(path: &Path, requested_module: &str) -> bool {
    let Ok(contents) = fs::read_to_string(path) else {
        return false;
    };
    let needle = format!("\"{requested_module}\"");
    contents.contains(&needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvRestore {
        gtk_im_module_file: Option<std::ffi::OsString>,
        appdir: Option<std::ffi::OsString>,
    }

    impl EnvRestore {
        fn capture() -> Self {
            Self {
                gtk_im_module_file: env::var_os("GTK_IM_MODULE_FILE"),
                appdir: env::var_os("APPDIR"),
            }
        }
    }

    impl Drop for EnvRestore {
        fn drop(&mut self) {
            unsafe {
                match &self.gtk_im_module_file {
                    Some(value) => env::set_var("GTK_IM_MODULE_FILE", value),
                    None => env::remove_var("GTK_IM_MODULE_FILE"),
                }
                match &self.appdir {
                    Some(value) => env::set_var("APPDIR", value),
                    None => env::remove_var("APPDIR"),
                }
            }
        }
    }

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
    fn current_im_module_cache_prefers_explicit_env_override() {
        let _lock = ENV_LOCK.lock().unwrap();
        let _restore = EnvRestore::capture();
        let dir = tempfile::tempdir().unwrap();
        let cache_path = dir.path().join("immodules.cache");
        fs::write(&cache_path, "\"fcitx\"\n").unwrap();

        unsafe {
            env::set_var("GTK_IM_MODULE_FILE", &cache_path);
            env::remove_var("APPDIR");
        }

        assert_eq!(current_im_module_cache(), Some(cache_path));
        assert!(has_explicit_im_module_cache_override());
    }

    #[test]
    fn current_im_module_cache_falls_back_to_appdir_bundle_cache() {
        let _lock = ENV_LOCK.lock().unwrap();
        let _restore = EnvRestore::capture();
        let dir = tempfile::tempdir().unwrap();
        let cache_path = dir
            .path()
            .join("usr/lib/gtk-3.0/3.0.0/immodules.cache");
        fs::create_dir_all(cache_path.parent().unwrap()).unwrap();
        fs::write(&cache_path, "\"xim\"\n").unwrap();

        unsafe {
            env::remove_var("GTK_IM_MODULE_FILE");
            env::set_var("APPDIR", dir.path());
        }

        assert_eq!(current_im_module_cache(), Some(cache_path));
    }

    #[test]
    fn normalize_im_module_rejects_empty_values() {
        assert_eq!(normalize_im_module(" fcitx "), Some("fcitx".to_string()));
        assert_eq!(normalize_im_module("fcitx5"), Some("fcitx".to_string()));
        assert_eq!(normalize_im_module(""), None);
        assert_eq!(normalize_im_module("   "), None);
    }

    #[test]
    fn active_cache_supports_requested_module() {
        let _lock = ENV_LOCK.lock().unwrap();
        let _restore = EnvRestore::capture();
        let dir = tempfile::tempdir().unwrap();
        let cache_path = dir.path().join("immodules.cache");
        fs::write(&cache_path, "\"fcitx\"\n").unwrap();

        unsafe {
            env::set_var("GTK_IM_MODULE_FILE", &cache_path);
        }

        assert!(active_cache_supports_module("fcitx"));
        assert!(!active_cache_supports_module("ibus"));
    }
}
