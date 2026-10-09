# upstream 경계

HOP는 `edwardkim/rhwp`를 읽기 전용 upstream 의존성으로 사용한다.

* upstream URL: `https://github.com/edwardkim/rhwp.git`
* submodule 경로: `third_party/rhwp`
* 기준 source, 버전과 커밋: `config/rhwp-upstream.json`이 단일 기준선(SSOT)
* HOP 작업 브랜치: `main`

## 명시적 downstream 엔진 패치

학술대회 양식의 페이지 기준 `Square` 표가 2단 본문과 겹치는 문제는 엔진 fork에서
수정한다. `config/rhwp-upstream.json`의 `source`, `version`, `tag`는 공식 기준 릴리스를
유지하고, `fork.source`, `fork.baseCommit`, `fork.reason`으로 실제 패치 공급원과 이유를
기록한다. `commit`과 submodule pointer는 패치의 불변 커밋을 가리킨다. WASM의
`PROVENANCE.json`에도 같은 fork 정보와 산출물 해시를 기록한다.

`pnpm upstream:verify`는 실제 origin, 공식 tag의 baseCommit, 패치의 ancestry와
생성 WASM 해시를 확인한다. `pnpm upstream:update`는 fork가 남아 있는 동안 중단하여
수정을 조용히 덮어쓰지 않는다. 공식 릴리스가 이 수정을 포함하면 origin과 `.gitmodules`를
공식 공급원으로 되돌리고 fork 메타데이터를 제거한 뒤 기존 업데이트 절차로 전환한다.

## 소유권 규칙

`third_party/rhwp` submodule은 vendor source로 취급한다. HOP 제품 동작을 구현하기 위해 이 폴더 아래 파일을 직접 수정하지 않는다.

HOP가 소유하는 코드는 다음 위치에 둔다.

* `apps/desktop/`: Tauri 셸, native document session, 저장/내보내기/인쇄, 창 관리, 파일 연결, 패키징
* `apps/studio-host/`: HOP studio host, Tauri bridge, desktop event routing, command override, 메뉴 추가, upstream에 패치하지 않을 UI 보정
* `assets/`, `docs/`, `scripts/`, 릴리즈 메타데이터: 제품 수준 자산과 운영 코드

studio host는 Vite alias로 upstream `rhwp-studio`를 가져오고, HOP가 반드시 소유해야 하는 파일만 같은 import 경로로 shadowing한다. 이렇게 하면 upstream 업데이트의 기본 작업이 submodule pointer 갱신과 작은 호환성 조정으로 줄어든다.

`config/rhwp-studio-overrides.json`은 모든 shadow alias의 검토 가능한 목록이다. 각 항목은 upstream
구현을 감싸는 `extension`, 의도적으로 유지하는 `fork`, HOP 전용 `contribution` 중 하나로 분류하고
존재 이유를 기록한다. 경계 테스트는 누락·중복과 사라진 upstream counterpart를 차단한다.
manifest의 counterpart SHA-256 baseline은 extension/fork 대상 upstream 파일의 변경도 감지한다.
업데이트 명령은 바뀐 counterpart 목록을 출력하므로 해당 adapter나 fork를 우선 리뷰한다.
upstream CSS가 직접 참조하는 mirrored public asset도 같은 baseline과 검증 절차로 동기화한다.

제품 TypeScript는 `apps/studio-host/src/upstream` port를 통해서만 upstream API를 사용한다. 명령군은
`apps/studio-host/src/host/command-runtime.ts`에서 typed contribution으로 조립한다. 로컬 글꼴의 브라우저
동작은 upstream에 위임하고 Tauri 확장만 native 조회와 font bytes를 제공한다. desktop과 Quick Look의
Rust 코드는 `apps/desktop/rhwp-adapter`에 의존하며 이 adapter만 `rhwp`를 직접 import한다.

## 통합 프로토콜

