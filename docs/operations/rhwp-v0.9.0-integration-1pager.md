# rhwp v0.9.0 통합 및 구현 검토

## 배경과 문제

HOP 0.4.5의 엔진 기준을 rhwp v0.8.7에서 v0.9.0
(`c9095c5f67632e6721e800ccc7fb43ea49d26682`)으로 갱신한다.
WASM 생성물, native dependency graph, Studio 연동을 같은 태그로 맞춰야 한다.
v0.9.0은 보정 PDF backend를 `rhwp-svg2pdf`로 직접 vendoring하므로 이전
`svg2pdf` registry patch를 그대로 사용할 수 없다.

구현 검토에서는 사용되지 않는 모달 복사본, Quick Look의 중복 PDF 조립기,
중복 의존성 설정, TOML 정규식 처리, 불필요한 native 기본 기능을 확인했다.

## 목표와 범위

- upstream source를 수정하지 않고 고정 안정 태그로 통합한다.
- HWP/HWPX 파일·저장·글꼴·인쇄·창 정책을 유지한다.
- PDF 조립과 렌더러 상태 관리는 upstream 공개 API에 맡긴다.
- HOP 버전 변경, 새 PDF 가져오기 UI, 연속 형광펜 도입, 커밋·배포는 범위 밖이다.

## 구현

- `pnpm upstream:update -- v0.9.0`으로 submodule, WASM/provenance, 두 Cargo
  lockfile, Studio 기준선을 갱신했다. wasm-pack은 0.14.0, Rust는 1.93.1이다.
- updater는 native 의존성을 먼저 해석하고 WASM을 빌드한다. PDF backend의
  package/path/version은 고정 upstream manifest에서 읽으며 별도 JSON에 복제하지 않는다.
  WASM 빌드에도 대상 release의 Rust toolchain을 명시해 호출 환경의 override에 영향받지 않는다.
- Cargo manifest·lockfile·toolchain은 `smol-toml`로 읽는다. 기존 Git/path patch 전환은
  한 모듈에 유지하고, 실제 선언이 바뀔 때만 manifest를 재작성한다. 빈 patch table도 제거한다.
- native Rust adapter는 upstream 기본 기능을 끈다. desktop은 `DocumentCore`를,
  Quick Look은 명시적으로 `native-skia`를 사용한다. native graph에서 사용하지 않는
  PDF 가져오기와 WASM facade를 제외했다. WASM 생성 방식은 upstream 기본 빌드를 유지한다.
- Quick Look은 PNG 페이지를 SVG로 감싸고 기존 공유 adapter의 PDF 생성 API를 호출한다.
  자체 PDF 객체 조립기와 `svg2pdf`·`usvg`·`pdf-writer` 직접 의존성을 제거했다.
  preview/thumbnail 모두 Skia가 필요하므로 사용하지 않는 비-Skia 분기와 빌드 옵션도 제거했다.
- HOP 모달 복사본은 production 대화상자에서 사용되지 않았다. 복사본·전용 fake-DOM 테스트·
  override·counterpart hash를 제거하고 닫힘 이벤트 상수를 upstream adapter에서 재수출한다.
- 문서 열기·새 문서의 공통 초기화 경로에서 `document-swapped`를 발행한다.
  표 resize 캐시 초기화는 upstream InputHandler가 처리한다.
- HOP의 기존 형광펜 동작과 글꼴 정책을 유지한다. 새 설정 화면의 글꼴 비교 helper를
  전달하고, shared PDF worker의 WASM import를 HOP의 vendored module로 연결한다.
  Vite 요구 버전은 upstream과 같은 `^8.3.5`다.

## 검증

| 검사 | 결과 |
| --- | --- |
| frozen pnpm 설치 | 통과 |
| upstream 계약 및 clean submodule | 통과 |
| upstream/경계 테스트 | 34개 통과 |
| Studio 테스트 | 149개 통과 |
| Studio 타입 검사·production build | 통과 |
| desktop 테스트 | 81개 통과 |
| Quick Look 테스트 | 8개 통과 |
| desktop·Quick Look clippy (warnings denied) | 통과 |
| macOS debug app·Quick Look extension build | 통과 |
| macOS 기본 문서 GUI | HWP/HWPX 열기·편집·저장, 새 문서 생성·저장, 인쇄 진입·취소 통과 |

Cargo 테스트는 유효한 TOML 표기, Git/path patch 전환, 다른 의존성 보존, vendor 경로
이탈·수정 거부를 확인한다. Quick Look은 sample PNG/PDF와 두 페이지의 이미지 포함·쪽 수·
물리 크기(96 CSS px → 72 pt)를 검사한다. native 기능 축소로 lockfile에서 각각 53개,
55개 package가 제거됐으며 다른 package 버전은 올리지 않았다.

생성 WASM으로 한글 문서 생성·편집·SVG 렌더 및 HWP/HWPX 저장·재열기를 확인했다.
암호 저장본 두 형식도 왕복하고, 암호 누락·오입력 거부를 확인했다. WASM은 이번 재검토에서
재생성하거나 변경하지 않았다.
macOS 앱에서 저장한 두 임시 HWP 파일도 WASM으로 다시 열어 편집 내용 보존을 확인했다.
전체 자동 테스트는 272개다.

로컬 검증은 외부 Node 26.4.0과 pnpm 10.33.0을 사용한다. macOS 27의
[Rust dylib strip 문제](https://github.com/rust-lang/rust/issues/157750)를 피하기 위해
`CARGO_PROFILE_DEV_STRIP=none`, `CARGO_PROFILE_TEST_STRIP=none`,
`CARGO_PROFILE_RELEASE_STRIP=none`을 사용했다. 디스크 사용량을 줄이기 위해 debug info와
incremental compilation을 껐다. 제품의 macOS minimum deployment target은 유지했다.

## 복구와 남은 검증

updater 실패 시 HOP-owned manifest·lockfile·WASM·기준선과 이전 submodule commit을
백업에서 복구한다. 첫 실행의 PDF patch 해석 실패에서 실제 복구와 이전 계약 통과를 확인했다.
복구 자체가 실패하면 백업을 지우지 않고 위치를 출력하도록 수정했다.
이번 검토 변경은 해당 파일만 되돌려 복구하며 태그 이동이나 history rewrite를 하지 않는다.

macOS debug 앱은 `apps/desktop/src-tauri/target/debug/bundle/macos/HOP.app`에 생성한다.
실제 프린터 출력·다중 창·drag/drop·한글 IME, 복잡한 문서와 다른 편집기 비교,
Windows/Linux build·GUI 검증은 배포 전에 확인해야 한다.
