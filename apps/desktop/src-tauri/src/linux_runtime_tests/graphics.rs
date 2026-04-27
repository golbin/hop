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
fn non_arch_os_release_skips_webkit_graphics_fallback() {
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
