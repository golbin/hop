# HOP Issue Ownership Implementation 1-Pager

## Background
- HOP owns the desktop shell around `rhwp` and `rhwp-studio`.
- The follow-up PRD identified macOS native menu and quit behavior, desktop chrome context-menu leakage, HOP-side shortcut routing, and Linux AppImage IME mitigation as HOP-owned work.

## Problem
- macOS currently exposes duplicate menu chrome and misses native-feeling quit behavior.
- Non-editor chrome can still expose browser/webview context menus.
- HOP's shortcut layer still treats `Meta` like `Ctrl` on non-macOS platforms, which is the wrong ownership boundary for Windows/Linux desktop behavior.
- Linux AppImage IME risk cannot be fully validated on this machine, so the ship path needs an explicit mitigation.

## Goal
- Restore native-feeling macOS menu and quit flow without touching `third_party/rhwp`.
- Keep non-editor chrome from exposing reload/debug context menus.
- Make HOP-owned shortcut routing platform-correct.
- Ship a concrete Linux AppImage mitigation path in user-facing docs.

## Non-Goals
- Do not edit `third_party/rhwp`.
- Do not solve upstream renderer or layout bugs in this change.
- Do not add Flatpak packaging in this pass.

## Constraints
- `pnpm` only.
- Preserve macOS, Windows, and Linux behavior.
- This machine can only run macOS interactive checks directly.

## Implementation Outline
- Add a HOP-owned platform helper so shortcut matching uses `Meta` only on macOS and `Ctrl` elsewhere.
- Keep the in-webview top menu visible until the native macOS menu reaches functional parity, while still normalizing shortcut labels/tooltips for macOS-owned UI.
- Suppress `contextmenu` on menu bar, toolbars, style bar, and status bar without touching editor canvas behavior.
- Add explicit app-level quit coordination on macOS so `Cmd+Q` and OS quit requests close windows through existing unsaved-change protection.
- Add Linux AppImage IME guidance to public download and release docs.

## Verification Plan
- `pnpm --filter @golbin/hop-studio-host test`
- `pnpm run test:desktop`
- `pnpm --filter hop-desktop tauri build --debug --bundles app`
- Manual macOS check with the desktop app for menu visibility, right-click suppression, save, and quit behavior.

## Rollback
- Revert HOP-owned menu and desktop-host changes only.
- If macOS quit flow proves unstable, keep the native menu and revert only the custom quit coordination.
