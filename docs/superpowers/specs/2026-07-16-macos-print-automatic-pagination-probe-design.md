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

Create a debug-only, opt-in, fully automatic pagination probe that opens the private document, prepares the normal HOP print DOM, records sanitized DOM and native print-view geometry without showing a print panel or creating output, writes one JSON artifact, and exits or becomes safe to terminate.

Success means the artifact identifies the first boundary where the expected one page becomes two pages, with enough geometry to form one precise root-cause hypothesis.

## Non-goals

- Do not implement or claim a product fix.
- Do not send a printer job, generate a PDF, or open the print panel.
- Do not serialize document text, SVG, file path, printer name, or document contents.
- Do not modify `third_party/rhwp`.
- Do not alter release, non-macOS, or normal debug printing behavior.

## Constraints

- The private HWP remains in place and is never copied, logged, or committed.
- The probe is compiled only for macOS debug builds and activated only by a new absolute `.json` destination environment variable.
- The existing modal observer and normal `window.print()` path remain unchanged when the new variable is absent.
- The probe must use the attached HOP `WKWebView` and the same copied shared `NSPrintInfo`, four zero margins, and `printOperationWithPrintInfo` factory as wry/HOP.
- The native probe must not call `runOperation()`; it may only inspect the operation's retained print view.
- JSON files use create-new semantics and contain only numeric/boolean/enumerated diagnostic data.

## Considered approaches

### 1. Automatic attached-WebView geometry probe — selected

After the normal print DOM is built, the frontend sends a sanitized DOM snapshot together with the existing print command. In probe mode, Rust creates the attached-WebView print operation, reads its retained `NSView`, invokes `knowsPageRange`, and records `frame`, `bounds`, `visibleRect`, and `rectForPage` for the finite range. No operation is run.

This isolates the DOM → WebKit print view → AppKit page rect boundaries while preserving the exact document and attached-WebView architecture.

### 2. Dedicated print window comparison — deferred

Moving HOP immediately to the upstream dedicated-window model could eliminate editor-layout contamination, but it would be a product architecture change before the cause is proven. It is appropriate only as a later controlled comparison or confirmed fix.

### 3. Standalone WebKit harness — rejected for primary evidence

The earlier standalone/save-job probes did not reproduce the attached application's finite pagination and one path grew an unbounded PDF. A standalone harness cannot establish the attached HOP WebView's cause.

## Architecture and data flow

1. `openPrintDialog` builds the existing root and SVG pages.
2. A pure TypeScript helper captures only layout geometry and safe computed-style values:
   - engine page count and print-root child count;
   - viewport dimensions;
   - `html`, `body`, print root, and each print-page bounding rectangles;
   - scroll/client/offset dimensions;
   - display, position, overflow, box sizing, width, height, min/max sizes, margins, padding, and break properties.
3. The desktop bridge passes this snapshot to `print_webview` only as an optional argument. Web and normal desktop behavior remain compatible.
4. When `HOP_PRINT_GEOMETRY_PROBE_PATH` is configured, Rust creates the normal attached-WebView print operation but does not run it.
5. Rust obtains `operation.view()`, snapshots native view class-independent geometry, calls `knowsPageRange`, validates a finite range, and records `rectForPage` for each page with a strict small upper bound.
6. Rust combines the frontend and native snapshots with the existing `NSPrintInfo` snapshot and writes a new JSON file with create-new semantics.
7. The automatic debug trigger dispatches `file:print` once after the document initialization is complete. The trigger is enabled only when the native probe reports it is configured.
8. The harness waits for the JSON file, terminates the debug app, and compares expected engine/DOM page count with native range and page rectangles.

## Error handling and privacy

- Reject relative paths, non-JSON extensions, missing parents, and existing destinations before probing.
- Reject missing print view, unknown/zero/overflow page ranges, ranges above a small diagnostic limit, and non-finite frontend geometry.
- Do not include filenames, source paths, document strings, SVG, URLs, printer identifiers, or arbitrary computed-style text.
- Serialize style properties as booleans or allow-listed enum/numeric strings only.
- A failed probe returns an explicit error and does not fall back to normal printing, preventing accidental modal or printer activity.

## Verification plan

- TypeScript RED/GREEN tests for sanitized DOM snapshot construction and opt-in automatic dispatch.
- Rust RED/GREEN tests for environment validation, finite range/page-rect conversion, strict field schema, and no-run operation assembly boundaries.
- Focused studio tests, full studio tests, desktop tests, clippy with warnings denied, release check, formatting, and debug app build.
- Automated integration run against the private one-page document, with JSON existence and schema checks and private file hash/mtime verification.
- Source review proving no `runOperation`, save/preview job disposition, PDF URL, printer name, document path, or content serialization exists in the probe path.

## Rollback and recovery

The probe is diagnostic and must remain uncommitted until its native output is useful and independently reviewed. If `knowsPageRange` is unknown or inconsistent with the authentic modal range, remove the probe changes and preserve only the report. Any temporary JSON is deleted after transcribing sanitized evidence. The existing committed modal observer remains available as the authentic comparison seam.

## Approval

The user approved this automatic, no-human-print-panel diagnostic direction on 2026-07-16.