각 경계는 한 가지 정책만 소유하고 작은 typed API로 조합한다. upstream 구현을 복사하는 대신 아래
프로토콜을 유지한다.

| 프로토콜 | upstream 소유 | HOP 소유 | 접점과 검증 |
| --- | --- | --- | --- |
| 문서 파일/session | document bytes와 편집 command | native open/save/export/print, 충돌·미저장 guard | `TauriBridge`의 typed invoke와 Rust `rhwp-adapter`; desktop tests |
| 편집 command | command 구현, snapshot/undo, `gotoPage`를 포함한 `CommandServices` | command 조립, WebView clipboard와 desktop shortcut | `host/command-runtime.ts`; command-runtime tests |
| 렌더링 | `CanvasView`, `RendererSession`, page overlay와 ruler 위치 계산 | Canvas2D backend 선택과 host lifecycle 호출 | `host/renderer-session.ts`, `prepareDocumentLoad()` 뒤 `loadDocument()`; boundary tests |
| 글꼴 | browser font discovery와 document font ID | 배포 가능한 font catalog, native font bytes, 제한 글꼴 authoring 정책 | 선택 가능한 catalog/UI 입력을 정규화하고 기존 document font lookup은 보존; font policy tests |
| UI/dialog | 일반 dialog와 studio UI | desktop focus, 최근 문서, native print, 업데이트 UI | manifest의 명시적 extension/fork/contribution; counterpart hash tests |
| WASM/Rust dependency | release source와 API | 불변 tag 선택, 생성 WASM/provenance, 두 native graph | updater와 `upstream:verify` |

렌더러의 backend 선택처럼 제품 정책인 값은 작은 factory에서 한 번만 결정한다. document load처럼 순서가
계약인 동작은 호출부에 명시한다. 파일과 프로세스 side effect는 bridge/native 경계 밖으로 새지 않게 한다.
adapter는 데이터를 변환하거나 구현을 선택할 뿐 upstream 내부 상태를 재구현하지 않는다.

override는 다음 순서로 선택한다.

1. upstream 공개 API를 그대로 사용한다.
2. 제품 차이가 있으면 composition 또는 얇은 extension을 둔다.
3. 독립적인 HOP 기능은 contribution으로 둔다.
4. 공개 접점으로 표현할 수 없을 때만 fork하고 이유와 counterpart hash를 manifest에 기록한다.

업데이트 때 counterpart가 바뀌면 fork를 병합하는 것이 기본값이 아니다. 먼저 upstream이 기존 workaround를
흡수했는지 확인하고, 흡수했다면 HOP 파일·alias·baseline·테스트를 함께 삭제한다. fork가 남아야 한다면
제품 정책과 검증 책임을 다시 기록한다. upstream 동작을 자동으로 고치는 별도 repair path는 두지 않는다.

HOP는 upstream `main.ts`를 그대로 실행하지 않으므로 browser/PWA file handling, embed runtime,
upstream autosave/recovery, theme, optional CanvasKit host wiring 같은 full-host 기능은 자동으로 채택하지
않는다. 이 기능들은 HOP native session·제품 정책과 충돌 여부를 별도로 검토한 뒤 도입한다. HOP bootstrap은
upstream renderer/session과 command API를 조합하고 native 제품 경계만 추가한다. browser 전용 format-save와
print-to-PDF command도 native session을 우회하므로 명시적으로 제외하며, HOP의 Save As와 PDF export가 파일
형식 선택과 side effect를 소유한다.

현재 HOP가 소유하는 studio host override 범위는 다음과 같다.

