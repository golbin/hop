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

### Native color commit follow-up

Windows GUI QA reproduced WebView2 committing a custom color after an outside
mousedown had already hidden HOP's palette. The visibility guard discarded the
valid result. Track the native choice independently and bind it to the document
version captured when the chooser opens. Invalidate that version when loading a
document or disabling editing; consume a native result once. Preview events
still do not edit documents. Cover outside-dismiss-before-change and stale
document results, then rebuild and repeat the native Windows flow. No upstream
or release configuration changes are required; revert this follow-up separately
if a regression is found.

### Completed checks

- Full local suite after the native-picker fix: 288 passed (34 repository,
  165 Studio, 81 desktop, 8 Quick
  Look). Version alignment contract passed again after changing to 0.4.6.
- Desktop and Quick Look Rust formatting/clippy passed with warnings denied.
  Pinned rhwp v0.9.0 verification passed; upstream is unchanged.
- Product commits: `dac9412` (native titles), `f0b624b` (shared zoom/page layout),
  `f3be681` (reviewed editing controls and regression coverage).
- The versioned macOS debug app built successfully. Its main app and both Quick
  Look extensions report 0.4.6 in their bundled metadata.
- macOS native color-grid automation failed through both AX and coordinate
  input. At the user's request, retried in a newly activated document window,
  with physical clicks, double-clicks and the native full-panel action. Repeated
  with the final rebuilt app, an explicitly raised window and keyboard traversal;
  Tab moved through HOP controls instead of entering the native grid. No native
  color confirmation is claimed. No speculative product workaround was added.
  Existing app popup/keyboard checks are documented in the editing-control
  1-pager. This single native-picker check remains a publication gate.
- Linux GUI: installed the CI-built 0.4.6 arm64 deb in an isolated Ubuntu 22.04
  X11/Openbox desktop with WebKitGTK 2.50.4, and operated it through noVNC.
  Font menu display/selection, text/highlight popup exclusivity, Escape, GTK
  native color confirmation, recent colors, filename/dirty titles, Save As and
  reopening passed. Font/color data, recent colors and the 2x2 layout survived
  restart. Two-column width-fit was 76%; 2x2 page-fit was 30%. Product info showed
  HOP 0.4.6 / rhwp 0.9.0. This does not establish Wayland, IME or physical printing.
  The task container and temporary browser were removed after retaining the
  synthetic saved document at `/tmp/hop-046-linux-qa/linux-qa.hwp`.
- Windows 11 arm64 VM, x64 application emulation: the CI MSI installed and file
  associations opened a separate document window. Representative font selection
  applied; Save As to the local Desktop cleared the dirty title. Reopening
  preserved the selected Malgun Gothic font and two-page arrangement. Page-fit
  was 38%, width-fit 64%, and page-fit restored 38%. Product info reported
  HOP 0.4.6 / rhwp 0.9.0. The native color follow-up still needs the rebuilt MSI.
- [Platform workflow](https://github.com/golbin/hop/actions/runs/42554830316)
  builds immutable commit `ecd292a4dc86c6bc00b33c46c88b01db3f8f0de4`, with tests
  enabled and release creation disabled. Linux unit tests, Linux x64/arm64,
  Windows x64 and both macOS build jobs passed. Both Linux architectures' maximum
  GLIBC requirement is 2.35. These artifacts precede the native-picker follow-up;
  a new full matrix builds final product commit
  `ef62dbc1cd985b630af2ef14fddc7d44ee6a2f94` before final verification.
  An intermediate invocation with a short SHA failed at checkout; its full-SHA
  retry was superseded by the final matrix after the document-loading fix.
- No release tag or public release has been created. Remaining verification
  gaps block publication, not artifact preparation.

## Draft release notes

HOP 0.4.6은 문서 편집 편의성을 개선하고 rhwp를 0.9.0으로 업데이트합니다.

- 글꼴 목록이 도구 모음에 잘리지 않으며 마우스와 키보드로 선택할 수 있습니다.
- 글자색 팔레트와 최근 사용한 색 7개를 지원합니다. 글자색과 형광펜 팔레트의
  열기·닫기 동작을 일관되게 정리했습니다.
- 각 문서 창 제목에 파일 이름과 저장하지 않은 변경 표시를 보여줍니다.
- 보기 메뉴와 상태 표시줄의 배율에서 확대·축소 및 여러 쪽 배치를 설정할 수
  있습니다. 폭·쪽 맞춤은 선택한 배치를 반영합니다.
- macOS 창 타일 배치 메뉴를 지원하고 더하기 키 단축키 표시를 수정했습니다.

PR #105, #110 and #123 changes were imported with cherry-pick attribution.
Unclear or unreproduced reports remain open; this release does not claim to fix
clipboard/IME or environment-specific reports without evidence.
