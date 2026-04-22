# Linux AppImage IME And Canvas Blur 1-Pager

## Background

HOP ships Linux desktop artifacts as AppImage, `.deb`, and `.rpm`. Issue `#7` reports that the AppImage build fails to switch Hangul input under `fcitx5` on Linux while a converted Debian package works, and that document text looks blurry at some zoom levels.

## Problem

- The AppImage runtime bundles GTK input module metadata that does not include common host IME modules such as `fcitx` and `ibus`.
- The studio host centers page canvases with CSS transforms, which can place the rendered canvas on half-pixel boundaries and make the whole document look soft at specific zoom ratios.

## Goal

- Make AppImage prefer a host GTK IM module cache when the bundled cache cannot satisfy the requested input method.
- Remove transform-based page centering so document canvases land on stable integer coordinates.

## Non-goals

- Rework Tauri's upstream AppImage bundler.
- Add Flatpak packaging in the same change.
- Rewrite the upstream `rhwp` vendor source.

## Constraints

- `third_party/rhwp` remains read-only.
- Linux AppImage behavior must improve without regressing `.deb`, `.rpm`, macOS, or Windows flows.
- The fix should stay local to HOP-owned code and release documentation.

## Implementation Outline

1. Add a Linux runtime helper in `apps/desktop/src-tauri/src` that detects AppImage execution and, when possible, redirects GTK to a host IM module cache that contains the requested module.
2. Keep the runtime helper conservative by only changing IM-related environment variables when a compatible host cache is found.
3. Shadow `@/view/canvas-view` from `apps/studio-host` so single-column canvases use explicit integer left offsets instead of `translateX(-50%)`.
4. Cover both changes with focused Rust and Vitest tests.

## Verification Plan

- `pnpm --filter @golbin/hop-studio-host test`
- `cargo test` from `apps/desktop/src-tauri`
- Spot-check the release AppImage structure against issue evidence to confirm the root cause matches the runtime fix.

## Rollback Or Recovery

- If Linux IME behavior regresses, remove the AppImage runtime override and fall back to current packaging behavior.
- If canvas placement causes alignment regressions, drop the studio-host override and retain only the Linux runtime fix.
