# HOP v0.4.5 Release 1-Pager

## Background / Problem

rhwp v0.8.7 integration and the reviewed HOP issue fixes are local. v0.4.4 still
ships the previous upstream baseline and lacks password-open and toolbar-label controls.

## Goal / Non-goals

Release the verified changes as v0.4.5 on macOS arm64/x64, Windows x64 and Linux
x64/arm64. Confirm local static gates, commit, visually smoke-test the committed
Mac application, then build all release artifacts as an unpublished draft.
Publish only after every selected platform succeeds and assets/checksums/updater
manifest are verified. Do not claim unresolved clipboard issue #96 is fixed.

## Constraints / Implementation

Keep upstream read-only, align every HOP version source, retain existing stable
asset names and signing/notarization policies. Use the existing release workflow
with tests enabled and build_ref equal to the immutable release tag. Push main
only by fast-forward after checking its remote tip. No forced pushes or moved tags.

## Verification

Run pnpm test, upstream verification, Rust formatting/clippy, actionlint, and
Studio typecheck/build. Visually check create/edit/open/save/reopen/Save As,
HWPX open/export, password cancellation/retry, zoom, labels, new windows and
PDF/print-dialog cancellation on this Mac. GitHub Actions supplies supported
platform builds and Linux tests/ABI checks; it does not supply Windows/Linux UI QA.
After publication close only issues/PRs supported by the shipped fixes, with a
short release reference; retain OS-specific or still-reproducing bugs.

## Recovery

Fix local failures before committing/tagging. Leave failed draft builds unpublished.
If a tag has been pushed, never move it; fix forward with a new patch release.
An existing independently reproduced bug is recorded separately from a regression
introduced by these changes. Never publish a newly discovered release-blocking regression.

## Results

Local static gates passed: upstream tests 34, Studio tests 159, desktop tests 81,
Quick Look tests 6, desktop clippy, desktop/Quick Look Rust format checks,
upstream contract verification, actionlint, and Studio TypeScript/production build.
After version alignment, upstream/version/workflow contract tests passed again.
Existing Vite chunk-size and mixed static/dynamic import warnings remain.
Grouped workflow output redirects to resolve the three existing shellcheck style warnings.
Committed-app smoke test and release verification remain pending.
