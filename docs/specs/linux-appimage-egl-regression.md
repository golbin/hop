# Linux AppImage EGL Regression 1-Pager

## Background

Issue #22 reports that the Linux AppImage starts on an Arch-based CachyOS system but never shows a usable window. The terminal log ends with `Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...`.

## Problem

This is a known WebKitGTK/Tauri AppImage failure mode on rolling Linux desktops and Arch-like systems. The current AppImage runtime fix only repairs GTK input-method cache selection; it does not change WebKitGTK's graphics path, so the reported EGL failure can still occur.

## Goal

Avoid the broken AppImage WebKitGTK EGL path for the affected Linux runtime class while preserving normal behavior on non-AppImage installs.

## Non-goals

Do not modify `third_party/rhwp`. Do not change deb/rpm behavior. Do not force a user's explicit WebKit rendering environment choices.

## Constraints

Keep the fix Linux-only, AppImage-only, and scoped to Arch-like hosts matching the reported issue. Prefer environment-level mitigation because WebKitGTK subprocesses inherit these values when Tauri starts. Avoid distro-specific shell assumptions.

## Implementation outline

In the Linux AppImage runtime hook, detect Arch-like hosts from `/etc/os-release`. For those cases, set `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `WEBKIT_DISABLE_COMPOSITING_MODE=1` only when the user has not already provided those variables.

## Verification plan

Add Rust unit tests covering CachyOS/Arch detection, non-Arch no-op behavior, and user override preservation. Run the focused desktop Rust tests.

## Rollback

Remove the WebKit graphics fallback block from `apps/desktop/src-tauri/src/linux_runtime.rs`; AppImage IME cache behavior remains independent.
