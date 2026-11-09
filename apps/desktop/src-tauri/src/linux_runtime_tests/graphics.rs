use super::super::*;
use super::env_guard;
use std::{env, ffi::OsString};

#[test]
fn arch_like_os_release_requires_webkit_graphics_fallback() {
    let _env = env_guard();

    assert!(needs_webkit_graphics_fallback(Some(
        "ID=cachyos\nID_LIKE=\"arch linux\"\n",
    )));
    assert!(needs_webkit_graphics_fallback(Some("ID_LIKE=archlinux\n")));
}

#[test]
fn fedora_like_os_release_requires_webkit_graphics_fallback() {
    let _env = env_guard();

    unsafe {
        env::set_var("XDG_SESSION_TYPE", "wayland");
        env::remove_var("WAYLAND_DISPLAY");
    }

    assert!(needs_webkit_graphics_fallback(Some("ID=fedora\n")));
    assert!(needs_webkit_graphics_fallback(Some(
        "ID_LIKE=\"rhel fedora\"\n"
    )));
}

#[test]
fn fedora_like_os_release_without_wayland_skips_webkit_graphics_fallback() {
    let _env = env_guard();

    unsafe {
        env::set_var("XDG_SESSION_TYPE", "x11");
        env::remove_var("WAYLAND_DISPLAY");
    }

    assert!(!needs_webkit_graphics_fallback(Some("ID=fedora\n")));
}

#[test]
fn empty_wayland_display_does_not_mark_session_as_wayland() {
    let _env = env_guard();

    unsafe {
        env::set_var("WAYLAND_DISPLAY", "");
        env::remove_var("XDG_SESSION_TYPE");
    }

    assert!(!needs_webkit_graphics_fallback(Some("ID=fedora\n")));
}

#[test]
fn unrelated_os_release_skips_webkit_graphics_fallback() {
    let _env = env_guard();

    assert!(!needs_webkit_graphics_fallback(Some(
        "ID=ubuntu\nID_LIKE=debian\n"
    )));
}

#[test]
fn webkit_graphics_fallback_sets_missing_environment_values() {
    let _env = env_guard();

    unsafe {
        env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
        env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
    }

    apply_webkit_graphics_fallbacks(Some("ID=cachyos\nID_LIKE=arch\n"));

    assert_eq!(
        env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER"),
        Some(OsString::from("1"))
    );
    assert_eq!(
        env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE"),
        Some(OsString::from("1"))
    );
}

#[test]
fn linux_runtime_fixes_apply_graphics_fallback_without_appimage() {
    let _env = env_guard();

    unsafe {
        env::remove_var("APPDIR");
        env::remove_var("APPIMAGE");
        env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
        env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
        env::set_var("WAYLAND_DISPLAY", "wayland-0");
    }

    apply_linux_runtime_fixes_for_os_release(Some("ID=fedora\n"));

    assert_eq!(
        env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER"),
        Some(OsString::from("1"))
    );
    assert_eq!(
        env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE"),
        Some(OsString::from("1"))
    );
}

#[test]
fn webkit_graphics_fallback_preserves_user_overrides() {
    let _env = env_guard();

    unsafe {
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "0");
        env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "0");
    }

    apply_webkit_graphics_fallbacks(Some("ID=cachyos\n"));

    assert_eq!(
        env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER"),
        Some(OsString::from("0"))
    );
    assert_eq!(
        env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE"),
        Some(OsString::from("0"))
    );
}

#[test]
fn kde_wayland_uses_xwayland_when_available_and_preserves_user_choice() {
    let _env = env_guard();
    unsafe {
        env::remove_var("APPDIR");
        env::remove_var("APPIMAGE");
    }
    for (session, desktop, display, backend, expected) in [
        ("wayland", "KDE", Some(":0"), None, Some("x11")),
        ("wayland", "other:kde", Some(":0"), None, Some("x11")),
        ("wayland", "GNOME", Some(":0"), None, None),
        ("x11", "KDE", Some(":0"), None, None),
        ("wayland", "KDE", None, None, None),
        (
            "wayland",
            "KDE",
            Some(":0"),
            Some("wayland"),
            Some("wayland"),
        ),
        ("wayland", "KDE", Some(":0"), Some(""), Some("")),
    ] {
        unsafe {
            env::remove_var("WAYLAND_DISPLAY");
            env::set_var("XDG_SESSION_TYPE", session);
            env::set_var("XDG_CURRENT_DESKTOP", desktop);
            super::restore_env("DISPLAY", &display.map(OsString::from));
            super::restore_env("GDK_BACKEND", &backend.map(OsString::from));
        }
        apply_display_backend_fallback();
        assert_eq!(env::var_os("GDK_BACKEND"), expected.map(OsString::from));
    }
}

#[test]
fn native_packages_also_apply_kde_wayland_fallback() {
    let _env = env_guard();
    unsafe {
        env::remove_var("APPDIR");
        env::remove_var("APPIMAGE");
        env::remove_var("GDK_BACKEND");
        env::set_var("WAYLAND_DISPLAY", "wayland-0");
        env::set_var("DISPLAY", ":0");
        env::set_var("XDG_CURRENT_DESKTOP", "KDE");
    }
    apply_linux_runtime_fixes_for_os_release(Some("ID=ubuntu\n"));
    assert_eq!(env::var_os("GDK_BACKEND"), Some(OsString::from("x11")));
}

#[test]
fn appimage_preserves_x11_default_but_allows_native_wayland() {
    let _env = env_guard();
    unsafe {
        env::set_var("APPIMAGE", "/tmp/HOP.AppImage");
        env::set_var("DISPLAY", ":0");
        env::set_var("XDG_CURRENT_DESKTOP", "GNOME");
        env::set_var("WAYLAND_DISPLAY", "wayland-0");
        env::remove_var("GDK_BACKEND");
    }
    apply_display_backend_fallback();
    assert_eq!(env::var_os("GDK_BACKEND"), Some(OsString::from("x11")));
    unsafe {
        env::set_var("GDK_BACKEND", "wayland");
    }
    apply_display_backend_fallback();
    assert_eq!(env::var_os("GDK_BACKEND"), Some(OsString::from("wayland")));
    unsafe {
        env::remove_var("DISPLAY");
        env::remove_var("GDK_BACKEND");
    }
    apply_display_backend_fallback();
    assert!(env::var_os("GDK_BACKEND").is_none());
}
