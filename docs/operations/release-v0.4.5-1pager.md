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
The committed macOS debug app (7cf699c) passed visual smoke checks for new/edit,
p/P and Korean text paste, save/reopen/Save As, three-page HWPX open, PDF export
and HWP conversion, password retry/cancel/open and original-save protection,
zoom retention, toolbar labels, separate windows, and print-dialog cancellation.
Product info confirmed HOP 0.4.5 and rhwp 0.8.7; the encrypted fixture stayed unchanged.
Physical printing, Korean IME composition, and Windows/Linux UI remain unverified.
Release workflow [37732271918](https://github.com/golbin/hop/actions/runs/37732271918)
passed tests and all five platform builds. Both macOS architectures passed Apple
notarization and app/Quick Look code-sign verification; Linux ABI checks passed.
All 20 release files match GitHub's uploaded asset digests, the 19 listed SHA-256
checksums match, and all 13 updater entries match their assets/signatures.
All eight updater signatures were cryptographically verified with the public key
shipped in the app. The macOS ARM64 updater archive also passed local strict
code-sign verification, Gatekeeper (Notarized Developer ID), and stapler validation.
Additional GUI startup of that signed archive was blocked by the Mac lock screen;
the committed debug-app visual smoke results above remain the actual UI evidence.

[v0.4.5](https://github.com/golbin/hop/releases/tag/v0.4.5) was published as the
latest stable release with 20 assets. The public latest updater feed matches the
verified manifest. Issues #94, #95, #97, #98, #100 and superseded PR #101 received
short release comments and were closed. #98's comment explicitly distinguishes
the common desktop fix/macOS QA from unverified Ubuntu UI. Reproduced issue #96
and other unresolved/environment-specific reports remain open.