* `core/bridge-factory`, `core/tauri-bridge`, `core/desktop-events`, `core/font-loader`, `core/local-fonts`: 데스크톱 런타임, 파일 이벤트, 로컬/벤더 폰트 정책
* `command/commands/file`, `command/commands/edit`, `command/shortcut-map`: 데스크톱 파일·clipboard 명령과 HOP 단축키
* `ui/dialog`, `ui/toolbar`, `ui/custom-select`, `ui/print-dialog`: HOP UI와 native 인쇄 정책
* `host/renderer-session`: upstream renderer를 Canvas2D 제품 정책으로 조립
* `styles/*`, `style.css`: HOP가 소유하는 스타일 override
* `main.ts`: upstream이 더 작은 bootstrap hook을 제공하기 전까지 유지하는 앱 bootstrap override
* `vendor/rhwp-core`, `vite-env.d.ts`: upstream release WASM import 경계를 맞추기 위한 generated WASM package와 타입 선언

## 업데이트 절차

실제 업데이트 작업은 [`rhwp 업데이트 운영 매뉴얼`](../operations/RHWP_UPDATE.md)의 준비, diff 리뷰,
검증, smoke test와 복구 체크리스트를 순서대로 따른다. 이 문서에는 경계의 핵심 원칙과 명령만 요약한다.

안정 release tag를 candidate로 준비하는 명령은 다음과 같다. branch나 `main`은 기본 업데이트
대상이 될 수 없으며 tag를 반드시 명시한다.

```sh
pnpm upstream:update -- vX.Y.Z
```

이 명령은 submodule checkout, vendored WASM, desktop과 Quick Look Cargo manifest/lockfile,
`config/rhwp-upstream.json`, WASM provenance를 함께 정렬한다. candidate 생성 후에는 다음을 실행한다.
실행 전 submodule `origin`이 기준선의 공식 source와 일치하고 보호 산출물이 clean인지 확인하며,
WASM 재생성은 생략할 수 없다. Cargo patch는 HOP 제품 정책으로 유지하고, upstream이 같은 patch를 선언할
때에만 그 고정 Git source/revision 또는 vendor path로 두 native graph를 함께 전환한다.

```sh
pnpm upstream:verify
pnpm test
```

기존 shell entrypoint는 호환 목적으로만 남아 있으며 `UPSTREAM_REF`가 필수다.

```sh
UPSTREAM_REF=v0.7.19 scripts/update-upstream.sh
```

업데이트 도구는 submodule release에서 WASM package를 임시 디렉터리에 생성한 뒤
`apps/studio-host/vendor/rhwp-core`에 반영한다. 수동 복구가 필요할 때만 다음 명령을 사용한다.

```sh
(cd third_party/rhwp && wasm-pack build --target web --out-dir ../../apps/studio-host/vendor/rhwp-core --release)
```

업데이트 후에는 다음을 확인한다.

* submodule pointer diff
* `apps/studio-host/vendor/rhwp-core`의 package/provenance/hash와 upstream lock 정합
* desktop과 Quick Look Cargo.lock의 `rhwp` 버전 및 HOP-owned Cargo patch 정합
* `apps/studio-host` override의 타입/import 깨짐
* `apps/desktop/src-tauri`의 native Rust API 깨짐
* HOP가 별도로 보정하던 UI/파일/인쇄/창 이벤트 동작

HOP에 필요한 동작을 upstream이 아직 노출하지 않는다면 먼저 HOP adapter에서 해결한다. 필요한 엔진 API나 버그 수정이 upstream에서 제때 소비될 수 없을 때만 forked upstream 의존성을 고려한다.

## 검증 기준

upstream 갱신은 최소한 다음 검증을 통과해야 한다.

* repo root에서 `pnpm install --frozen-lockfile`
* repo root에서 `pnpm run build:studio`
* `apps/desktop/src-tauri/`에서 `cargo test`
* `apps/desktop/src-tauri/`에서 `cargo clippy -- -D warnings`
* repo root에서 `pnpm --filter hop-desktop tauri build --debug --bundles app`

public beta 빌드는 여기에 더해 macOS와 Windows 또는 Linux 최소 1개 환경에서 HWP/HWPX 열기, 저장, PDF 내보내기, 인쇄, drag/drop, 다중 창 동작을 smoke test한다.
