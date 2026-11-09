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

const ENV_NAMES: &[&str] = &[
    "GTK_IM_MODULE_FILE",
    "GTK_IM_MODULE",
    "GTK_PATH",
    "QT_IM_MODULE",
    "SDL_IM_MODULE",
    "INPUT_METHOD",
    "XMODIFIERS",
    "APPDIR",
    "APPIMAGE",
    "WAYLAND_DISPLAY",
    "XDG_SESSION_TYPE",
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
    "DISPLAY",
    "XDG_CURRENT_DESKTOP",
    "GDK_BACKEND",
];

struct EnvRestore(Vec<(&'static str, Option<OsString>)>);

impl EnvRestore {
    fn capture() -> Self {
        Self(
            ENV_NAMES
                .iter()
                .map(|&name| (name, env::var_os(name)))
                .collect(),
        )
    }
}

impl Drop for EnvRestore {
    fn drop(&mut self) {
        for (name, value) in &self.0 {
            unsafe {
                restore_env(name, value);
            }
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
