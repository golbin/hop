# HOP 초기 제품 개발 SPEC

이 문서는 HOP public beta를 위한 초기 제품 스펙이다. 현재 구현 상태와 남은 gap은 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)에서 추적한다.

## 0. 제품 정의

**제품명: HOP**

**HOP is Open HWP.** HOP는 HWP/HWPX 문서를 열고, 편집하고, 저장하고, PDF로 내보내는 오픈 데스크톱 문서 편집기다. 1차 제품은 `rhwp`의 Rust 문서 코어와 `rhwp-studio` UI 자산을 기반으로 하되, 웹 데모가 아니라 Windows, macOS, Linux에서 실제 문서를 다룰 수 있는 독립 실행형 앱을 목표로 한다.

### 한 줄 설명

HOP는 HWP/HWPX 문서를 위한 오픈 데스크톱 편집기다.

### 1차 사용자

* HWP/HWPX 문서를 열어 확인하고 PDF로 제출해야 하는 개인 사용자
* 한컴오피스가 기본 제공되지 않는 macOS/Linux 환경의 사용자
* 자동화/검증/문서 변환을 위해 오픈 문서 코어가 필요한 개발자와 조직

### 제품 원칙

* **문서 보존 우선**: 편집기가 이해하지 못한 문서 구조도 가능한 한 손실 없이 유지한다.
* **오픈 포맷 우선**: HWPX 지원을 장기 기준으로 삼되, 기존 HWP 파일도 1차 시민으로 다룬다.
* **로컬 우선**: 사용자 문서는 기본적으로 로컬에서 처리하고, 네트워크 전송을 전제로 설계하지 않는다.
* **3개 OS 동등성**: Windows/macOS/Linux에서 핵심 열기-편집-저장-출력 흐름을 모두 release gate로 둔다.

## 1. 설계 기준

기준 버전은 HOP repository의 lockfile과 Tauri 설정을 source of truth로 삼는다. 현재 앱은 Tauri 2, Rust stable, Node 24 계열, Vite/TypeScript 기반 `apps/studio-host`, 그리고 `third_party/rhwp` submodule을 사용한다. `rhwp-studio`는 TypeScript+Vite 웹 에디터이며, 코어는 `document_core`의 commands/queries 구조와 WASM API를 통해 연결되어 있다. 데스크톱 설계에서는 기존 studio 구조를 재사용하되, HOP 전용 파일 I/O와 OS 연동은 Tauri app layer가 소유한다. ([Rust Blog][1])

또한 현재 `Cargo.toml`에는 **비-WASM 타깃 전용 PDF 의존성**으로 `svg2pdf`, `usvg`, `pdf-writer`, `subsetter`, `ttf-parser`가 이미 들어가 있다. 즉 PDF 내보내기는 새로 방향을 정하는 기능이 아니라, 데스크톱 네이티브 경로로 올리는 것이 코드베이스와 가장 잘 맞는다. ([GitHub][2])

## 2. 제품 목표

HOP 1차 데스크톱의 목표는 “웹 데모를 데스크톱으로 감싼 것”이 아니라, **실사용 가능한 문서 편집기**를 내는 것이다. 따라서 아래 네 가지를 1차 출시 기준으로 묶는다.

* **파일 입출력 완성**: HWP/HWPX 불러오기, 저장, 다른 이름으로 저장, 최근 문서, 파일 연결, 외부 변경 감지
* **출력 완성**: PDF 내보내기, 인쇄/인쇄 미리보기
* **대용량 안정성**: 큰 문서도 멈추지 않고 점진적으로 열림
* **3개 OS 완성도**: Windows, macOS, Linux에서 동일한 핵심 시나리오가 동작

현재 `rhwp`는 이미 HWP/HWPX 파싱, 편집, hwpctl-compatible action layer, SVG export, HWP save roundtrip을 갖고 있지만, 공개 이슈에는 **HWPX serializer 관련 작업**과 **Ctrl+S 저장 문제**가 남아 있다. 따라서 데스크톱 1차는 “앱 셸”보다 **저장 안정화와 출력 완성**이 우선이다. ([GitHub][3])

