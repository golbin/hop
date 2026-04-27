use std::{
    env,
    ffi::{OsStr, OsString},
    fs,
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

const HOST_GTK_DIR_CANDIDATES: &[&str] = &[
    "/usr/lib/x86_64-linux-gnu/gtk-3.0",
    "/usr/lib64/gtk-3.0",
    "/usr/lib/gtk-3.0",
];

const GTK_IM_MODULE_FALLBACK_ENV: &[&str] = &["QT_IM_MODULE", "SDL_IM_MODULE", "INPUT_METHOD"];

pub fn apply_linux_appimage_runtime_fixes() {
    if !is_appimage_runtime() {
        return;
    }

    let host_cache_candidates = host_cache_candidate_paths();
    apply_appimage_runtime_fixes_with_host_caches(&host_cache_candidates);
}

fn apply_appimage_runtime_fixes_with_host_caches(host_cache_candidates: &[PathBuf]) {
    let requested_module = requested_gtk_im_module();
    if has_user_im_module_cache_override() {
        if let Some(module) = requested_module.as_deref() {
            ensure_gtk_im_module(module);
        }
        return;
    }

    if let Some(module) = requested_module.as_deref() {
        if active_cache_supports_module(module) {
            ensure_gtk_im_module(module);
            return;
        }

        if let Some(cache_path) = find_im_module_cache(host_cache_candidates, module) {
            apply_host_im_module_cache(&cache_path);
            ensure_gtk_im_module(module);
            return;
        }
    }
}

fn is_appimage_runtime() -> bool {
    env::var_os("APPIMAGE").is_some() || env::var_os("APPDIR").is_some()
}

fn requested_gtk_im_module() -> Option<String> {
    env_im_module("GTK_IM_MODULE")
        .or_else(requested_xim_module)
        .or_else(|| {
            GTK_IM_MODULE_FALLBACK_ENV
                .iter()
                .find_map(|name| env_im_module(name))
        })
}

fn env_im_module(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .and_then(|value| normalize_im_module(&value))
}

fn requested_xim_module() -> Option<String> {
    env::var("XMODIFIERS").ok().and_then(|value| {
        let (_, module) = value.split_once("@im=")?;
        let module = module
            .split(|ch: char| ch == ';' || ch.is_whitespace())
            .next()
            .unwrap_or(module);
        normalize_im_module(module)
    })
}

fn has_user_im_module_cache_override() -> bool {
    current_im_module_cache()
        .as_deref()
        .is_some_and(|path| !is_appimage_owned_path(path))
}

fn is_appimage_owned_path(path: &Path) -> bool {
    env::var_os("APPDIR")
        .map(PathBuf::from)
        .is_some_and(|appdir| path.starts_with(appdir))
}

fn normalize_im_module(value: &str) -> Option<String> {
    let normalized = value.trim().trim_matches('"').trim().to_ascii_lowercase();

    match normalized.as_str() {
        "" | "none" | "simple" | "gtk-im-context-simple" => None,
        "fcitx5" => Some("fcitx".to_string()),
        _ => Some(normalized),
    }
}

fn host_cache_candidate_paths() -> Vec<PathBuf> {
    HOST_GTK_IM_MODULE_CACHE_CANDIDATES
        .iter()
        .map(PathBuf::from)
        .collect()
}

fn find_im_module_cache(candidates: &[PathBuf], requested_module: &str) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|path| cache_supports_module(path, requested_module))
        .cloned()
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

fn apply_host_im_module_cache(cache_path: &Path) {
    env::set_var("GTK_IM_MODULE_FILE", cache_path);
    if let Some(gtk_path) = merged_gtk_paths(
        env::var_os("GTK_PATH").as_deref(),
        &host_gtk_path_candidates_for_cache(cache_path),
    ) {
        env::set_var("GTK_PATH", gtk_path);
    }
}

fn ensure_gtk_im_module(module: &str) {
    if matches!(module, "xim" | "wayland" | "waylandgtk" | "broadway") {
        return;
    }

    if env_im_module("GTK_IM_MODULE").as_deref() != Some(module) {
        env::set_var("GTK_IM_MODULE", module);
    }
}

fn host_gtk_path_candidates_for_cache(cache_path: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(root) = gtk_path_root_for_cache(cache_path) {
        push_unique_path(&mut paths, root);
    }
    for candidate in HOST_GTK_DIR_CANDIDATES {
        push_unique_path(&mut paths, PathBuf::from(candidate));
    }
    paths
}

fn gtk_path_root_for_cache(cache_path: &Path) -> Option<PathBuf> {
    cache_path.parent()?.parent().map(Path::to_path_buf)
}

fn merged_gtk_paths(current: Option<&OsStr>, host_dirs: &[PathBuf]) -> Option<OsString> {
    let mut values = Vec::new();
    for dir in host_dirs {
        push_unique_path(&mut values, dir.clone());
    }

    if let Some(current) = current {
        for segment in env::split_paths(current) {
            push_unique_path(&mut values, segment);
        }
    }

    if values.is_empty() {
        None
    } else {
        env::join_paths(values).ok()
    }
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if path.as_os_str().is_empty() || paths.iter().any(|existing| existing == &path) {
        return;
    }
    paths.push(path);
}

#[cfg(test)]
mod linux_runtime_tests;
