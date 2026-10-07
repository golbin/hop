# rhwp v0.8.7 통합 계획

작성일: 2026-10-07. 상태: 구현 및 로컬 자동 검증 완료. 배포 전 OS별 GUI 검증은 남아 있다.

## Background

HOP v0.4.4의 upstream 기준은 rhwp v0.8.4
(`496333b27d21ddb9114ba9ae340bcb895870c9a7`)다. 공식 Releases의 최신 안정 버전은
2026-10-06 공개된 v0.8.7이며, 원격 태그는
`1a76570e833917d15817415a53c09ad61ab3203f`를 가리킨다.
v0.8.6의 변경도 포함하여 v0.8.4에서 직접 갱신한다.

근거: [v0.8.7 릴리스](https://github.com/edwardkim/rhwp/releases/tag/v0.8.7),
[v0.8.6 릴리스](https://github.com/edwardkim/rhwp/releases/tag/v0.8.6),
[대상 Cargo manifest](https://github.com/edwardkim/rhwp/blob/v0.8.7/Cargo.toml),
[Studio command 계약](https://github.com/edwardkim/rhwp/blob/v0.8.7/rhwp-studio/src/command/types.ts).
실행 절차는 [업데이트 운영 매뉴얼](RHWP_UPDATE.md)을 따른다.

## Problem

태그와 WASM만 교체해서는 native PDF 의존성과 HOP Studio 계약을 맞출 수 없다.
현재 checkout의 submodule은 초기화되지 않았으므로 로컬 upstream 검증도 아직 실행할 수 없다.
원격 안정 태그의 파일과 HOP 코드를 대조해 다음을 확인했다.

| 확인한 변화 | HOP 영향과 대응 |
| --- | --- |
| upstream의 `svg2pdf` patch가 Git에서 `vendor/svg2pdf` path로 전환 | updater의 `resolveHopCargoPatches()`는 Git lock source만 허용한다. 현 상태로는 candidate 생성이 중단될 것으로 예상된다. desktop·Quick Look 최상위 manifest 모두 새 patch를 적용해야 한다. |
| `CommandServices.refreshDocumentStatus()` 필수 추가 | `host/command-runtime.ts`의 services 생성과 테스트 fixture에 실제 상태 갱신 연결이 필요하다. 빈 함수로 타입만 맞추지 않는다. |
| 추적 counterpart 8개 모두 변경 | `core/font-loader`, `core/local-fonts`, `command/shortcut-map`, `command/commands/edit`, `command/commands/file`, `ui/about-dialog`, `ui/dialog`, `ui/toolbar`를 모두 검토한다. hash 갱신은 검토 완료를 뜻하지 않는다. |
| host font provider 연결과 측정·출력 개선 | HOP은 upstream `main.ts`를 실행하지 않는다. 새 font provider 연결이 HOP bootstrap에도 필요한지 확인하고 native 글꼴·authoring 정책과 함께 검증한다. |
| `RendererSession` CanvasKit preflight callback의 nullable 계약 변경 | HOP Canvas2D lifecycle와 관련 타입/import를 확인한다. backend 변경은 이번 범위에 포함하지 않는다. |
| upstream Rust 내부 crate 분리 및 의존성 변경 | 새 path crate가 두 native graph와 WASM에서 정상 해석되는지 확인한다. `native-skia` 활성 빌드에서는 Skia 변경도 검증한다. |
| Studio 의존성 요구 변경 | `@noble/hashes`, `canvaskit-wasm` 등 실제 소비 import/API를 확인한다. 필요할 때만 HOP manifest와 pnpm lockfile을 함께 조정한다. |

## Goal

- submodule, 생성 WASM/provenance, 기준선, desktop·Quick Look dependency graph를 v0.8.7로 정렬한다.
- 저장·표 편집·입력 안전성·조판 개선을 HOP의 파일/session/글꼴/인쇄 정책과 함께 소비한다.
- upstream이 흡수한 workaround는 삭제하고 남는 정책은 얇은 adapter로 유지한다.
- 자동 검증과 실제 문서 검증 결과를 구분하여 기록한다.

## Non-goals

- upstream source 직접 수정, HOP 버전 변경, 커밋·태그·배포 실행.
- 영어 UI, HTML/Word 내보내기, agent/CLI, browser autosave 등 신규 제품 기능의 일괄 도입.
- CanvasKit 전환이나 exact font/compatibility opt-in의 기본 활성화.

## Constraints

- pnpm과 외부 Node 24를 사용한다. 대상 Rust는 현재와 같은 `1.93.1`, wasm-pack은 `0.14.0`을 유지한다.
- 파일·저장·PDF·인쇄·창의 side effect는 Rust/native bridge가 소유한다.
- macOS, Windows, Linux를 보존하며 무관한 변경은 건드리지 않는다.
- updater가 보호하는 산출물은 실행 전에 clean이어야 한다. updater 호환 수정은 먼저 검증하고
  파일별로 변경을 보존한다. 광범위한 reset/stash로 정리하지 않는다.

## Implementation outline

1. **현재 기준선 준비**: submodule을 기존 gitlink로 초기화하고 frozen pnpm 설치 후
   `pnpm upstream:verify`를 실행한다. 도구 버전과 기존 실패가 있으면 기록한다.
2. **updater 선행 수정**: upstream vendor patch 내용과 provenance를 검토한다. 기존 Git patch
   계약에 path patch 표현을 추가하고, submodule 내부의 검증된 경로만 허용한다. desktop과
   Quick Look manifest에는 각 manifest 기준 상대 경로를 생성한다. config, 검증기, lock 검사,
   업데이트 테스트와 운영 문서를 함께 조정한다. 기존 Git pin 지원을 유지한다.
   vendor path package는 lockfile에 Git source가 없으므로 경로·package 버전·고정 commit과 clean checkout으로
   계약을 확인한다. 성공과 실패 시 rollback을 focused test로 검증한다.
3. **candidate 생성**: `pnpm upstream:update -- v0.8.7`을 실행한다. 태그가 위 commit과
   일치하는지 재확인하고 WASM을 새로 생성한다. 두 Cargo lock, patch, assets, provenance와
   counterpart baseline의 diff를 검토한다.
4. **Studio 호환 수정**: 8개 counterpart와 bootstrap/bridge/renderer/command 공개 API를
   v0.8.4 대비 검토한다. `refreshDocumentStatus`를 HOP의 저장 후 문서명·상태 갱신에 연결한다.
   글꼴 provider/측정, IME, overwrite 모드, 검색, 표 clipboard·undo 계약을 확인한다.
   workaround가 흡수됐으면 override·alias·전용 테스트를 같이 제거한다.
5. **native 호환 수정**: `rhwp-adapter`의 DocumentCore, 문단 분리, 썸네일, PDF API와
   desktop·Quick Look 호출부를 확인한다. PDF stitching vendor 수정이 두 native graph에서
   실제 선택되는지 dependency tree로 확인한다.
6. **검증 및 결과 기록**: 아래 검증을 순서대로 수행하고 중요 실패를 수정한다.
   변경이 끝나면 필요 시 저장소 지정 리뷰 모델 GPT-6.1 Sol로 경계·저장·rollback을 직접 리뷰한다.

## Verification plan

먼저 updater/path patch 계약의 focused test와 관련 command/font/bridge 테스트를 실행한다.
이후 Rust toolchain을 `1.93.1`로 지정하여 다음을 실행한다.

```sh
pnpm upstream:verify
pnpm test
pnpm run clippy:desktop
pnpm run build:studio
pnpm --filter hop-desktop tauri build --debug --bundles app
git diff --check
```

실제 문서는 변경 전 v0.8.4 결과와 비교한다. 원본은 보존하고 저장 왕복은 복사본으로 검증한다.

| 검증 범위 | 완료 조건 |
| --- | --- |
| HWP/HWPX 열기·편집·저장·재열기 | 내용·구조·표·머리말/꼬리말 보존. 저장 byte 차이만으로 실패 판정하지 않는다. 가능하면 한컴에서도 저장본을 확인한다. |
| 중첩/rowspan/연속 TAC 표와 페이지 분할 | 누락·겹침·테두리 회귀가 없고 표 뒤 Enter, 선택·삭제·붙여넣기·undo가 정상이다. |
| 한글 IME·찾기/치환·하이퍼링크 | 조합 입력과 취소, 중첩 셀 검색, 링크 저장·PDF 보존에 회귀가 없다. |
| 로컬/동봉/누락 글꼴 | native font discovery·적용·fallback 및 HOP authoring 제한을 유지하고 화면·PDF 결과가 일관된다. |
| PDF·인쇄·Quick Look | 검색/복사 가능한 한글, 링크, 페이지 범위, 다중 페이지 결합과 preview/thumbnail을 확인한다. |
| HOP 제품 흐름 | drag/drop·최근 문서·다중 창 격리·미저장 guard·외부 변경 충돌·저장 후 제목 갱신이 정상이다. |
| 입력 실패 | 대표 손상/과도한 입력을 안전하게 거부하고 이후 정상 문서를 열 수 있다. 비공개 문서 내용은 로그에 남기지 않는다. |

배포 전 macOS·Windows·Linux 빌드/CI를 모두 확인하고 macOS 외 Windows 또는 Linux 한 환경에서
핵심 파일·창·인쇄 GUI 흐름을 추가 확인한다. 사용할 workflow는 release 생성 없이 실행한다.
수행하지 못한 OS 검증은 미완료로 남긴다.

## Rollback / recovery

- updater 실패 시 기존 파일과 v0.8.4 commit 자동 복구 후 status와 upstream 계약을 확인한다.
- candidate 성공 후 제품 회귀가 해결되지 않으면 이번 작업 소유 산출물·호환 수정만 준비 전
  상태로 복원한다. 수정한 updater는 Git/path 양쪽 계약을 지원하므로 이전 Git 기준선도 검증한다.
- 자동 복구 실패 시 오류와 현재 변경을 보존한 뒤 파일별 복구한다. history rewrite는 사용하지 않는다.

완료 기준: 모든 upstream 산출물 정렬, 변경 counterpart 검토, 중요 회귀 해소, 요구 검증 결과 기록,
submodule 내부 clean.

## Implementation / verification results

### 전체 변경 재검토 및 개선

고정 commit으로 관리하는 read-only submodule에 vendor 내용 hash를 별도로 두면 같은 소스의
기준선이 중복되고 파일별 Git subprocess와 순환 재수출까지 유지하게 된다. 목표는 기존
Git patch 지원과 안전한 업데이트/복구 계약을 유지하면서 검증의 기준을 하나로 만드는 것이다.
Cargo patch 모듈을 직접 import하고 vendor path/version은 고정 commit 및 clean checkout으로
보증한다. tracked 수정·untracked 추가·경로 이탈을 focused test와 upstream verify로 확인한다.
Studio 코드·생성 WASM·Cargo graph·제품 정책은 유지한다.
검증 실패 시 이번 재검토 변경만 복구하며 upstream tag를 이동하거나 source를 수정하지 않는다.

위 단순화를 반영하고 `pnpm run test:upstream` 34개, `pnpm upstream:verify`,
`git diff --check`를 다시 통과했다. Studio/native 코드는 이번 재검토에서 수정하지 않았으므로
아래 기존 테스트·빌드 결과를 유지하고 반복 실행하지 않았다. GPT-6.1 Sol이 전체 변경 및
검증 설계 변경을 직접 검토했으며 중요 문제는 발견하지 못했다.

- 명시적 `pnpm upstream:update -- v0.8.7` 실행으로 대상 commit, WASM, provenance,
  counterpart 기준선, desktop·Quick Look Cargo graph를 갱신했다. upstream 내부는 clean이다.
- updater와 검증기는 기존 Git pin 및 vendor path를 모두 지원한다. 경로 containment,
  package 이름·버전, 고정 commit 및 clean checkout을 검증한다.
  workspace에서 상속한 vendor package 버전도 처리한다.
- 저장 후 상태 갱신, 새 renderer font API, IME 물리키 단축키, 키보드 toolbar 활성화,
  modal 종료 후 입력 포커스, style toolbar overflow 계약을 반영했다.
  HOP의 native 글꼴·authoring 정책과 HTML/Word export 차단은 유지했다.
- 기존 큰 bootstrap/toolbar 파일은 upstream 계약과 HOP 정책 연결에 필요한 부분만 수정했다.
  이번 변경만을 위해 파일 구조를 재편하지 않았으며 새 Cargo patch 모듈은 분리했다.
- Node 24.4.1, pnpm 10.33.0, Rust 1.93.1로 검증했다.

| 실제 실행 | 결과 |
| --- | --- |
| `pnpm upstream:verify` | v0.8.7 계약 및 생성 산출물 검증 통과 |
| `pnpm run test:upstream` | 34개 통과. Git/path 전환, provenance, boundary 포함 |
| `pnpm run test:studio` | 145개 통과 |
| `pnpm run test:desktop` | 81개 통과 (lib 60, integration 21) |
| `pnpm run test:quicklook:macos` | native-skia 활성 6개 통과 |
| `pnpm run clippy:desktop` | 경고를 오류로 처리하여 통과 |
| `pnpm run build:studio` | 통과. 기존 chunk 크기 및 dynamic import 경고 있음 |
| `pnpm --filter hop-desktop tauri build --debug --bundles app` | macOS HOP.app 및 Quick Look 빌드 통과 |
| Chromium 실행 확인 | v0.8.7 초기화, 새 문서 입력·렌더, 찾기 패널, 글자 모양 modal 닫기·편집 포커스 복귀 확인 |
| WASM 저장 왕복 | 합성 한글 문서를 HWP/HWPX로 각각 저장·재열기하여 텍스트 보존, 1페이지 및 SVG 렌더 확인 |
| 초기 직접 리뷰 (GPT-6 Sol) | 근거 있는 중요 문제 없음 |
| 전체 변경·검증 설계 재검토 (GPT-6.1 Sol) | 근거 있는 중요 문제 없음 |

실제 복잡한 문서·한컴 교차 확인, 한글 IME 조합, native 파일/인쇄/창 GUI,
Windows·Linux 빌드/GUI 검증은 수행하지 않았다. 위 합성 문서 왕복을 이들 검증의 대체로 보지 않는다.
배포 전에 Verification plan의 해당 항목을 실행한다. 커밋·제품 버전 변경·배포는 하지 않았다.
