# macOS Print Automatic Pagination Probe Design

## Background

HOP renders each HWP page as SVG and temporarily appends a print-only DOM to the editor's attached `WKWebView`. A private one-page document consistently appears as two pages in the real macOS print preview, with the second page blank. The attached-WebView modal observer has reproduced a finite native range of pages 1–2 twice with unchanged settings.

Three controlled candidates have been disproven by the real preview and native range:

- resetting editor viewport constraints during print;
- removing the one-page document's forced trailing break declarations;
- changing copied `NSPrintInfo.verticalPagination` from `Automatic` to `Clip`.

The upstream rhwp studio prints from a dedicated document window, while HOP prints from the editor document. The remaining unknown is the boundary at which one engine page becomes two WebKit/AppKit print pages.

## Problem

The current observer exposes only the final `NSPrintOperation.pageRange` and `NSPrintInfo`. It does not expose the print DOM geometry or the `NSView` owned by the operation. As a result, it proves the symptom but cannot distinguish among:

- an oversized or residual box in the attached editor document;
- a WebKit print-layout fragment or rounding overflow;
- an AppKit print-view geometry/page-rect mismatch.

The session's trusted Computer Use runtime lacks its required `node_repl`, so native modal UI automation is unavailable. Requiring repeated human Cmd+P/Cancel checks is not acceptable for this diagnostic loop.

## Goal

Create a debug-only, opt-in, fully automatic pagination probe that opens the private document, prepares the normal HOP print DOM, opens the authentic modal preview, cancels it after a bounded pagination-settle delay, then records the post-return finite range and sanitized print-view geometry without user input.

Success means the artifact identifies the first boundary where the expected one page becomes two pages, with enough geometry to form one precise root-cause hypothesis.

## Non-goals

- Do not implement or claim a product fix.
- Do not send a printer job or generate a PDF. The authentic print panel may appear briefly but must be cancelled programmatically without user input.
- Do not serialize document text, SVG, file path, printer name, or document contents.
- Do not modify `third_party/rhwp`.
- Do not alter release, non-macOS, or normal debug printing behavior.

## Constraints

- The private HWP remains in place and is never copied, logged, or committed.
- The probe is compiled only for macOS debug builds and activated only by a new absolute `.json` destination environment variable.
- The existing modal observer and normal `window.print()` path remain unchanged when the new variable is absent.
- The probe must use the attached HOP `WKWebView` and the same copied shared `NSPrintInfo`, four zero margins, and `printOperationWithPrintInfo` factory as wry/HOP.
- The native probe must call the same modal `runOperation()` seam that produced the authentic finite range, cancel it through AppKit after a bounded settle delay, and read the finite range only after `runOperation()` returns. It must never approve the operation.
- JSON files use create-new semantics and contain only numeric/boolean/enumerated diagnostic data.

## Considered approaches

### 1. Automatic authentic modal geometry probe — selected

After the normal print DOM is built, the frontend sends sanitized numeric layout inputs together with the existing print command. In probe mode, Rust creates and runs the attached-WebView modal print operation. An `NSTimer` registered in both the modal and common run-loop modes waits two seconds, then calls `NSApplication.abortModal`. Rust validates the finite `pageRange` after `runOperation()` returns and records the operation view's `frame`, `bounds`, `visibleRect`, and `rectForPage` values.

This preserves the exact empirical seam that matched the visible two-page preview while removing all human Cmd+P/Cancel actions. A sanitized status sidecar distinguishes frontend configuration, native entry, timer execution, modal abort, and final range capture. No failure falls through to normal printing.

### 2. Dedicated print window comparison — deferred

Moving HOP immediately to the upstream dedicated-window model could eliminate editor-layout contamination, but it would be a product architecture change before the cause is proven. It is appropriate only as a later controlled comparison or confirmed fix.

### 3. No-run or standalone WebKit harness — rejected for primary evidence

The earlier standalone/save-job probes did not reproduce the attached application's finite pagination and one path grew an unbounded PDF. Before `runOperation`, the print view reported `NSIntegerMax` and dummy `(0, 0, 1, 1)` rectangles. A no-run or standalone harness therefore cannot establish the attached HOP WebView's cause.

## Architecture and data flow

1. `openPrintDialog` builds the existing root and SVG pages.
2. A pure TypeScript helper captures only safe numeric/authored inputs available before WebKit creates its private print clone:
   - engine page count and print-root child count;
   - page width and height in millimetres;
   - whether the final page uses authored `auto` break rules.
3. The desktop bridge passes this snapshot to `print_webview` only as an optional argument. Web and normal desktop behavior remain compatible.
4. When `HOP_PRINT_GEOMETRY_PROBE_PATH` is configured, Rust creates the normal attached-WebView print operation and starts the bounded auto-cancel coordinator before running it.
5. A main-run-loop timer fires inside the modal loop, waits for the bounded settle delay, and calls `NSApplication.abortModal` without approving or submitting the operation.
6. After `runOperation()` returns `false`, Rust validates the now-finite range, obtains `operation.view()`, snapshots native view class-independent geometry, and records `rectForPage` for each page with a strict small upper bound.
7. Rust combines the frontend inputs and native snapshots with the existing `NSPrintInfo` snapshot and writes a new JSON file with create-new semantics.
8. The automatic debug trigger dispatches `file:print` once after the document initialization is complete. The trigger is enabled only when the native probe reports it is configured.
9. The harness waits for the JSON file, terminates the debug app, and compares expected engine/DOM page count with native range and page rectangles.

## Error handling and privacy

- Reject relative paths, non-JSON extensions, missing parents, and existing destinations before probing.
- Reject missing print view, unknown/zero/overflow post-return page ranges, ranges above a small diagnostic limit, a timer that did not fire, an operation that ended before automatic abort, an unexpectedly successful print operation, and non-finite frontend geometry.
- Do not include filenames, source paths, document strings, SVG, URLs, printer identifiers, or arbitrary computed-style text.
- Serialize style properties as booleans or allow-listed enum/numeric strings only.
- A failed probe returns an explicit error and does not fall back to normal printing, preventing accidental modal or printer activity.

## Verification plan

- TypeScript RED/GREEN tests for sanitized print-input construction and opt-in one-shot automatic dispatch.
- Rust RED/GREEN tests for environment validation, sanitized status writes, post-abort finite range/page-rect conversion, strict field schema, bounded coordinator timing, and abort-only operation assembly boundaries.
- Focused studio tests, full studio tests, desktop tests, clippy with warnings denied, release check, formatting, and debug app build.
- Automated integration run against the private one-page document, with JSON existence and schema checks and private file hash/mtime verification.
- Source review proving the probe treats `runOperation() == true` as failure and contains no save/preview job disposition, PDF URL, printer name, document path, or content serialization.

## Rollback and recovery

The probe is diagnostic and must remain uncommitted until its native output is useful and independently reviewed. If auto-cancel cannot produce the same finite range as the human-cancel observer, remove the probe changes and preserve only the report. Any temporary JSON is deleted after transcribing sanitized evidence. The existing committed modal observer remains available as the authentic comparison seam.

## Approval

The user approved this automatic, no-human-interaction diagnostic direction on 2026-07-16.
