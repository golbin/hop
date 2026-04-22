# PRD: HOP Issue Ownership Follow-Up

## Document Status
- Status: Draft
- File Mode: Single
- Current Phase: Not Started
- Last Updated: 2026-04-22
- PRD File: `tasks/prd-hop-issue-ownership-followup.md`
- Purpose: Living execution plan for HOP-owned work extracted from open issue triage on 2026-04-22.

## Problem

The current open issue set mixes HOP-owned desktop-shell work with `rhwp` engine and `rhwp-studio` editor work. That makes prioritization weak, creates unclear ownership, and increases the chance that HOP changes reach into `third_party/rhwp` instead of using the adapter boundary the repo requires.

## Goals

- G-1: Turn the HOP-owned parts of issues `#3`, `#4`, and `#7` into one concrete execution plan with dependency order.
- G-2: Keep all planned code changes inside `apps/desktop` and `apps/studio-host`.
- G-3: Separate clear HOP fixes from upstream `rhwp` handoff items before implementation starts.
- G-4: Define verification paths for macOS, Windows, and Linux behavior before code changes begin.
- G-5: Prefer native desktop behavior over duplicate or browser-like web chrome where HOP owns both surfaces.

## Non-Goals

- NG-1: Do not implement the fixes in this PRD.
- NG-2: Do not change `third_party/rhwp`.
- NG-3: Do not commit to Flatpak packaging in this workstream.
- NG-4: Do not absorb editor-engine rendering or interaction bugs into HOP-owned code just to close issues faster.

## Success Criteria

- SC-1: Every HOP-owned issue fragment has a named phase, owner surface, and validation path.
- SC-2: The plan makes it explicit which issue fragments stay in HOP and which move to `rhwp`.
- SC-3: The planned HOP work can be executed without changing vendor code.
- SC-4: The plan preserves cross-platform behavior and names any platform-specific checks needed before shipping.

## Key Scenarios

### Scenario 1: macOS user expects native desktop behavior
- Actor: macOS desktop user
- Trigger: Uses app menu shortcuts or right-clicks the top menu bar area
- Expected outcome: Native shortcuts work, native labels look correct, and no webview debug context menu appears

### Scenario 2: Windows user expects editor shortcuts to respond reliably
- Actor: Windows desktop user
- Trigger: Uses `Ctrl` shortcuts in the desktop app
- Expected outcome: HOP-owned shortcut routing does not block or misroute commands before they reach the editor

### Scenario 3: Linux user launches the AppImage with fcitx5
- Actor: Linux desktop user on Wayland or X11-compatible runtime
- Trigger: Opens the AppImage and tries Hangul input
- Expected outcome: IME works consistently or HOP documents the exact packaging/runtime constraint and corrects the bundle behavior

## Discovery Summary

### Reviewed Inputs
- Open issues `#3`, `#4`, `#6`, `#7` in `golbin/hop`
- [docs/architecture/UPSTREAM.md](../docs/architecture/UPSTREAM.md)
- [docs/specs/initial/SPEC.md](../docs/specs/initial/SPEC.md)
- [apps/desktop/src-tauri/src/lib.rs](../apps/desktop/src-tauri/src/lib.rs)
- [apps/desktop/src-tauri/src/menu.rs](../apps/desktop/src-tauri/src/menu.rs)
- [apps/studio-host/vite.config.ts](../apps/studio-host/vite.config.ts)
- [apps/studio-host/hop-overrides.ts](../apps/studio-host/hop-overrides.ts)
- [apps/studio-host/src/command/shortcut-map.ts](../apps/studio-host/src/command/shortcut-map.ts)
- [apps/studio-host/src/main.ts](../apps/studio-host/src/main.ts)
- [apps/studio-host/index.html](../apps/studio-host/index.html)

### Current System Facts
- HOP shadows only selected `rhwp-studio` surfaces through Vite alias overrides. The rest of the editor stack still comes directly from upstream.
- macOS native menu ownership is already in HOP Rust code, not upstream.
- HOP disables the default macOS menu and replaces it with a custom native menu, so any missing application-level behavior such as Quit semantics must be restored explicitly in HOP.
- HOP also owns the desktop-side shortcut override layer and a global keyboard bridge before editor-local handling.
- The visible top menu bar inside the webview is HOP HTML, so HOP can suppress unexpected browser or webview context menus there and can choose to reduce duplicate chrome on macOS.
- Linux AppImage behavior sits on the HOP packaging and runtime boundary, even if the underlying webview runtime contributes to the failure mode.

### Ownership Split Derived From Discovery

