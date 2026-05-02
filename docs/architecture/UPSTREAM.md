# upstream 경계

HOP는 `edwardkim/rhwp`를 읽기 전용 upstream 의존성으로 사용한다.

* upstream URL: `https://github.com/edwardkim/rhwp.git`
* submodule 경로: `third_party/rhwp`
* 기준 고정 커밋: `0fb3e6758b8ad11d2f3c3849c83b914684e83863` (`v0.7.9`)
* HOP 작업 브랜치: `main`

## 소유권 규칙

`third_party/rhwp` submodule은 vendor source로 취급한다. HOP 제품 동작을 구현하기 위해 이 폴더 아래 파일을 직접 수정하지 않는다.

HOP가 소유하는 코드는 다음 위치에 둔다.

* `apps/desktop/`: Tauri 셸, native document session, 저장/내보내기/인쇄, 창 관리, 파일 연결, 패키징
* `apps/studio-host/`: HOP studio host, Tauri bridge, desktop event routing, command override, 메뉴 추가, upstream에 패치하지 않을 UI 보정
* `assets/`, `docs/`, `scripts/`, 릴리즈 메타데이터: 제품 수준 자산과 운영 코드

studio host는 Vite alias로 upstream `rhwp-studio`를 가져오고, HOP가 반드시 소유해야 하는 파일만 같은 import 경로로 shadowing한다. 이렇게 하면 upstream 업데이트의 기본 작업이 submodule pointer 갱신과 작은 호환성 조정으로 줄어든다.

현재 HOP가 소유하는 studio host override 범위는 다음과 같다.

* `core/bridge-factory`, `core/tauri-bridge`, `core/desktop-events`, `core/font-loader`, `core/font-application`, `core/local-fonts`: 데스크톱 런타임, 파일 이벤트, 로컬/벤더 폰트 연동
* `command/commands/file`, `command/commands/format`, `command/commands/table`, `command/shortcut-map`: 데스크톱 파일 명령, 로컬 폰트 적용 보정, 표 선택 접근성, HOP 단축키
* `engine/*`: 표/셀 선택, Linux IME 입력 앵커, 선택 렌더러처럼 upstream에 패치하지 않을 편집 동작 보정
* `ui/dialog`, `ui/style-edit-dialog`, `ui/toolbar`, `ui/custom-select`, `ui/print-dialog`: HOP UI 보정, 인쇄 준비
* `view/*`: 데스크톱 viewport/page positioning, ruler 보정
* `styles/*`, `style.css`: HOP가 소유하는 스타일 override
* `main.ts`: upstream이 더 작은 bootstrap hook을 제공하기 전까지 유지하는 앱 bootstrap override
* `vite-env.d.ts`: published `@rhwp/core`와 upstream WASM import 경계를 맞추기 위한 타입 선언

## 업데이트 절차

기본 업데이트 명령은 다음과 같다.

```sh
RUN_CHECKS=1 scripts/update-upstream.sh
```

스크립트는 기본적으로 `third_party/rhwp`를 upstream `main`으로 갱신한다. 다른 브랜치를 시험하려면 다음처럼 실행한다.

```sh
UPSTREAM_BRANCH=devel RUN_CHECKS=1 scripts/update-upstream.sh
```

release tag나 특정 commit으로 pinning하려면 `UPSTREAM_REF`를 사용한다.

```sh
UPSTREAM_REF=v0.7.9 RUN_CHECKS=1 scripts/update-upstream.sh
```

업데이트 후에는 다음을 확인한다.

* submodule pointer diff
* `apps/studio-host`의 `@rhwp/core` 버전과 `apps/desktop/src-tauri/Cargo.lock`의 `rhwp` 버전 정합
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
