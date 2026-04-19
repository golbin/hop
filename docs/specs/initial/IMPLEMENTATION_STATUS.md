# HOP 초기 스펙 구현 상태

이 문서는 [SPEC.md](SPEC.md)를 기준으로 현재 구현 상태를 추적한다.

## 구현됨

* repo를 독립적인 HOP 앱 구조로 재구성했다.
* `third_party/rhwp`를 읽기 전용 upstream submodule로 추가하고 기준 커밋에 고정했다.
* Tauri 데스크톱 앱을 `apps/desktop/`에 두었다.
* upstream `rhwp-studio` 위에 얹는 HOP 소유 overlay를 `apps/studio-host/`에 추가했다.
* HOP desktop bridge, menu, drag/drop, print, custom select styling을 upstream submodule 밖으로 분리했다.
* 프론트엔드 엔진 import를 published `@rhwp/core` 패키지로 연결했다.
* native Rust 의존성을 repo root crate가 아니라 `third_party/rhwp` submodule로 연결했다.
* HOP 앱 메타데이터, bundle identifier `net.golbin.hop`, `.hwp`/`.hwpx` 파일 연결을 추가했다.
* Rust desktop document session에 `doc_id`, source path, format, dirty flag, revision, `DocumentCore`, SVG cache를 포함했다.
* Tauri command로 create/open/open-with-bytes/close/save/save-as/render/query/mutate/export/print/reveal/new-window 흐름을 추가했다.
* 같은 디렉터리 임시 파일을 사용하는 atomic HWP save를 추가했다.
* native Rust SVG-to-PDF pipeline을 통한 PDF export를 추가했다.
* webview 안에서 인쇄용 DOM을 준비하고 native webview print를 호출하는 경로를 추가했다.
* 인쇄용 staged SVG를 webview print DOM에 넣기 전에 sanitize하도록 했다.
* 프론트엔드 편집 이벤트 기반 dirty 상태 추적, 창 닫기 전 저장 확인, 저장/저장 안 함/취소 흐름을 추가했다.
* 원본 파일의 크기/수정시각 baseline을 세션에 저장하고, 저장 직전 외부 변경 overwrite 경고를 표시하도록 했다.
* single-instance 처리, 다중 창 menu targeting, 동적으로 생성된 창의 drag/drop routing을 추가했다.
* macOS, Windows, Linux에서 native app menu event가 focused editor window로 라우팅되도록 했다.
* 새 창 생성 시 Tauri 설정의 기본 창 크기를 사용하도록 했다.
* 동적으로 생성된 editor window가 production CSP와 Tauri capability scope 안에 들어오도록 했다.
* `assets/fonts`의 번들 폰트를 studio host가 로컬에서 제공하도록 HOP 소유 web font loading을 추가했다.
* studio host dev server가 localhost에만 bind되도록 제한했다.
* 데스크톱 번들 빌드, workflow artifact 생성, draft GitHub Release 생성을 위한 GitHub Actions workflow를 추가했다.
* PR workflow trigger가 desktop/studio 코드뿐 아니라 root npm lockfile과 번들 폰트 변경도 감지하도록 했다.
* upstream command/type module을 가능한 한 재사용해 HOP studio overlay 범위를 줄였다.
* upstream `third_party/rhwp`는 clean/read-only 상태를 유지하고, HOP 동작은 app-owned adapter에 두었다.
* JavaScript dependency lock을 root workspace `package-lock.json`으로 통합했다.

## 중요한 public beta 미구현 항목

* HWPX 저장은 의도적으로 막아 두었다. HWPX 열기는 parser를 통해 가능하지만, 안전한 HWPX serializer가 준비되기 전까지 `.hwpx` 저장은 typed error로 실패한다.
* autosave/recovery는 아직 구현되지 않았다.
* 외부 파일 변경은 저장 직전에 baseline 비교로 막는다. 백그라운드 file watcher와 reload 안내 UI는 아직 구현되지 않았다.
* 큰 문서의 visible-first pagination은 아직 완전히 native-authoritative 구조가 아니다. 기존 동기식 editor UI를 유지하기 위해 desktop bridge가 WASM mirror를 함께 들고 있으므로, open/save/export 일부 구간은 transitional compatibility path로 HWP bytes를 IPC로 복사한다.
* updater signing/manifest는 public key, endpoint, signing credential이 준비되지 않아 아직 켜지 않았다.
* Windows code signing과 macOS notarization은 아직 설정되지 않았다.
* `apps/studio-host/src/main.ts`와 `apps/studio-host/src/ui/toolbar.ts`는 upstream이 더 작은 bootstrap/custom-select extension point를 제공하기 전까지 가장 큰 shadow file로 남아 있다.

## 완료한 검증

* repo root에서 `npm ci`
* repo root에서 `npm run build:studio`
* `apps/desktop/src-tauri`에서 `cargo test`
* `apps/desktop/src-tauri`에서 `cargo clippy -- -D warnings`
* repo root에서 `npm --workspace apps/desktop run tauri -- build --debug --bundles app`
* repo root에서 `npm run build:desktop`
