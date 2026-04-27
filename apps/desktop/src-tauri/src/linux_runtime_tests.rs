use super::*;
use std::sync::Mutex;

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvRestore {
    gtk_im_module_file: Option<std::ffi::OsString>,
    gtk_im_module: Option<std::ffi::OsString>,
    gtk_path: Option<std::ffi::OsString>,
    qt_im_module: Option<std::ffi::OsString>,
    sdl_im_module: Option<std::ffi::OsString>,
    input_method: Option<std::ffi::OsString>,
    xmodifiers: Option<std::ffi::OsString>,
    appdir: Option<std::ffi::OsString>,
}

impl EnvRestore {
    fn capture() -> Self {
        Self {
            gtk_im_module_file: env::var_os("GTK_IM_MODULE_FILE"),
            gtk_im_module: env::var_os("GTK_IM_MODULE"),
            gtk_path: env::var_os("GTK_PATH"),
            qt_im_module: env::var_os("QT_IM_MODULE"),
            sdl_im_module: env::var_os("SDL_IM_MODULE"),
            input_method: env::var_os("INPUT_METHOD"),
            xmodifiers: env::var_os("XMODIFIERS"),
            appdir: env::var_os("APPDIR"),
        }
    }
}

impl Drop for EnvRestore {
    fn drop(&mut self) {
        unsafe {
            restore_env("GTK_IM_MODULE_FILE", &self.gtk_im_module_file);
            restore_env("GTK_IM_MODULE", &self.gtk_im_module);
            restore_env("GTK_PATH", &self.gtk_path);
            restore_env("QT_IM_MODULE", &self.qt_im_module);
            restore_env("SDL_IM_MODULE", &self.sdl_im_module);
            restore_env("INPUT_METHOD", &self.input_method);
            restore_env("XMODIFIERS", &self.xmodifiers);
            restore_env("APPDIR", &self.appdir);
        }
    }
}

