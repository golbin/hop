# macOS Print Automatic Pagination Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS-debug-only probe that automatically prepares the real HOP print DOM, opens the authentic modal preview, aborts it after a bounded settle delay, and records the post-return finite range plus sanitized frontend/native geometry without user input or print output.

**Architecture:** The studio host passes a small numeric `PrintProbeInput` through the existing print callback and automatically dispatches print once when a native configuration command reports probe mode. Rust owns environment validation, modal coordination, AppKit access, page-range validation, native view/page-rect snapshots, and create-new JSON output. Normal release, non-macOS, web, and debug-without-probe printing remain unchanged.

**Tech Stack:** TypeScript, Vitest, Tauri 2 commands, Rust, objc2 0.6/AppKit 0.3.2/WebKit 0.3.2, serde JSON, pnpm.

## Global Constraints

- Use `pnpm` only.
- Keep `third_party/rhwp` read-only.
- Preserve normal macOS, Windows, Linux, web, release, and debug-without-probe behavior.
- Never copy, log, serialize, or commit the private document, its path, text, SVG, or contents.
- Never create a PDF, configure a save/preview disposition, or send a printer job.
- The authentic print panel may appear briefly but must be aborted programmatically; `runOperation() == true` is always an error.
- Probe destinations must be new absolute `.json` files whose parent already exists.
- Do not commit probe implementation until automated native evidence is useful and independent review approves it.

## File structure

- Create `apps/desktop/src-tauri/src/print_probe.rs`: cross-platform input contract, macOS-debug environment/configuration query, validation, and unit tests.
- Create `apps/desktop/src-tauri/src/macos_print_geometry_probe.rs`: macOS-debug AppKit/WebKit operation, auto-abort coordinator, view/page snapshots, JSON output, and unit tests.
- Create `apps/studio-host/src/core/print-probe-trigger.ts`: one-shot opt-in automatic dispatcher with no Tauri imports.
- Create `apps/studio-host/src/core/print-probe-trigger.test.ts`: pure trigger tests.
- Modify `apps/studio-host/src/ui/print-dialog.ts`: construct and pass sanitized `PrintProbeInput` after print pages exist.
- Modify `apps/studio-host/src/ui/print-dialog.test.ts`: verify exact sanitized input.
- Modify `apps/studio-host/src/command/commands/file.ts`: forward input to the desktop bridge.
- Modify `apps/studio-host/src/command/commands/file.test.ts`: execute the supplied callback and verify forwarding.
- Modify `apps/studio-host/src/core/tauri-bridge.ts`: add configuration query and typed print invocation.
- Modify `apps/studio-host/src/core/tauri-bridge.test.ts`: verify command names and argument shapes.
- Modify `apps/studio-host/src/main.ts`: run the one-shot trigger only after successful document initialization.
- Modify `apps/desktop/src-tauri/src/commands.rs`: expose configuration query and route opt-in geometry probes before existing modal/normal paths.
- Modify `apps/desktop/src-tauri/src/lib.rs`: register modules and the configuration command.
- Modify `apps/desktop/src-tauri/Cargo.toml`: enable the minimal `objc2`, `NSApplication`, and `NSView` APIs required by the coordinator and snapshots.

---

### Task 1: Automatic authentic modal pagination probe

**Interfaces:**

- Produces frontend `PrintProbeInput`:

```ts
export interface PrintProbeInput {
  enginePageCount: number;
  domPageCount: number;
  pageWidthMm: number;
  pageHeightMm: number;
  finalBreakIsAuto: boolean;
}
```

- Produces bridge methods:

```ts
printGeometryProbeConfigured(): Promise<boolean>;
printCurrentWebview(probeInput: PrintProbeInput): Promise<void>;
```

- Produces Rust commands:

```rust
#[tauri::command]
pub fn print_geometry_probe_configured() -> Result<bool, String>;

#[tauri::command]
pub fn print_webview(
    window: WebviewWindow,
    probe_input: Option<PrintProbeInput>,
) -> Result<(), String>;
```

- Produces native entry point:

```rust
pub(crate) fn observe_attached_webview_geometry(
    window: &WebviewWindow,
    path: PathBuf,
    input: PrintProbeInput,
) -> Result<(), String>;
```

- [x] **Step 1: Write frontend RED tests for the exact probe input and forwarding contract**

Add a print-dialog test that executes the supplied callback and requires exactly one engine page, one `.hop-print-page`, `210 × 297` mm, and final break auto:

