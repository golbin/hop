# Desktop editing controls

## Background
HOP now integrates rhwp v0.9.0. Reports on v0.4.5 identify inaccessible font,
color, page arrangement, native window title, and macOS tiling controls.

## Problem and goal
Restore these basic editing controls and preserve upstream behavior. Include the
small macOS shortcut-label correction. Each change must have an observable
acceptance check before preparing the next release.

## Non-goals
No upstream edits, installer changes, dependency audit changes, hyperlink work,
new platforms, release publication, version bump, or GitHub PR merge. Existing
ambiguous reports remain open pending the requested evidence.

## Constraints
Use pnpm and preserve macOS, Windows, and Linux behavior. Do not log document
names or contents. Import PR commits with cherry-pick and preserve attribution.
The existing large bridge, main, and toolbar files are not split as part of these
focused changes; additions stay at their existing ownership boundaries.

## Implementation outline
1. Confirm the committed v0.9.0 upstream baseline and clean worktree.
2. Cherry-pick PR #105, the correction from closed PR #110, and PR #123.
3. Synchronize native titles on document open, edit, save, replacement, and close.
4. Expose upstream zoom/page arrangement via web/native View menus and status bar.
5. Review the color/highlighter interaction against v0.9.0 and simplify only where
   needed to preserve selection, keyboard use, and recent color persistence.

## Verification plan
Run focused Studio tests, typecheck, upstream verification/tests, Studio build,
desktop tests/clippy, and a macOS app build. Exercise font selection, text color,
palette switching/dismissal, title changes, page arrangement persistence, and
macOS tiling. Windows/Linux GUI validation is a release gate and must not be
claimed from macOS or Chromium results. Record actual evidence and gaps below.

## Recovery
Revert the individual cherry-picked commits and the HOP-owned title/menu changes
if needed. Keep the rhwp v0.9.0 integration intact; do not move tags or publish
artifacts during this task.

## Results (2026-11-09)
- Requested missing reproduction details in issues #80, #89, #91, #96, #102,
  #109, #111, #112, #116, #120, #121, and #122. Existing requests in other
  issues were not repeated. No issue was closed and no PR was merged.
- Created `fix/desktop-editing-controls` from `e8c6b7f`. Cherry-picked PR #105
  (`2e3283f`), closed PR #110 (`b1222e7`), and PR #123 (`cc22b2e`, `7e235fe`,
  `e4fc364`) with attribution (`-x`). HOP title/menu and review fixes remain
  uncommitted. HOP remains at 0.4.5; no push, tag, or release was created.
- Native titles now follow open/new, dirty state, save/Save As, and replacement.
  A window capability grants only the required title setter. Failure reporting
  excludes document names and contents.
- Web View menu, macOS View menu, and the keyboard-accessible status-bar button
  open the existing upstream zoom dialog. Status-bar fit buttons also use
  upstream commands, so two-page arrangements participate in fit calculations.
- Actual macOS interaction exposed an Escape defect in PR #123: opening with the
  mouse retains editor focus, so the palette's container never receives Escape.
  Handle Escape at document capture and cover that event route in the test.
- Recent colors stay usable in memory when storage writes fail but reads succeed.
  Choices from other windows are merged at commit; failed writes preserve local
  recency. Cross-window live color-history synchronization is not provided.
- Color grids, recent-history rendering and popup lifecycle have separate local
  functions. Text and highlight use the same color control without an additional
  component framework.

### Automated verification
- `pnpm upstream:verify`: pinned v0.9.0 contract passed; upstream unchanged.
- `pnpm test`: 287 tests passed (34 repository/upstream, 164 Studio, 81 desktop,
  8 Quick Look). Final focused tests and upstream verification also passed.
- Desktop clippy passed with warnings denied. Studio typecheck and production
  build passed. Existing chunk-size and mixed-import warnings remain.
- Final macOS debug app bundle built successfully, including Quick Look:
  `apps/desktop/src-tauri/target/debug/bundle/macos/HOP.app`.
- Used external Node 26.4.0, pnpm 10.33.0, Rust 1.93.1. Initial default Rust 1.92
  was rejected by upstream's MSRV. An initial parallel native run failed at the
  doc-test stage; isolated doc-tests and the subsequent serial full suite passed.
  Local macOS 27 strip workarounds match the v0.9.0 integration notes; no tracked
  toolchain/build settings changed.

