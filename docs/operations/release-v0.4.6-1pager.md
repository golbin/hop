# HOP v0.4.6 Release 1-Pager

## Background / Problem

v0.4.5 lacks the reviewed desktop editing controls and the rhwp v0.9.0 baseline.
The six selected fixes are implemented; final native color confirmation and
Windows/Linux verification must remain distinct from automated coverage.

## Goal / Non-goals

Finish available checks, commit the reviewed changes, align HOP metadata to
0.4.6, and prepare release notes and platform artifacts. Keep the public stable
release unchanged. Do not merge PRs, close unresolved issues, or claim unperformed
GUI tests. The imported PR commits retain their cherry-pick attribution.

## Constraints / Implementation

Use pnpm and the pinned rhwp/Rust contract. Keep upstream read-only, download
asset names stable, and signing/updater settings unchanged. Align package,
Tauri, Cargo/lockfile, and both Quick Look version sources. Keep product and
release preparation commits separate. Push the task branch for immutable-SHA
platform builds, with tests enabled and release publication disabled.

## Verification plan

Run the full suite, upstream contract, desktop/Quick Look Rust formatting and
clippy, and macOS application build after version alignment. Confirm custom
native color selection manually if automation cannot operate the system picker.
Use the existing GitHub workflow for both macOS architectures, Windows x64 and
Linux x64/arm64. Attempt Windows GUI checks using the existing VM; record any
unavailable native GUI environment rather than substituting browser results.

## Recovery

Fix failures before release publication. Revert only the affected HOP commit;
retain upstream integration and contributor attribution. Leave failed builds
unpublished. Never move tags or force-push. No stable release is published as
part of this preparation.

## Results

- Full local suite: 287 passed (34 repository, 164 Studio, 81 desktop, 8 Quick
  Look). Version alignment contract passed again after changing to 0.4.6.
- Desktop and Quick Look Rust formatting/clippy passed with warnings denied.
  Pinned rhwp v0.9.0 verification passed; upstream is unchanged.
- Product commits: `dac9412` (native titles), `f0b624b` (shared zoom/page layout),
  `f3be681` (reviewed editing controls and regression coverage).
- macOS native color-grid automation failed through both AX and coordinate
  input. No color confirmation is claimed. The user offered to check manually;
  the result is pending. Existing app popup/keyboard checks are documented in
  the editing-control 1-pager.
- Windows 11 VM booted but requires the user's login; guest-agent execution is
  unavailable. Native Windows GUI checks are pending. No local Linux GUI
  environment is available (Docker daemon is stopped and supplies no desktop).
- Platform CI and the final versioned macOS bundle are pending. No release tag
  or public release has been created. These gaps block publication, not artifact
  preparation.

## Draft release notes

HOP 0.4.6 improves everyday document editing and updates rhwp to 0.9.0.

- Open font menus without toolbar clipping; select fonts with mouse or keyboard.
- Choose text colors from a palette and reuse the seven most recent colors.
  Text and highlight palettes share consistent opening and dismissal behavior.
- Identify each document window by its filename and unsaved-change indicator.
- Access zoom and multi-page arrangements from View or the status-bar percentage;
  fit controls account for the selected page arrangement.
- Use macOS Window tiling commands and correctly displayed plus-key shortcuts.

PR #105, #110 and #123 changes were imported with cherry-pick attribution.
Unclear or unreproduced reports remain open; this release does not claim to fix
clipboard/IME or environment-specific reports without evidence.