```ts
it('passes only sanitized print layout inputs to desktop printing', async () => {
  const print = vi.fn<(input: PrintProbeInput) => void>();
  const doc = {
    fileName: 'private-name-must-not-be-forwarded.hwp',
    pageCount: 1,
    getPageInfo: vi.fn(() => pageInfo({ width: 793.7, height: 1122.5 })),
    renderPageSvg: vi.fn(() => '<svg><text>must-not-be-forwarded</text></svg>'),
  };

  await openPrintDialog(doc, { print });

  expect(print).toHaveBeenCalledWith({
    enginePageCount: 1,
    domPageCount: 1,
    pageWidthMm: 210,
    pageHeightMm: 297,
    finalBreakIsAuto: true,
  });
  expect(JSON.stringify(print.mock.calls)).not.toContain('private-name');
  expect(JSON.stringify(print.mock.calls)).not.toContain('must-not-be-forwarded');
});
```

Update the file-command test to invoke `options.print(input)` and require `desktop.printCurrentWebview(input)`. Update the bridge test to require:

```ts
expect(invokeMock).toHaveBeenCalledWith('print_webview', { probeInput });
expect(invokeMock).toHaveBeenCalledWith('print_geometry_probe_configured', undefined);
```

Create `print-probe-trigger.test.ts` with three cases: absent capability does nothing, configured false does nothing, configured true dispatches `file:print` exactly once across repeated document initializations.

- [x] **Step 2: Run the frontend RED tests and verify contract failures**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm --filter @golbin/hop-studio-host exec vitest run \
  src/ui/print-dialog.test.ts \
  src/command/commands/file.test.ts \
  src/core/tauri-bridge.test.ts \
  src/core/print-probe-trigger.test.ts
```

Expected: exit `1`; failures are only missing `PrintProbeInput` callback forwarding, missing bridge method/arguments, and missing one-shot trigger module/behavior. Fix syntax or fixture errors until the failures are behavioral.

- [x] **Step 3: Implement the minimal frontend contract and one-shot trigger**

In `print-dialog.ts`, export `PrintProbeInput`, change `PrintDialogOptions.print` to accept it, and replace the existing fallback expression with an explicit branch:

```ts
const probeInput: PrintProbeInput = {
  enginePageCount: pageCount,
  domPageCount: root.querySelectorAll(':scope > .hop-print-page').length,
  pageWidthMm: widthMm,
  pageHeightMm: heightMm,
  finalBreakIsAuto: true,
};
if (options.print) await options.print(probeInput);
else window.print();
```

In `file.ts`, forward `probeInput`:

```ts
print: desktop ? (probeInput) => desktop.printCurrentWebview(probeInput) : undefined,
```

In `tauri-bridge.ts`, import the type and implement:

```ts
async printGeometryProbeConfigured(): Promise<boolean> {
  return this.invoke<boolean>('print_geometry_probe_configured');
}

async printCurrentWebview(probeInput: PrintProbeInput): Promise<void> {
  await this.invoke<void>('print_webview', { probeInput });
}
```

Create the pure one-shot trigger:

```ts
interface ProbeBridge {
  printGeometryProbeConfigured?(): Promise<boolean>;
}

export function createPrintProbeTrigger(): (
  bridge: unknown,
  dispatch: (commandId: string) => boolean,
) => Promise<boolean> {
  let dispatched = false;
  return async (bridge, dispatch) => {
    if (dispatched) return false;
    const candidate = bridge as ProbeBridge;
    if (!candidate.printGeometryProbeConfigured) return false;
    if (!await candidate.printGeometryProbeConfigured()) return false;
    dispatched = dispatch('file:print');
    return dispatched;
  };
}
```

Instantiate once in `main.ts` and call it at the end of successful `initializeDocument`:

```ts
const triggerPrintProbe = createPrintProbeTrigger();
// after validation/dirty-state initialization succeeds
await triggerPrintProbe(wasm, (commandId) => dispatcher.dispatch(commandId));
```

- [x] **Step 4: Run the frontend focused tests and verify GREEN**

Run the Step 2 command again. Expected: all selected test files pass with no new warnings.

- [x] **Step 5: Write Rust RED tests for path/input/range/view schema and coordinator outcomes**

Create `print_probe.rs` tests that require:

```rust
#[test]
fn geometry_probe_path_requires_new_absolute_json_destination() {
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("observation.json");
    assert_eq!(
        geometry_probe_path_from_value(Some(destination.clone().into_os_string())).unwrap(),
        Some(destination.clone())
    );
    assert!(geometry_probe_path_from_value(Some("relative.json".into())).is_err());
    assert!(geometry_probe_path_from_value(Some(
        directory.path().join("observation.txt").into_os_string()
    )).is_err());
    std::fs::write(&destination, b"existing").unwrap();
    assert!(geometry_probe_path_from_value(Some(destination.into_os_string())).is_err());
}