HOP-owned:
- macOS native menu and shortcut behavior from issue `#4` item 1
- Top menu right-click / reload exposure from issue `#4` item 4
- Windows shortcut routing investigation from issue `#3` shortcut portion
- Linux AppImage fcitx5 input investigation from issue `#7`

Deferred HOP backlog:
- Flatpak packaging request from issue `#7`
- Potential HOP styling follow-up for small menu/ribbon text mentioned in the comment on issue `#3`

Explicitly upstream-owned and excluded from this PRD:
- Ruler margin drag support from issue `#4` item 2
- Context-menu focus highlight persistence from issue `#4` item 3
- Trackpad gesture quality and zoom-dependent blur from issues `#3` and `#7`
- Equation rendering from issue `#6`

### Constraints
- `third_party/rhwp` remains read-only.
- HOP fixes must land in `apps/desktop` or `apps/studio-host`.
- Cross-platform behavior must stay intact for macOS, Windows, and Linux.
- Only `pnpm` workflows are allowed.

### Risks
- Shortcut bugs may be split across HOP-owned routing and upstream editor event handling, so Phase 2 needs a hard ownership checkpoint before implementation.
- Linux IME behavior may depend on Tauri, webkit2gtk, AppImage runtime details, or environment propagation that cannot be fully validated on the current machine.
- Fixing top-menu context behavior must not block valid context menus inside the editor canvas.

### Unknowns
- Whether Windows shortcut failures are fully reproducible in current `main`
- Whether Linux AppImage IME failure is caused by environment propagation, packaging metadata, or runtime plugin behavior
- Whether HOP should hide the in-webview menu on macOS once native menu parity is improved

### Design Implications
- HOP work should focus on adapter and shell layers first.
- Any issue that still reproduces after HOP routing is bypassed or corrected should be moved to `rhwp`.
- The HOP plan should front-load ownership confirmation, not assume all user-visible bugs in desktop builds belong to HOP.

## Requirements

### Functional Requirements
- FR-1: Define a HOP-owned implementation path for macOS shortcut and menu-label correctness.
- FR-2: Define a HOP-owned implementation path for restoring proper macOS app lifecycle behavior, including quit behavior and unsaved-change handling.
- FR-3: Define a HOP-owned implementation path for suppressing unexpected browser or webview right-click menus across non-editor desktop chrome, not only one menu strip hotspot.
- FR-4: Define a Windows shortcut investigation path that can determine whether failures are in HOP routing or upstream handling.
- FR-5: Define a Linux AppImage IME investigation path that focuses on HOP-controlled packaging and runtime integration first.
- FR-6: Keep Flatpak as a separate enhancement backlog item, not part of the immediate bug-fix phases.
- FR-7: Decide whether duplicate in-webview menu chrome should remain on macOS once native menu behavior is corrected.

### Non-Functional Requirements
- NFR-1: No planned solution may require direct vendor edits.
- NFR-2: Every phase must include a validation method and explicit stop condition if ownership shifts upstream.
- NFR-3: The plan must be executable by a fresh contributor without reconstructing the ownership analysis from scratch.

## Phase Plan

### Phase 1: macOS Menu And Webview Menu Normalization

#### Phase Discovery Gate
- [ ] Re-read [apps/desktop/src-tauri/src/lib.rs](../apps/desktop/src-tauri/src/lib.rs) and [apps/desktop/src-tauri/src/menu.rs](../apps/desktop/src-tauri/src/menu.rs)
- [ ] Re-read [apps/studio-host/index.html](../apps/studio-host/index.html) and any HOP-owned menu bar styling or behavior code
- [ ] Confirm current macOS issue scope against issue `#4` item 1 and item 4 before editing

#### Implementation Checklist
- [ ] Audit current native menu command coverage against the visible web menu commands HOP exposes
- [ ] Identify why `Cmd+S` and `Cmd+Q` are not behaving as users expect in the current desktop app
- [ ] Define the correct macOS-native quit path, including whether HOP needs an explicit app-level Quit item or equivalent native lifecycle wiring
- [ ] Check how quit and window-close flows interact with HOP unsaved-changes confirmation and multi-window behavior
- [ ] Normalize menu labeling so macOS users see native accelerator presentation where HOP owns the surface
- [ ] Prevent menu bar, toolbar, and other non-editor chrome from exposing unexpected reload or debug actions
- [ ] Decide whether HOP should keep, reduce, hide, or platform-condition the in-webview menu presence on macOS instead of preserving duplicate desktop chrome by default

#### Validation
- [ ] Manual macOS smoke check for `Cmd+S`, `Cmd+Q`, menu click dispatch, and non-editor chrome right-click behavior
- [ ] Manual macOS smoke check for unsaved document quit, window close, and multi-window quit semantics
- [ ] `pnpm --filter @golbin/hop-studio-host test`
- [ ] `pnpm run test:desktop`

