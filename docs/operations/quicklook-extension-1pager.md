# macOS Quick Look Extension 1-Pager

## Background

HOP already opens, edits, saves, exports, and prints HWP/HWPX documents through the Tauri desktop app. On macOS, Finder can also preview custom document types through Quick Look preview and thumbnail app extensions embedded in an app bundle.

## Problem

HWP/HWPX files associated with HOP do not currently show document previews when users press Space in Finder, and Finder thumbnails do not show the first page. Users must open documents in HOP to inspect them.

## Goal

Ship macOS 12+ Quick Look preview and thumbnail extensions inside the HOP app bundle. The extensions should render local HWP/HWPX files without network access and without logging document contents.

## Non-goals

- No Windows or Linux behavior change.
- No upstream `third_party/rhwp` product edits.
- No committed `.appex`, `.a`, `.dylib`, or other build artifacts.
- No searchable Spotlight importer in this iteration.

## Constraints

- Use `pnpm` for repository scripts.
- Keep release asset names stable.
- Keep signing, notarization, and updater behavior compatible with the existing desktop release workflow.
- Treat private document contents as sensitive. Logs may include only filenames, sizes, counts, and high-level status.

## Implementation outline

- Add a HOP-owned Rust FFI crate under `apps/desktop/quicklook/rust` that wraps `rhwp::DocumentCore` for PDF preview bytes, first-page PNG bytes, and embedded thumbnail bytes.
- Build one Rust static library with the adapter's `native-skia` dependency for both raster PDF previews and PNG thumbnails.
- Add Swift Quick Look app extension sources under `apps/desktop/quicklook/Sources`.
- Build `.appex` bundles from source with `scripts/build-quicklook-macos.mjs`; on non-macOS platforms the script is a no-op.
- Stage built extensions under `apps/desktop/src-tauri/target/quicklook/PlugIns`.
- Configure Tauri macOS bundling to copy staged `.appex` bundles into `HOP.app/Contents/PlugIns`.
- Extend macOS file associations with exported UTTypes and set the macOS minimum system version to `12.0`.

## Verification plan

- `cargo test --manifest-path apps/desktop/quicklook/rust/Cargo.toml`
- `pnpm run build:quicklook:macos`
- `pnpm --filter hop-desktop tauri build --debug --bundles app`
- Verify `HOP.app/Contents/PlugIns/HopQuickLookPreview.appex` and `HopQuickLookThumbnail.appex`.
- Verify `codesign --verify --deep --strict HOP.app` for signed release builds. For local debug builds, verify the nested `.appex` bundles directly.
- Smoke test with `qlmanage -r`, `qlmanage -p`, and `qlmanage -t -s 512` on sample `.hwp` and `.hwpx` files.

## Rollback or recovery notes

If extension bundling breaks release signing or notarization, remove the `bundle.macOS.files` mappings and the `beforeBuildCommand` Quick Look build hook. The main Tauri app remains functional without the embedded `.appex` bundles.