### 1차 범위

1차 범위는 사용자가 기존 HWP/HWPX 문서를 열고, 기본 편집을 수행하고, 원본 경로에 저장하거나 다른 이름으로 저장하고, PDF로 제출 가능한 결과물을 만드는 흐름이다.

포함:

* 로컬 HWP/HWPX 문서 열기/저장/다른 이름으로 저장
* 기본 편집, 검색, 줌, 페이지 이동, 표 편집
* 자동 저장과 비정상 종료 복구
* PDF 내보내기와 인쇄 경로
* 파일 연결, 최근 문서, native menu, 자동 업데이트

명시적으로 제외:

* 실시간 공동 편집
* 클라우드 동기화와 계정 시스템
* 모바일 앱
* 매크로 실행 환경
* 모든 HWP 개체의 100% 편집 UI 제공

제외 항목은 제품 방향에서 버리는 것이 아니라 1차 릴리즈 게이트에서 빼는 항목이다. 단, 편집 UI가 없는 개체라도 저장 라운드트립에서 보존하는 것은 1차 범위에 포함한다.

## 3. 1차 릴리즈 게이트

아래는 **빠지면 안 되는 1차 필수 기능**이다.

### 문서 기본

* 새 문서
* HWP 열기
* HWPX 열기
* HWP 저장
* HWPX 저장
* 다른 이름으로 저장
* 최근 문서
* 원본 파일 경로로 `Ctrl/Cmd+S`
* 파일 더블클릭으로 열기
* 드래그 앤 드롭으로 열기
* 읽기 전용 파일 열기 처리
* 외부에서 파일이 바뀌었을 때 reload 안내

### 편집 기본

* 한글 IME 입력
* Undo / Redo
* Cut / Copy / Paste
* 문자/문단 서식
* 표 생성/행열 편집
* Find
* Zoom In/Out
* 페이지 이동
* 다중 문서 창

### 안정성

* 자동 저장
* 비정상 종료 복구
* 저장 전 dirty 상태 표시
* 창 닫기 시 저장 확인
* 손상 파일/부분 손상 파일 오류 메시지
* 폰트 누락 감지와 대체 폰트 안내

### 출력

* PDF 내보내기
* 페이지 범위 PDF 내보내기
* 내보내기 진행률 표시
* 인쇄 미리보기
* 인쇄

### 배포/OS 연동

* `.hwp`, `.hwpx` 파일 연결
* 최근 문서/내보내기 폴더 기억
* Finder/Explorer/Nautilus에서 파일 위치 열기
* 창 크기/위치 복원
* 자동 업데이트
* 운영체제별 기본 단축키/메뉴 반영

### MVP 완료 기준

1차 MVP는 기능 목록을 단순히 구현했다고 끝내지 않는다. 아래 기준을 모두 통과해야 제품 개발의 다음 단계로 넘어간다.

* 사용자가 파일 탐색기/Finder/Nautilus에서 `.hwp` 또는 `.hwpx`를 열 수 있다.
* 기존 문서를 수정한 뒤 `Ctrl/Cmd+S`로 원본 경로에 저장할 수 있다.
* 저장 실패 시 문서 원본이 손상되지 않는다.
* 앱을 강제 종료한 뒤 재실행하면 복구 제안을 받을 수 있다.
* 100MB급 문서를 열 때 첫 화면 또는 명확한 진행률 UI가 나온다.
* PDF export 결과가 페이지 수, 기본 텍스트 위치, 한글 폰트 임베딩 기준을 통과한다.
* Windows/macOS/Linux에서 한글 IME 입력, 저장, PDF export smoke test를 통과한다.

## 4. 아키텍처 방향

핵심 결정은 하나다.

**데스크톱에서는 WASM을 문서 상태의 최종 소스 오브 트루스로 두지 않는다.
Rust `document_core`를 authoritative state로 올리고, `rhwp-studio`는 UI/입력 클라이언트로 바꾼다.**