#[test]
fn probe_input_rejects_zero_non_finite_or_mismatched_counts() {
    let valid = PrintProbeInput {
        engine_page_count: 1,
        dom_page_count: 1,
        page_width_mm: 210.0,
        page_height_mm: 297.0,
        final_break_is_auto: true,
    };
    assert_eq!(valid.validate(), Ok(()));
    assert!(PrintProbeInput { engine_page_count: 0, ..valid.clone() }.validate().is_err());
    assert!(PrintProbeInput { dom_page_count: 2, ..valid.clone() }.validate().is_err());
    assert!(PrintProbeInput { page_height_mm: f64::NAN, ..valid }.validate().is_err());
}
```

The configuration test must use `#[cfg(not(all(target_os = "macos", debug_assertions)))]` and assert `geometry_probe_configured() == Ok(false)` so release/non-mac behavior is explicit without mutating the process environment in parallel tests.

Create `macos_print_geometry_probe.rs` tests around pure functions that require:

```rust
#[test]
fn modal_is_aborted_only_after_the_pagination_settle_delay() {
    assert_eq!(coordinator_decision(AUTO_ABORT_DELAY - Duration::from_millis(1)), Decision::Poll);
    assert_eq!(coordinator_decision(AUTO_ABORT_DELAY), Decision::AbortModal);
}

#[test]
fn unknown_or_zero_page_ranges_are_rejected_after_modal_abort() {
    assert!(finite_page_range(NSRange::new(1, isize::MAX as usize)).is_err());
    assert!(finite_page_range(NSRange::new(0, 2)).is_err());
}
```

The observation serialization test must construct two distinct `RectSnapshot` values, serialize the typed observation with `serde_json::to_value`, assert the two exact rectangles and strict top-level keys, then recursively assert that the resulting JSON contains none of `documentPath`, `fileName`, `svg`, `printer`, `pdfPath`, or an arbitrary sentinel document string.

- [x] **Step 6: Run Rust RED and verify only missing probe APIs fail**

Run:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib print_probe -- --nocapture
```

Expected: exit `101`; failures are unresolved probe modules/functions/types or unmet assertions, not Cargo feature, syntax, or fixture errors.

- [x] **Step 7: Implement the Rust contracts and native auto-abort coordinator**

Add macOS dependencies/features without changing versions:

```toml
objc2 = "0.6.4"
objc2-app-kit = { version = "0.3.2", default-features = false, features = ["std", "NSApplication", "NSDocumentController", "NSPrintInfo", "NSPrintOperation", "NSPrinter", "NSView"] }
```

In `print_probe.rs`, define the serde input, validate positive counts, equal engine/DOM counts, finite positive millimetres, and the absolute new `.json` environment path `HOP_PRINT_GEOMETRY_PROBE_PATH`. Return `false` from the configuration query outside macOS debug.

In `macos_print_geometry_probe.rs`:

1. Require the main thread and use `window.with_webview` plus `Arc<OnceLock<Result<(), String>>>`, matching the reviewed modal observer.
2. Copy shared `NSPrintInfo`, set only the four margins to zero, create `printOperationWithPrintInfo`, enable the print panel, disable progress, and retain the view.
3. Register a repeating `NSTimer` in `NSModalPanelRunLoopMode` and `NSRunLoopCommonModes` before `runOperation()`. After a two-second settle delay, invalidate it and call `NSApplication::sharedApplication(marker).abortModal()`.
4. After `runOperation()` returns, reject `true`, a timer that never fired, an operation that ended before automatic abort, a missing/unknown post-return range, a missing view, or more than 32 pages.
5. Snapshot `view.frame()`, `view.bounds()`, `view.visibleRect()`, `view.isFlipped()`, the finite operation range, every `view.rectForPage(page)`, and the effective print info.
6. Write only the strict serde structure with create-new semantics.

Do not call `setJobDisposition`, `setJobSavingURL`, PDF/CG APIs, `printOperationWithView`, or any printer getter.

Wire commands in this order:

```rust
if let Some(path) = crate::print_probe::configured_geometry_probe_path()? {
    let input = probe_input.ok_or_else(|| "print geometry probe requires sanitized input".to_string())?;
    crate::macos_print_geometry_probe::observe_attached_webview_geometry(&window, path, input)?;
    return Ok(());
}
if let Some(path) = crate::macos_print_capture::configured_observation_path()? {
    crate::macos_print_capture::observe_attached_webview(&window, path)?;
    return Ok(());
}
window
    .print()
    .map_err(|error| format!("인쇄 대화상자를 열 수 없습니다: {error}"))
