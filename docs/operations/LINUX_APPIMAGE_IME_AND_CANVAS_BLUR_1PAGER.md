# Linux AppImage IME And Canvas Blur 1-Pager

## Background

HOP ships Linux desktop artifacts as AppImage, `.deb`, and `.rpm`. Issue `#7` reports that the AppImage build fails to switch Hangul input under `fcitx5` on Linux while a converted Debian package works, and that document text looks blurry at some zoom levels.

## Problem

- The AppImage runtime bundles GTK input module metadata that does not include common host IME modules such as `fcitx` and `ibus`.
- The studio host centers page canvases with CSS transforms, which can place the rendered canvas on half-pixel boundaries and make the whole document look soft at specific zoom ratios.
- Page X coordinates are consumed by multiple editor layers, so changing only `CanvasView` can desynchronize rendering, hit testing, carets, and overlays.

## Goal

- Make AppImage prefer a host GTK IM module cache only when the active cache cannot satisfy the requested input method.
- Remove transform-based page centering while keeping every editor layer on the same snapped page-left contract.

## Non-goals

- Rework Tauri's upstream AppImage bundler.
- Add Flatpak packaging in the same change.
- Rewrite the upstream `rhwp` vendor source.

## Constraints

- `third_party/rhwp` remains read-only.
- Linux AppImage behavior must improve without regressing `.deb`, `.rpm`, macOS, or Windows flows.
- The fix should stay local to HOP-owned code and release documentation.

## Implementation Outline

1. Add a Linux runtime helper in `apps/desktop/src-tauri/src` that detects AppImage execution, respects explicit `GTK_IM_MODULE_FILE` overrides, and only redirects GTK to a host IM module cache when the active cache does not contain the requested module.
2. Keep the runtime helper conservative by limiting the fallback to `GTK_IM_MODULE_FILE` instead of broad GTK search path changes.
3. Shadow the HOP-owned editor layers that compute page X positions so `canvas`, hit testing, carets, selections, object overlays, and rulers all share one snapped page-left helper.
4. Cover the runtime helper and page-left helper with focused Rust and Vitest tests.

## Verification Plan

- `pnpm --filter @golbin/hop-studio-host exec tsc --noEmit`
- `pnpm --filter @golbin/hop-studio-host test`
- `cargo test` from `apps/desktop/src-tauri`
- Spot-check the release AppImage structure against issue evidence to confirm the root cause matches the runtime fix.

## Rollback Or Recovery

- If Linux IME behavior regresses, remove the AppImage runtime override and fall back to current packaging behavior.
- If canvas placement causes alignment regressions, drop the page-left helper rollout and retain only the Linux runtime fix.