이 결정이 중요한 이유는 세 가지다.

* 대용량 파일에서 JS/WASM 힙 복제를 피할 수 있다.
* 저장과 PDF export가 같은 네이티브 문서 상태를 보므로 일관성이 생긴다.
* autosave, recovery, external file watch, atomic save를 Rust에서 처리할 수 있다.

현재 `rhwp`가 이미 `document_core`를 commands/queries로 나누고, 그 위에 WASM API와 `rhwp-studio`를 얹는 구조이기 때문에, 데스크톱은 이 경계를 그대로 살려 **WASM transport 대신 Tauri transport를 추가**하는 방식이 가장 자연스럽다. ([GitHub][4])

구조는 이렇게 잡는다.

```text
rhwp-studio UI
  ├─ toolbar / dialogs / canvas-svg view / editor interactions
  └─ EditorTransport
       ├─ WasmTransport   (기존 웹용)
       └─ TauriTransport  (데스크톱용)

Tauri Core (Rust)
  ├─ AppState
  │   ├─ DocumentSessionManager
  │   ├─ JobManager
  │   ├─ RecoveryManager
  │   └─ RecentDocsStore
  ├─ Commands
  │   ├─ open_document
  │   ├─ create_document
  │   ├─ dispatch_action
  │   ├─ query_pages
  │   ├─ save_document
  │   ├─ export_pdf
  │   ├─ print_document
  │   └─ reveal_in_folder
  └─ Services
      ├─ parser / serializer
      ├─ pagination / render
      ├─ font resolver
      ├─ autosave / recovery
      ├─ file watcher
      └─ pdf exporter
```

## 5. 코드 구조 제안

1차는 대수술보다 **경계 추출**이 중요하다.

```text
HOP/
  apps/
    desktop/
      src-tauri/
        src/
          commands.rs
          menu.rs
          pdf_export.rs
          state.rs
          windows.rs
    studio-host/
      src/
        core/
          bridge-factory.ts
          tauri-bridge.ts
          wasm-bridge.ts
        command/
          commands/
        ui/
        styles/
  third_party/
    rhwp/       # read-only upstream submodule
  assets/
    fonts/
    logo/
```

프론트엔드는 upstream `rhwp-studio`를 직접 수정하지 않고 `apps/studio-host`에서 Vite alias로 가져온다. HOP에서 필요한 bridge, command, UI polish만 같은 import 경로로 shadowing한다. 데스크톱 빌드에서는 Tauri의 `frontendDist`에 `apps/studio-host/dist`를 연결한다. Tauri는 `frontendDist`에 **경로**를 주면 자산을 앱에 임베드하고, 추가 폰트/템플릿/리소스 파일은 `bundle.resources`로 묶을 수 있다. 또한 Tauri 설정은 `tauri.windows.conf.json`, `tauri.macos.conf.json`, `tauri.linux.conf.json`처럼 플랫폼별 파일로 분리해 병합할 수 있다. ([Tauri][5])

## 6. 문서 상태와 IPC

### 문서 세션

Rust의 `AppState`에 `DocumentSession`을 둔다.

```rust
struct DocumentSession {
    id: Uuid,
    source_path: Option<PathBuf>,
    source_format: DocumentFormat, // Hwp | Hwpx
    dirty: bool,
    revision: u64,
    doc: Arc<RwLock<DocumentCore>>,
    undo_redo: UndoRedoStack,
    layout_cache: LayoutCache,
    page_render_cache: PageRenderCache,
    font_map: FontResolutionMap,
    recovery_token: Option<String>,
}
```

### 프론트-백 통신

문서 조작은 **command + channel** 구조로 한다.

* 짧은 요청/응답: `invoke` command
* 긴 작업/진행률: `Channel`

Tauri 문서상 commands는 프론트에서 Rust 함수를 타입 안정적으로 호출하는 기본 경로이고, channels는 이벤트보다 빠르고 ordered delivery에 적합하며 다운로드 진행률, child process output 같은 streaming 작업에 쓰인다. 그래서 **열기/저장/PDF export/백그라운드 pagination 진행률**은 channel로 보낸다. ([Tauri][6])