unsafe fn restore_env(name: &str, value: &Option<std::ffi::OsString>) {
    match value {
        Some(value) => env::set_var(name, value),
        None => env::remove_var(name),
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
    assert!(has_user_im_module_cache_override());
}

#[test]
fn appimage_owned_cache_is_not_user_override() {
    let _lock = ENV_LOCK.lock().unwrap();
    let _restore = EnvRestore::capture();
    let dir = tempfile::tempdir().unwrap();
    let cache_path = dir.path().join("usr/lib/gtk-3.0/3.0.0/immodules.cache");
    fs::create_dir_all(cache_path.parent().unwrap()).unwrap();
    fs::write(&cache_path, "\"xim\"\n").unwrap();

    unsafe {
        env::set_var("APPDIR", dir.path());
        env::set_var("GTK_IM_MODULE_FILE", &cache_path);
    }

    assert!(is_appimage_owned_path(&cache_path));
    assert!(!has_user_im_module_cache_override());
}

#[test]
fn current_im_module_cache_falls_back_to_appdir_bundle_cache() {
    let _lock = ENV_LOCK.lock().unwrap();
    let _restore = EnvRestore::capture();
    let dir = tempfile::tempdir().unwrap();
    let cache_path = dir.path().join("usr/lib/gtk-3.0/3.0.0/immodules.cache");
    fs::create_dir_all(cache_path.parent().unwrap()).unwrap();
    fs::write(&cache_path, "\"xim\"\n").unwrap();

    unsafe {
        env::remove_var("GTK_IM_MODULE_FILE");
        env::set_var("APPDIR", dir.path());
    }

    assert_eq!(current_im_module_cache(), Some(cache_path));
}

#[test]
fn normalize_im_module_handles_common_values() {
    assert_eq!(normalize_im_module(" fcitx "), Some("fcitx".to_string()));
    assert_eq!(normalize_im_module("fcitx5"), Some("fcitx".to_string()));
    assert_eq!(normalize_im_module("\"kime\""), Some("kime".to_string()));
    assert_eq!(normalize_im_module("none"), None);
    assert_eq!(normalize_im_module(""), None);
    assert_eq!(normalize_im_module("   "), None);
}

#[test]
fn requested_im_module_falls_back_to_xmodifiers() {
    let _lock = ENV_LOCK.lock().unwrap();
    let _restore = EnvRestore::capture();

    unsafe {
        env::remove_var("GTK_IM_MODULE");
        env::remove_var("QT_IM_MODULE");
        env::set_var("XMODIFIERS", "@im=fcitx5;foo=bar");
    }

    assert_eq!(requested_gtk_im_module(), Some("fcitx".to_string()));
}

#[test]
fn requested_im_module_falls_back_to_qt_module() {
    let _lock = ENV_LOCK.lock().unwrap();
    let _restore = EnvRestore::capture();

    unsafe {
        env::remove_var("GTK_IM_MODULE");
        env::remove_var("XMODIFIERS");
        env::set_var("QT_IM_MODULE", "kime");
    }

    assert_eq!(requested_gtk_im_module(), Some("kime".to_string()));
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

#[test]
fn im_module_cache_selects_requested_module() {
    let dir = tempfile::tempdir().unwrap();
    let kime_cache = dir.path().join("kime.cache");
    let ibus_cache = dir.path().join("ibus.cache");
    fs::write(&kime_cache, "\"kime\"\n").unwrap();
    fs::write(&ibus_cache, "\"ibus\"\n").unwrap();
    let candidates = vec![kime_cache.clone(), ibus_cache];

    assert_eq!(find_im_module_cache(&candidates, "kime"), Some(kime_cache));
    assert_eq!(find_im_module_cache(&candidates, "fcitx"), None);
}

#[test]
fn gtk_path_candidates_include_root_for_arch_cache_layout() {
    let cache_path = Path::new("/usr/lib/gtk-3.0/3.0.0/immodules.cache");

    assert_eq!(
        gtk_path_root_for_cache(cache_path),
        Some(PathBuf::from("/usr/lib/gtk-3.0"))
    );
}

#[test]
fn merged_gtk_path_prefers_host_directories_without_duplicates() {
    let host_dirs = vec![
        PathBuf::from("/usr/lib/gtk-3.0"),
        PathBuf::from("/usr/lib64/gtk-3.0"),
    ];
    let path = merged_gtk_paths(
        Some(OsStr::new(
            "/usr/lib64/gtk-3.0:/opt/hop/gtk-3.0:/usr/lib/gtk-3.0",
        )),
        &host_dirs,
    )
    .unwrap();

    assert_eq!(
        path,
        OsString::from("/usr/lib/gtk-3.0:/usr/lib64/gtk-3.0:/opt/hop/gtk-3.0")
    );
}

#[test]
fn appimage_owned_cache_is_replaced_with_matching_host_cache() {
    let _lock = ENV_LOCK.lock().unwrap();
    let _restore = EnvRestore::capture();
    let appdir = tempfile::tempdir().unwrap();
    let host = tempfile::tempdir().unwrap();
    let bundled_cache = appdir.path().join("usr/lib/gtk-3.0/3.0.0/immodules.cache");
    let host_cache = host.path().join("gtk-3.0/3.0.0/immodules.cache");
    fs::create_dir_all(bundled_cache.parent().unwrap()).unwrap();
    fs::create_dir_all(host_cache.parent().unwrap()).unwrap();
    fs::write(&bundled_cache, "\"xim\"\n\"wayland\"\n").unwrap();
    fs::write(&host_cache, "\"fcitx\"\n").unwrap();

    unsafe {
        env::set_var("APPDIR", appdir.path());
        env::set_var("GTK_IM_MODULE_FILE", &bundled_cache);
        env::remove_var("GTK_IM_MODULE");
        env::set_var("XMODIFIERS", "@im=fcitx5;foo=bar");
        env::set_var("GTK_PATH", "/opt/hop/gtk-3.0");
    }

    apply_appimage_runtime_fixes_with_host_caches(&[host_cache.clone()]);

    assert_eq!(
        env::var_os("GTK_IM_MODULE_FILE"),
        Some(host_cache.as_os_str().to_os_string())
    );
    assert_eq!(env::var_os("GTK_IM_MODULE"), Some(OsString::from("fcitx")));
    assert_eq!(
        env::var_os("GTK_PATH"),
        Some(OsString::from(format!(
            "{}:/usr/lib/x86_64-linux-gnu/gtk-3.0:/usr/lib64/gtk-3.0:/usr/lib/gtk-3.0:/opt/hop/gtk-3.0",
            host.path().join("gtk-3.0").display()
        )))
    );
}

#[test]
fn user_cache_override_is_preserved_while_requested_module_is_normalized() {
    let _lock = ENV_LOCK.lock().unwrap();
    let _restore = EnvRestore::capture();
    let appdir = tempfile::tempdir().unwrap();
    let user_cache_dir = tempfile::tempdir().unwrap();
    let user_cache = user_cache_dir.path().join("immodules.cache");
    fs::write(&user_cache, "\"fcitx\"\n").unwrap();

    unsafe {
        env::set_var("APPDIR", appdir.path());
        env::set_var("GTK_IM_MODULE_FILE", &user_cache);
        env::set_var("QT_IM_MODULE", "fcitx5");
        env::remove_var("GTK_IM_MODULE");
    }

    apply_appimage_runtime_fixes_with_host_caches(&[]);

    assert_eq!(
        env::var_os("GTK_IM_MODULE_FILE"),
        Some(user_cache.as_os_str().to_os_string())
    );
    assert_eq!(env::var_os("GTK_IM_MODULE"), Some(OsString::from("fcitx")));
}
