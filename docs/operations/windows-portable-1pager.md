# Windows portable distribution

## Background
HOP currently distributes Windows installers. Some workplaces allow applications
to run from a user folder but prohibit installing software.

## Problem
An executable alone omits the bundled PDF font. The normal updater can launch an
MSI/NSIS installer, which is inappropriate for portable deployments.

## Goal
Produce `HOP-windows-x64-portable.zip`, containing HOP.exe, its resources,
licenses, usage instructions, and a portable marker. Support an optional extracted
x64 WebView2 Fixed Version runtime without running an installer.

## Non-goals
USB-contained settings, automatic file associations, portable auto-update,
upstream changes, version bumps, or changing existing installer asset names.

## Constraints
Use pnpm; preserve macOS/Linux and installed Windows behavior. Portable settings,
logs, recent documents, and webview cache still use the normal user AppData paths.
Do not download or install WebView2 automatically. Fixed runtimes require manual
security updates and Windows 10 runtime ACL preparation per Microsoft guidance.

## Implementation outline
Add a Windows-only build/package script with an explicit executable input for CI.
Stage only declared resources and licenses in a temporary folder, then ZIP them.
Detect the adjacent portable marker before startup update checks or update installs.
Select an adjacent optional WebView2 runtime before constructing any webviews.
Package the existing Windows release executable after Tauri builds; upload the ZIP
separately so its HOP.exe cannot be mistaken for the NSIS release asset.
Provide a separate manually triggered Windows portable workflow that builds with
`--no-bundle`, so producing a ZIP does not require any installer or macOS build.
Run packaging regression tests on Windows in regular CI as well as release builds.
Preserve vendored WASM artifact bytes with Git attributes: Windows CRLF conversion
otherwise breaks the existing provenance hashes before the build can start.
Normalize repository-relative paths in the upstream boundary test so Windows
separators do not incorrectly classify the allowed upstream adapter directory.
The packaging script keeps one linear staging/ZIP/cleanup boundary slightly
longer than the suggested function size to keep error cleanup visible together.

## Verification plan
Exercise archive contents, font paths, optional runtime, missing inputs, and repeat
packaging using fixture executables. Run Rust tests/clippy and studio build when
the toolchains are available. Windows CI builds the real release executable and
ZIP. Before shipping, test extraction to a path with spaces/Korean text, open,
edit, save, PDF, print, second windows, and absence of installer updates under a
standard account; test installed and fixed WebView2 separately. Existing macOS
and Linux builds/tests remain required for releases.

## Rollback / recovery
Remove the new ZIP asset and portable packaging step if validation fails; existing
installers and updater manifests retain their names and behavior. Do not move tags.
Users update by closing HOP and extracting a new ZIP to a new folder.