```

Register `print_geometry_probe_configured` in `lib.rs`; release/non-macOS `print_webview` accepts and ignores `_probe_input` before calling the unchanged `window.print()` expression.

- [x] **Step 8: Run Rust focused and full verification**

Run:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib print_probe -- --nocapture
pnpm run test:desktop
pnpm run clippy:desktop
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --release
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
git diff --check
```

Expected: all commands exit `0`; the repository's `clippy:desktop` script already runs `cargo clippy -- -D warnings`.

- [x] **Step 9: Run full frontend verification and build the debug app**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm run test:studio
pnpm run build:studio
pnpm --filter hop-desktop tauri build --debug --bundles app
```

Expected: tests and builds exit `0`; existing Vite chunk/dynamic-import warnings may remain but no new warning is accepted.

- [x] **Step 10: Run the automated native probe and preserve only sanitized evidence**

Record the private file's size, mtime, and SHA-256 without printing its content. Create a fresh temp directory, then launch:

```bash
open -n -W \
  --env HOP_PRINT_GEOMETRY_PROBE_PATH="$probe_dir/observation.json" \
  -a apps/desktop/src-tauri/target/debug/bundle/macos/HOP.app \
  '<private-hwp-path>'
```

Wait conditionally for the JSON file with a 30-second upper bound. The app must automatically dispatch print, briefly show and abort the panel, and write JSON without clicks. Terminate only this launched debug process after the file appears.

Expected evidence:

- frontend engine and DOM page counts are `1`;
- native modal range is finite and matches the authentic `1 + 2` baseline;
- two page entries plus view frame/bounds/visibleRect are present; post-abort `rectForPage` sentinels are not used for causal inference;
- operation outcome is auto-aborted, never successful;
- no PDF or printer job exists;
- private file size, mtime, and SHA-256 are unchanged.

Delete the temporary JSON after transcribing numeric geometry into `.superpowers/sdd/automatic-geometry-probe-evidence.md`.

- [x] **Step 11: Review the evidence before any fix**

Classify the first divergence:

- input `1`, native view/range `2`, and a tiny second rect: WebKit/AppKit rounding or layout overflow candidate;
- input `1`, native view height near two full sheets and two full rects: attached editor document contributes a full extra fragment;
- auto-abort range differs from the human-cancel `2`: reject and remove the probe;
- any successful operation/output/privacy field: stop, remove artifacts, and treat as a critical failure.

Run source checks:

```bash
rg -n "NSPrintSaveJob|NSPrintPreviewJob|setJobSavingURL|pdf|printer\(|documentPath|fileName|renderPageSvg" \
  apps/desktop/src-tauri/src/{print_probe,macos_print_geometry_probe}.rs
git diff --check
git status --short
```

Expected: no forbidden native/output/content API usage. Do not commit implementation yet; request independent review of code and sanitized evidence first.

- [x] **Step 12: Prove and fix the vertical rounding overflow with TDD**

Record the baseline native range and print-view frame, then run one controlled experiment that leaves `@page` unchanged and reduces only the printable page content height by `0.1mm`. If the native range changes from two pages to one and the print-view frame changes from approximately two A4 sheets to one, classify the cause as WebKit physical-unit/integer-frame rounding overflow.

Add a failing studio test that requires the physical `@page` to remain `210mm × 297mm` while `.hop-print-page` uses `calc(297mm - 0.1mm)`. Implement the named `0.1mm` guard, rerun the studio test, rebuild the app, and rerun the automatic native probe. Preserve only sanitized before/after numbers in `.superpowers/sdd/automatic-geometry-probe-evidence.md`.
