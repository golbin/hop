use std::{
    env,
    ffi::OsString,
    sync::{Mutex, MutexGuard},
};

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvGuard {
    _restore: EnvRestore,
    _lock: MutexGuard<'static, ()>,
}

struct EnvRestore {
    gtk_im_module_file: Option<OsString>,
    gtk_im_module: Option<OsString>,
    gtk_path: Option<OsString>,
    qt_im_module: Option<OsString>,
    sdl_im_module: Option<OsString>,
    input_method: Option<OsString>,
    xmodifiers: Option<OsString>,
    appdir: Option<OsString>,
    webkit_disable_dmabuf_renderer: Option<OsString>,
    webkit_disable_compositing_mode: Option<OsString>,
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
            webkit_disable_dmabuf_renderer: env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER"),
            webkit_disable_compositing_mode: env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE"),
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
            restore_env(
                "WEBKIT_DISABLE_DMABUF_RENDERER",
                &self.webkit_disable_dmabuf_renderer,
            );
            restore_env(
                "WEBKIT_DISABLE_COMPOSITING_MODE",
                &self.webkit_disable_compositing_mode,
            );
        }
    }
}

unsafe fn restore_env(name: &str, value: &Option<OsString>) {
    match value {
        Some(value) => env::set_var(name, value),
        None => env::remove_var(name),
    }
}

fn env_guard() -> EnvGuard {
    let lock = ENV_LOCK.lock().unwrap();
    let restore = EnvRestore::capture();
    EnvGuard {
        _restore: restore,
        _lock: lock,
    }
}

#[path = "linux_runtime_tests/graphics.rs"]
mod graphics;
#[path = "linux_runtime_tests/ime.rs"]
mod ime;