### action/query 프로토콜

새 프로토콜을 만들지 말고 **기존 hwpctl-compatible action layer**를 IPC 경계에도 그대로 쓴다.

예시:

* `dispatch_action(docId, actionName, parameterSet)`
* `get_field_list(docId)`
* `put_field_text(docId, fieldName, value)`
* `query_visible_pages(docId, viewport, zoom)`
* `query_find(docId, pattern, options)`

이렇게 하면 웹 빌드와 데스크톱 빌드가 같은 편집 모델을 공유할 수 있다. `rhwp`는 이미 30개 action과 field API를 제공하고 있으므로 이 자산을 살리는 것이 맞다. ([GitHub][4])

## 7. 파일 열기/저장 설계

### 원칙

**파일 경로 선택은 Tauri dialog, 실제 파일 읽기/쓰기는 Rust command**로 한다.

이유는 명확하다. dialog plugin은 데스크톱에서 파일 시스템 경로를 돌려주고 scope도 열어주지만, 공식 문서가 **보안이 더 중요하면 dedicated command를 선호하라**고 안내한다. 따라서 사용자 문서는 프론트엔드가 직접 fs plugin으로 만지지 않고, 모두 Rust 서비스에서 처리한다. ([Tauri][7])

### 열기 흐름

1. `dialog.open`으로 경로 선택
2. `open_document(path)` 호출
3. Rust에서 파일 검사, 포맷 판별, 파싱
4. 첫 페이지/첫 화면 먼저 pagination
5. UI는 바로 첫 화면 표시
6. 나머지 페이지는 백그라운드 pagination
7. channel로 진행률 전달

### 저장 흐름

저장은 반드시 **atomic save**로 한다.

1. 현재 세션 revision freeze
2. 같은 디렉터리에 임시 파일 생성
3. serialize/write
4. flush + fsync
5. 원본 백업 옵션 처리
6. rename으로 교체
7. dirty=false, recent docs 갱신, file watcher baseline 갱신

`Ctrl/Cmd+S`는 **무조건 현재 열린 원본 경로에 저장**되어야 하며, 이 동작은 릴리즈 차단 조건으로 둔다. 현재 공개 이슈에 `Ctrl+S opens default Documents instead of saving back to the opened file`가 이미 있으므로, 데스크톱 1차에서는 이 문제를 제일 먼저 닫아야 한다. ([GitHub][8])

### 다른 이름으로 저장

* 원본 포맷 유지 저장
* HWP ↔ HWPX format conversion 저장
* 권한 오류/경로 오류/용량 부족 메시지 구분

### 문서 호환성과 roundtrip 정책

HOP는 1차에서 모든 HWP/HWPX 기능의 완전한 편집 UI를 제공하지 못할 수 있다. 하지만 저장 시 데이터 손실을 막기 위해 호환성 정책을 명확히 둔다.

* 파서가 이해한 구조는 `DocumentCore` 모델로 편집 가능하게 올린다.
* 파서가 부분적으로만 이해한 원본 레코드/패키지 요소는 보존 영역에 유지한다.
* 사용자가 건드리지 않은 보존 영역은 저장 시 원본에 가깝게 roundtrip한다.
* 편집으로 인해 보존이 불가능한 개체는 저장 전 경고한다.
* HWP ↔ HWPX 변환 저장은 1차에서 “지원 가능한 문서 구조” 기준으로 표시하고, 손실 가능성이 있으면 명확히 안내한다.
* 자동 저장과 recovery snapshot은 원본 파일을 직접 덮어쓰지 않는다.

이 정책은 HWPX serializer 안정화가 완료되기 전에도 제품이 안전하게 실패하도록 만드는 기준이다.

### 자동 저장과 복구