#### Exit Criteria
- [ ] macOS menu ownership and suppression strategy are fully specified
- [ ] Duplicate native versus in-webview menu policy is resolved for macOS
- [ ] No planned fix requires touching upstream editor code

### Phase 2: Windows Shortcut Ownership Audit

#### Phase Discovery Gate
- [ ] Re-read [apps/studio-host/src/command/shortcut-map.ts](../apps/studio-host/src/command/shortcut-map.ts)
- [ ] Re-read [apps/studio-host/src/main.ts](../apps/studio-host/src/main.ts) shortcut handling
- [ ] Compare HOP shortcut overrides against upstream command coverage before proposing changes
- [ ] Re-check the comment on issue `#3` and separate shortcut behavior from unrelated undo or typography notes

#### Implementation Checklist
- [ ] Reproduce or instrument the Windows shortcut failure path at the HOP-owned routing layer
- [ ] Determine whether the failure occurs before commands reach upstream editor handlers
- [ ] If HOP-owned, define the minimal fix in shortcut override or global dispatch logic
- [ ] If not HOP-owned, stop and update the upstream handoff document instead of expanding HOP ownership
- [ ] Decide whether any HOP-owned menu or bridge commands need OS-conditional behavior on Windows

#### Validation
- [ ] Manual Windows smoke check for common `Ctrl` shortcuts: save, open, undo, redo, copy, paste, find
- [ ] `pnpm --filter @golbin/hop-studio-host test`
- [ ] Focused test additions for any HOP-owned shortcut mapping or dispatch changes

#### Exit Criteria
- [ ] Ownership of the Windows shortcut failure is proven, not assumed
- [ ] Any remaining upstream portion is documented separately and removed from HOP scope

### Phase 3: Linux AppImage IME Investigation

#### Phase Discovery Gate
- [ ] Re-read [docs/specs/initial/SPEC.md](../docs/specs/initial/SPEC.md) Linux packaging notes
- [ ] Re-read [apps/desktop/src-tauri/tauri.conf.json](../apps/desktop/src-tauri/tauri.conf.json), desktop packaging workflows, and release notes
- [ ] Review the exact issue `#7` environment details before deciding on the first investigation path

#### Implementation Checklist
- [ ] Confirm what HOP controls in the AppImage packaging and startup environment
- [ ] Check whether IME-related environment propagation differs between AppImage and deb-based installs
- [ ] Identify whether HOP can correct the AppImage runtime behavior without changing upstream editor code
- [ ] If HOP cannot safely fix it alone, document the remaining runtime dependency and narrow the upstream or platform escalation target
- [ ] If AppImage remains partially blocked, define the user-facing mitigation HOP should ship, such as release-note guidance or download-page steering toward a working package path
- [ ] Keep Flatpak discussion out of the bug-fix path and record it as backlog only

#### Validation
- [ ] Linux package-path review in CI workflow and desktop bundle configuration
- [ ] Manual Linux verification plan for AppImage plus one package install path
- [ ] `pnpm --filter hop-desktop tauri build --debug --bundles app`

#### Exit Criteria
- [ ] The AppImage IME issue has a clear HOP-owned fix path or a documented non-HOP blocker
- [ ] Flatpak remains a separate enhancement item

## Backlog And Deferred Items

- [ ] Flatpak distribution evaluation after current desktop bug ownership is resolved
- [ ] Possible HOP-owned font-size tuning for top menu and ribbon text if confirmed as separate from upstream rendering
- [ ] Re-triage issue `#3` comment about incomplete undo after Enter as likely upstream editor behavior unless new HOP evidence appears
- [ ] Review whether non-editor chrome context-menu suppression should become a cross-platform hardening rule, not a macOS-only fix

## Verification Surface Summary

- `pnpm --filter @golbin/hop-studio-host test`
- `pnpm run test:desktop`
- `pnpm --filter hop-desktop tauri build --debug --bundles app`

Platform smoke checks:
- macOS: native menu shortcuts, menu labeling, non-editor chrome right-click, quit and window-close behavior
- Windows: common `Ctrl` shortcuts inside desktop app
- Linux: AppImage IME with fcitx5-compatible environment, plus one non-AppImage package path

## Open Questions

- [ ] Should the in-webview top menu remain visible on macOS after native menu parity is improved, or should HOP reduce that surface to lower duplicate behavior?
- [ ] Do we want a follow-up issue split in HOP for Flatpak request versus AppImage IME bug before implementation starts?

## Change Log

- 2026-04-22: Created initial HOP-owned execution plan from open-issue ownership triage.