### Actual UI verification
- macOS built app: font dropdown visibly extends below the toolbar at the tiled
  window size. Text color applied to selected text, palettes switch in both
  directions, Save As updates the native title and clears the dirty indicator.
  A saved fixture reopens in WASM with English and Korean content intact.
- macOS: Window menu exposes Fill/Move & Resize/Full Screen Tile. Selecting Top
  Left visibly resizes the window. Physical fn-key shortcuts were not exercised.
- macOS: a generated four-page document displays two pages side by side and a
  2x2 grid. Facing-page selection is applied and retained in the dialog. Native
  View > Zoom and the status-bar button open the same dialog. Separate windows
  appear with their respective document names in the Window menu.
- Restarted the built app after the Escape fix: Escape closes the mouse-opened
  color palette, recent red remains available, and 2x2 settings remain selected.
- Chromium with actual CDP mouse/keyboard events: font menu hit-testing succeeds
  below its parent; selecting Nanum Gothic loads the font and closes the menu.
  Escape closes the palette while editor focus was retained. After the final
  fit-button wiring, two-page width-fit yields 71% / 565px per page in an 1180px
  viewport; page-fit yields 53% / 590px page height in a 610px viewport.

### Before distribution
Windows and Linux native GUI checks remain required for font/color controls,
window titles, and page arrangements. This local macOS/Chromium verification
does not establish those OS results. No public release was prepared or published.

## Implementation review
The two color controls duplicate popup state, native picker setup, swatch creation,
and dismissal. Their behavior diverges: highlight Escape depends on focus inside
its host and its custom input still has zero size. Font options commit only on
mousedown, so native button activation cannot select a font. Extract only the
shared popup lifecycle and color-control mechanism, retain text-only recent-color
history, and use click for activation while preserving selection on mousedown.
Commit a native custom color on change, not on every preview input event. Keep
markup aligned with upstream and do not introduce a generic menu framework.

Review native titles, zoom dispatch, macOS menu identity and shortcut labels
separately; keep their small implementations unless a concrete defect appears.
Verify keyboard/click selection, popup switching and Escape from editor focus,
custom color commit, disabled toolbar behavior and modal dismissal. Use focused
tests and actual browser/native UI evidence, then repeat the simplification pass.

### Review outcome
- Removed separate highlight swatch construction, native-input setup, open/close
  handlers and duplicate color state. The common control keeps history only for
  text, and supports highlight clearing. The toolbar, custom select, color control
  and their styles contain 36 fewer production lines than the cherry-picked HEAD.
- One document-level listener set handles the active popup; closed controls have
  no document listener closures retaining their DOM. Mouse and keyboard opening
  share exclusive popup state. Outside click/focus, document replacement and
  disabling the toolbar close it.
- Font triggers/options activate through click, preserving mouse selection on
  mousedown. Removed duplicate/invisible tab stops; option arrows move focus,
  and activation commits once. Labels include field purpose and current value.
- Native color preview input events create no edits/history. Change commits once;
  late change after dismissal is ignored. Both native color inputs have nonzero
  size. Internal color inputs are excluded from accessibility navigation.
- Actual macOS testing found that preventing Escape's default also prevented the
  system color popover closing. Removed that prevention, retaining propagation
  control. After rebuilding, one Escape closes both the app and system popovers.
- Native title ownership, upstream zoom dispatch, macOS Window menu ID, and the
  shortcut-label correction required no new model or abstraction. Removed the
  zoom button's fixed accessible name so its changing percentage is announced.
- Actual Chromium keyboard events verified Space/Tab/arrows/Space font selection,
  exclusive text/highlight popups and Escape while editor focus is retained.
  Chromium also confirmed both 1x1 native inputs and the final accessible names.
- Actual rebuilt macOS app verified accessibility-click font selection, Enter
  opening, Tab/arrows/Return selection, native color popover presentation and
  single-Escape dismissal. The computer-use service could not activate native
  color-grid swatches (AXError.failure); direct system color confirmation remains
  a manual check. Commit/preview/cancel event behavior has regression coverage.
- Final review found no further material defect in the changed code. Windows and
  Linux GUI checks remain release gates. No additional commit, version change,
  push, issue mutation or release was created during this review.

## Subsequent release preparation

The user subsequently authorized commits and preparation of v0.4.6. See
`release-v0.4.6-1pager.md` for the final verification status and remaining native
GUI gates; the earlier no-commit/no-version statements describe the review stage.