* 앱 데이터 디렉터리에 recovery snapshot 저장
* 시간 기준 + 편집량 기준 혼합
* 재실행 시 “복구본이 더 최신”이면 복구 제안

최근 문서와 간단한 설정은 `store` plugin으로, 창 위치/크기는 `window-state` plugin으로 관리한다. 공식 문서상 store는 지속형 key-value 저장소이고, window-state는 종료 시 상태를 저장하고 다음 실행 시 복원한다. ([Tauri][9])

## 8. 대용량 문서 설계

여기는 1차에서 반드시 넣어야 한다.

### 원칙

* 전체 문서를 프론트엔드로 복사하지 않는다.
* 보이는 페이지부터 먼저 그린다.
* 페이지 렌더 결과는 LRU 캐시한다.
* 이미지 decode와 pagination은 백그라운드 작업으로 분리한다.
* 긴 작업은 모두 cancelable job으로 처리한다.

### 구현

* I/O: memory-map 또는 buffered read
* 파싱: Rust native
* 조판: visible-first
* 렌더: page SVG string 또는 raster cache
* 캐시: `page_render_cache`, `image_cache`, `font_metrics_cache`

### 성능 기준

1차 공식 기준은 이렇게 두는 것이 현실적이다.

* 100MB급 문서: 8GB RAM 장비에서 앱 크래시 없이 오픈
* 첫 화면 표시: 가능하면 2초 이내, 늦어도 progress UI 유지
* 저장/PDF 내보내기: UI block 금지
* 500페이지 이상 문서: 스크롤/줌 중 강제 멈춤 금지

핵심은 “빠른 완전 조판”보다 **빠른 첫 화면 + 백그라운드 완성**이다.

## 9. 폰트 설계

이건 HWP 계열 문서에서 빠지면 안 된다.

현재 HOP 앱은 번들된 오픈 라이선스 웹폰트와 OS 시스템 폰트를 사용한다. 데스크톱판은 이것을 **Font Resolver 서비스**로 승격해야 한다. ([GitHub][4])

### 1차 규칙

* 문서 지정 폰트를 OS 폰트에서 먼저 탐색
* 없으면 번들 폰트/대체 매핑 사용
* 누락 폰트는 상태바/정보 패널에 표시
* PDF export 시 실제 사용된 폰트 subset/embed
* 문서 조판과 PDF 조판이 같은 font resolution map을 사용

### 대체 전략

* Windows: 설치된 한글 폰트 우선
* macOS/Linux: 시스템 폰트 + 번들 fallback
* missing font가 layout에 큰 영향을 주면 “문서가 원본과 다르게 보일 수 있음” 경고

## 10. PDF 내보내기와 인쇄

### PDF

PDF는 **OS print-to-PDF**가 아니라 **pure Rust export pipeline**으로 간다.

파이프라인:

1. 현재 revision freeze
2. 미완료 페이지 pagination 완료
3. 페이지별 SVG 렌더
4. `usvg` parse
5. `svg2pdf` 변환
6. `pdf-writer`로 문서 조립
7. `subsetter` + `ttf-parser`로 폰트 서브셋 임베드
8. atomic write

현재 repo가 이미 SVG export CLI를 제공하고, non-wasm 타깃 PDF 의존성을 포함하고 있으므로 이 경로가 가장 자연스럽다. README 로드맵상 다양한 출력 포맷은 더 뒤 단계에 놓여 있지만, 데스크톱 1차에서는 **PDF를 예외적으로 release gate로 승격**한다. ([GitHub][3])

### PDF 옵션

1차 옵션은 최소한 이 정도는 있어야 한다.

* 전체/선택 페이지
* 파일 경로 지정
* 내보내기 후 열기
* 글꼴 임베드 기본 on
* 실패한 페이지/개체 명시

### 인쇄

인쇄는 “임시 PDF 생성 → 인쇄” 구조로 간다.

* 인쇄 미리보기: 앱 내부 페이지 preview 재사용
* 인쇄: 백그라운드 임시 PDF 생성 후 시스템 인쇄 경로 사용
* 필요 시 exported PDF를 기본 뷰어로 열어 사용자가 시스템 print dialog를 쓰게 함

이 구조가 3개 OS에서 가장 일관되고, PDF 출력물과 인쇄물이 동일해진다.

## 11. 메뉴, 파일 연결, 단일 인스턴스

메뉴는 DOM 메뉴만 쓰지 말고 **Tauri native menu**를 같이 쓴다. 공식 문서상 Tauri 메뉴는 Windows/Linux에서는 윈도우 메뉴로, macOS에서는 메뉴 바로 노출되며, macOS는 상위 항목이 아니라 **submenu 구조**를 요구한다. 따라서 File/Edit/View/Window/Help를 native menu로 만들고, 웹 툴바는 편집 조작 노출용으로만 쓴다. ([Tauri][10])

### 파일 연결

Tauri bundler는 `bundle.fileAssociations`를 지원한다. 1차에서 `.hwp`, `.hwpx`를 등록한다. Linux는 `mimeType` 필드도 별도로 둘 수 있다. ([Tauri][5])

### 단일 인스턴스

이미 앱이 떠 있을 때 파일을 다시 더블클릭하면 기존 앱이 받도록 한다. 공식 single-instance plugin은 콜백에 `args`와 `cwd`를 넘겨주고, **가장 먼저 등록되어야** 한다. Linux에서는 이 플러그인이 DBus를 쓰며, Snap/Flatpak은 별도 권한 선언이 필요하다. 그래서 1차 Linux 공식 패키지는 **AppImage + deb/rpm**로 두고, Snap/Flatpak은 뒤로 미룬다. ([GitHub][11])

## 12. OS별 배포 전략

Tauri는 Windows에서 **WebView2**, macOS에서 **WKWebView**, Linux에서 **webkit2gtk**를 사용한다. 그래서 에디터 입력, IME, 클립보드, 렌더링 차이는 실제로 OS별로 검증해야 한다. ([Tauri][12])

### Windows

* 기본 배포: **NSIS installer**
* 보조 배포: MSI
* WebView2 설치 모드:

  * 기본 공개 다운로드: `downloadBootstrapper`
  * 호환성 우선 배포: `embedBootstrapper` (+약 1.8MB)
  * 오프라인 배포: `offlineInstaller` (+약 127MB)

Windows code signing은 실행 필수는 아니지만, 브라우저 다운로드와 SmartScreen 경험 때문에 사실상 필요하다. EV 인증서는 즉시 SmartScreen reputation을 준다. ([Tauri][13])

### macOS

* 기본 배포: **DMG**
* 필수: code signing + notarization
* App Store가 아니라 직접 배포여도 notarization 필요

Tauri 문서상 macOS 배포는 code signing과 notarization이 요구되며, Apple 인증 정보는 App Store Connect API 또는 Apple ID 방식으로 넣을 수 있다. ([Tauri][14])

### Linux

* 기본 배포: **AppImage**
* 추가 배포: **deb**
* 필요하면 rpm 추가
* 공식 QA 대상: Ubuntu 22.04/24.04, Debian 12, Fedora 최신

Tauri 2는 Linux 개발 환경에서 `libwebkit2gtk-4.1-dev`를 요구하고, 런타임도 Linux WebKit 계열 차이를 받기 때문에 distro QA 매트릭스가 중요하다. ([Tauri][15])

### 자동 업데이트

Tauri updater plugin은 Windows NSIS/MSI, Linux AppImage, macOS app bundle 기준으로 updater artifacts를 만든다. 1차에 넣는 것이 맞다. ([Tauri][16])

## 13. 보안과 권한

Tauri 2는 capabilities/permissions 모델을 갖고 있으므로, 1차는 **최소 권한** 원칙으로 간다. ([Tauri][17])

### 허용 플러그인

* dialog
* store
* window-state
* opener
* updater
* log
* single-instance

### 원칙

* 프론트엔드는 arbitrary file read/write 금지
* 사용자 문서 읽기/쓰기는 Rust commands만 허용
* opener는 export 결과 열기 / 폴더 reveal만 허용
* 로그는 log plugin 기본 타깃으로 파일 + stdout 사용

공식 log plugin은 기본적으로 stdout과 앱 로그 디렉터리 파일에 기록한다. 운영 이슈 수집에 유리하므로 1차부터 켠다. ([Tauri][18])

## 14. 테스트 전략

현재 `rhwp`는 이미 많은 unit/integration 테스트와 Puppeteer 기반 E2E 흔적을 갖고 있다. 데스크톱판은 여기에 Tauri 전용 테스트를 추가한다. ([GitHub][3])

### 자동화

* 코어 단위 테스트: parser / serializer / layout / pdf
* command 통합 테스트: open/save/export/recovery
* 저장 roundtrip 코퍼스 테스트: HWP, HWPX, mixed fonts, large tables, equations, images
* PDF golden 테스트: 페이지 수, bbox, 글꼴 임베딩, 텍스트 위치

### UI 종단 간 테스트

Tauri WebDriver는 공식적으로 **Windows와 Linux**에서만 데스크톱 지원이 가능하고, macOS는 WKWebView driver tool 부재로 같은 방식의 자동화가 어렵다. 그래서:

* Windows/Linux: `tauri-driver` 기반 자동 E2E
* macOS: integration test + snapshot + manual smoke gate

로 나누는 것이 현실적이다. ([Tauri][19])

### OS별 수동 체크리스트

* 한글 IME 조합/확정
* 클립보드
* drag & drop
* 파일 더블클릭 열기
* `Ctrl/Cmd+S`
* PDF export
* print
* missing font fallback
* autosave recovery
* external file modification prompt

### 호환성 테스트 코퍼스

제품 개발 시작 시점부터 작은 샘플만으로 검증하면 저장 안정성 판단이 늦어진다. 1차에는 아래 코퍼스를 별도로 관리한다.

* 빈 문서, 짧은 한글 문서, 긴 본문 문서
* 표/이미지/머리말/꼬리말/각주/쪽번호 포함 문서
* 문서 지정 폰트가 없는 문서
* HWP 원본과 HWPX 원본의 동일 시나리오 문서
* 손상 파일, 비밀번호 문서, 읽기 전용 파일
* 100MB급 대용량 문서와 500페이지 이상 문서

각 코퍼스는 `open`, `save`, `save as`, `reopen`, `export_pdf` 결과를 기록한다. 시각 비교가 어려운 항목도 페이지 수, 텍스트 추출, 이미지 개수, 폰트 임베딩, 에러 메시지 유형은 자동으로 검증한다.

## 15. 구현 순서

### M0. 제품 골격 확정

* 앱 이름/번들 식별자/아이콘/설명 확정
* `HOP is Open HWP` 제품 문구 반영
* 1차 지원 포맷과 비범위 문서화
* 샘플 문서 코퍼스와 release smoke checklist 준비
* `rhwp` upstream 추적 방식과 fork/patch 정책 결정

### M1. 데스크톱 셸과 경계 추출

* `apps/desktop` Tauri 앱 추가
* upstream을 직접 고치지 않는 `apps/studio-host` overlay 구성
* `frontendDist`로 studio host 번들 연결
* native menu / single-instance / window-state 연결

### M2. 네이티브 문서 세션

* `open_document`
* `dispatch_action`
* visible-first pagination
* page SVG query
* 최근 문서 / 다중 창

### M3. 저장 완성

* HWP save
* HWPX save
* atomic save
* dirty state
* autosave / recovery
* external file watch

### M4. 출력 완성

* PDF export
* page range
* open-after-export
* print preview / print path

### M5. 패키징과 운영

* file associations
* updater
* signing/notarization
* OS QA matrix
* large file benchmarks

## 16. 리스크와 의사결정

가장 큰 리스크는 두 개다.

첫째, **HWPX 저장 안정화**다. 현재 공개 이슈에 HWPX serializer 관련 작업이 여러 건 열려 있고, 저장 관련 이슈도 보인다. 따라서 1차 데스크톱의 진짜 선행 조건은 “Tauri 셸”이 아니라 “HWPX roundtrip 품질”이다. ([GitHub][8])

둘째, **WASM 중심 UI에서 native-authoritative UI로의 전환 비용**이다. 다만 `rhwp`가 이미 `document_core` CQRS와 action layer를 갖고 있어서, 이 전환은 새 엔진을 만드는 일이 아니라 **transport를 바꾸는 일**에 가깝다. 그래서 아키텍처 리스크는 크지만 방향은 맞다. ([GitHub][4])

## 17. 초기 제품 메타데이터

앱 생성 시점에는 아래 값을 기준으로 시작한다. 실제 배포 전 법적/상표 검토와 도메인/저장소 정책에 따라 수정할 수 있다.

* 앱 이름: `HOP`
* 긴 이름: `HOP - Open HWP Editor`
* 설명: `Open desktop editor for HWP and HWPX documents`
* 한국어 설명: `HWP/HWPX 문서를 위한 오픈 데스크톱 편집기`
* 기본 지원 확장자: `.hwp`, `.hwpx`
* 내부 crate/package prefix: `hop`
* Tauri identifier 초안: `net.golbin.hop`

## 최종 제안

HOP 1차는 이렇게 확정하는 것이 좋다.

* **문서 상태의 소스 오브 트루스는 Rust native**
* **`rhwp-studio`는 UI 재사용**
* **파일 I/O, 저장, PDF, recovery, large-file 처리는 모두 Rust 서비스**
* **Windows/macOS/Linux 공통 UX는 native menu + file association + single-instance + updater**
* **HWPX 저장 안정화와 Ctrl/Cmd+S 동작은 release blocker**

한 줄로 줄이면,
**HOP 1차는 “웹 에디터를 감싼 앱”이 아니라 “Rust 문서 코어를 Tauri로 제품화한 Open HWP 편집기”로 설계해야 한다.**

[1]: https://blog.rust-lang.org/releases/latest/ "Rust 최신 릴리즈"
[2]: https://github.com/edwardkim/rhwp/blob/main/Cargo.toml "rhwp Cargo.toml"
[3]: https://github.com/edwardkim/rhwp "edwardkim/rhwp"
[4]: https://github.com/edwardkim/rhwp "edwardkim/rhwp"
[5]: https://v2.tauri.app/reference/config/ "Tauri 설정"
[6]: https://v2.tauri.app/develop/calling-rust/ "프론트엔드에서 Rust 호출"
[7]: https://v2.tauri.app/plugin/dialog/ "https://v2.tauri.app/plugin/dialog/"
[8]: https://github.com/edwardkim/rhwp/issues "https://github.com/edwardkim/rhwp/issues"
[9]: https://v2.tauri.app/plugin/store/ "Tauri store 플러그인"
[10]: https://v2.tauri.app/learn/window-menu/ "https://v2.tauri.app/learn/window-menu/"
[11]: https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/single-instance.mdx "https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/single-instance.mdx"
[12]: https://v2.tauri.app/reference/webview-versions/ "Tauri WebView 버전"
[13]: https://v2.tauri.app/distribute/windows-installer/ "https://v2.tauri.app/distribute/windows-installer/"
[14]: https://v2.tauri.app/distribute/sign/macos/ "https://v2.tauri.app/distribute/sign/macos/"
[15]: https://v2.tauri.app/start/prerequisites/ "https://v2.tauri.app/start/prerequisites/"
[16]: https://v2.tauri.app/plugin/updater/ "https://v2.tauri.app/plugin/updater/"
[17]: https://v2.tauri.app/security/capabilities/ "Tauri capabilities 권한"
[18]: https://v2.tauri.app/plugin/logging/ "https://v2.tauri.app/plugin/logging/"
[19]: https://v2.tauri.app/develop/tests/webdriver/ "https://v2.tauri.app/develop/tests/webdriver/"
