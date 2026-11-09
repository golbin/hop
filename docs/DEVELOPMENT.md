# HOP 개발하기

HOP는 Tauri 2, Rust, TypeScript로 만든 macOS·Windows·Linux 문서 편집기다.
문서 엔진과 Studio는 읽기 전용 `third_party/rhwp`를 사용한다.

## 시작하기

Corepack/pnpm, Rust, 해당 OS의 Tauri 빌드 의존성이 필요하다. Node는 CI와 같은
24를 기준으로 하며, 로컬에서도 Vite와 호환되는 외부 런타임을 사용한다.
Rust 버전은 `config/rhwp-upstream.json`의 `rustToolchain`을 사용한다.

```sh
git submodule update --init --recursive
corepack enable
pnpm install --frozen-lockfile
pnpm --filter hop-desktop dev
```

개인 pnpm 설정에서 lockfile 사용이 꺼져 있으면 설치 명령에 `--lockfile=true`를 추가한다.
frozen 설치를 유지하고 전역 설정은 바꾸지 않는다.

독립 Studio 실행은 `pnpm --filter @golbin/hop-studio-host dev`다.
브라우저 실행만으로 native 파일·창·인쇄 동작을 검증할 수는 없다.

## 코드 위치

| 위치 | 책임 |
| --- | --- |
| `apps/desktop/src-tauri` | native 문서 세션, 파일·저장·PDF·인쇄·창·업데이트 |
| `apps/desktop/rhwp-adapter` | 제품 Rust 코드가 사용하는 upstream API 경계 |
| `apps/desktop/quicklook` | macOS Finder preview/thumbnail 확장 |
| `apps/desktop/linux` | AppImage 런타임 선택과 재시작 환경 경계 |
| `apps/studio-host` | desktop bridge, 명령 조립, HOP 전용 UI와 스타일 |
| `third_party/rhwp` | 고정 안정 태그의 upstream source; 제품 수정 금지 |
| `config` | upstream 기준선과 Studio override 목록 |
| `scripts`, `tests` | 갱신·패키징 도구와 저장소 계약 테스트 |

일반 편집·렌더링·대화상자는 upstream에 위임한다. HOP는 native side effect와
제품 정책을 추가한다. 자세한 경계는 [UPSTREAM.md](architecture/UPSTREAM.md)를 따른다.

## 검증 명령

```sh
pnpm upstream:verify
pnpm test
pnpm run clippy:desktop
pnpm run build:studio
pnpm --filter hop-desktop tauri build --debug --bundles app
```

`pnpm test`는 저장소 계약, Studio, desktop, macOS Quick Look 테스트를 실행한다.
각각 `test:upstream`, `test:studio`, `test:desktop`, `test:quicklook:macos`로 좁혀 실행할 수 있다.
Rust formatting과 Quick Look clippy는 해당 Cargo manifest를 지정해 실행한다.
빌드와 Rust 테스트는 같은 target directory를 사용하므로 동시에 실행하지 않는다.

macOS 번들은 `apps/desktop/src-tauri/target/debug/bundle/macos/HOP.app`에 생성된다.
Quick Look 빌드 hook은 `pnpm run build:quicklook:macos`이며 다른 OS에서는 건너뛴다.
확장은 `HOP.app/Contents/PlugIns`에 포함되고, 공통 엔진은 `Contents/Frameworks`의
`libhop_quicklook_ffi.dylib` 하나를 공유한다. 빌드 hook이 확장과 같은 identity로 서명하고
Tauri의 macOS `files` 설정이
라이브러리를 번들에 복사한다. 일반 Rust 테스트가 Quick Look 산출물에 의존하지 않도록
빌드 전 라이브러리 복사를 요구하는 `frameworks` 설정은 사용하지 않는다.
Swift 링크 후 미사용 코드와 로컬 심볼을 제거하며, native target
빌드는 같은 서명·링크 조건의 smoke 실행 파일로 principal class와 PDF·PNG 생성을 확인한다.
개발용 ad-hoc 서명은 Team ID가 없어 hardened runtime을 적용하지 않는다. 배포 identity로
서명할 때는 앱·확장·공유 라이브러리에 기존 hardened runtime을 유지한다.
Quick Look은 Skia로 페이지를 PNG로
렌더링하고 공유 Rust adapter의 PDF 변환을 사용한다. 별도 PDF 조립기는 없다.
Finder 등록·미리보기는 공개 sample의 복사본으로 `qlmanage -r`, `qlmanage -p`,
`qlmanage -t -s 512`를 사용해 확인한다. 배포 빌드는 앱·두 확장·공유 라이브러리의 서명과 앱 공증도 검증한다.

release Rust 빌드는 Thin LTO를 사용한다. desktop 심볼은 Cargo에서, Quick Look의
최종 라이브러리·Swift 실행 파일 심볼은 빌드 hook에서 제거한다. Windows MSI는 cabinet을 high
압축으로 생성한다. WASM은 PDF 가져오기 코덱을 제외한 명시적
feature로 생성하며, 빌드 정책과 산출물 hash를 provenance에서 검증한다. 글꼴과 문서
편집·내보내기 기능을 용량 절감 목적으로 제거하지 않는다.

Codex 내장 Node에서 Vite/Vitest의 native binding 로딩이 실패하면 외부 Node를 먼저
`PATH`에 넣고 `which node`로 확인한다. macOS 27에서 Rust dylib strip 오류가 발생하는
환경에서는 로컬 검증에 `CARGO_PROFILE_DEV_STRIP=none`,
`CARGO_PROFILE_TEST_STRIP=none`, `CARGO_PROFILE_RELEASE_STRIP=none`을 사용할 수 있다.
이 환경 조정 때문에 제품의 minimum deployment target을 바꾸지는 않는다.

## 제품 동작과 제한

- HWP/HWPX 열기, 편집, HWP 저장·Save As, 검색 가능한 PDF 내보내기를 지원한다.
  HWPX 저장은 제품 UI에서 지원하지 않는다.
- 암호 HWP는 암호 입력 후 열 수 있다. 원본의 암호를 조용히 제거하지 않도록 직접 저장은
  차단하며, Save As에서 안내에 동의한 경우 암호 없는 HWP를 별도로 저장한다.
- native 문서 작업은 겹쳐 실행하지 않는다. 취소·오류 시 기존 문서와 미저장 상태를 보존하고,
  외부 파일 변경은 저장 전에 충돌 확인을 거친다. autosave/recovery는 제공하지 않는다.
- Studio는 Canvas2D와 WASM mirror를 사용한다. native 파일/session과의 동기화는 bridge가 맡는다.
- 시스템·밝게·어둡게 테마는 upstream 설정과 `initThemeSync`를 명시적으로 연결한다.
- 글꼴과 색상 선택은 문서 선택 영역을 보존해야 한다. 글자색 최근 목록은 최대 7개이며,
  형광펜에는 연속 칠하기 모드를 추가하지 않는다.
- 창 제목은 파일명·미저장 표시를 포함한다. 확대 대화상자와 맞춤 명령은 upstream의 쪽 배치를 사용한다.
- 창 간 rich clipboard의 문단 서식 손실은 [#96](https://github.com/golbin/hop/issues/96)에서
  추적한다. 재현되지 않은 IME·출력·한컴 호환성 보고는 해결됐다고 간주하지 않는다.

플랫폼 GUI 검증은 실제 OS에서 수행하고 자동 테스트와 구분한다. 실물 인쇄, IME,
복잡한 문서 호환성은 해당 환경·원본 대조가 필요하다. 비공개 문서를 로그·업로드하지 않는다.

## 유지보수

- [단축키](KEYBOARD_SHORTCUTS.md)
- [로컬 글꼴 정책](architecture/LOCAL_FONTS.md)
- [rhwp 갱신 절차](operations/RHWP_UPDATE.md)
- [브랜치 통합과 배포 절차](operations/DESKTOP_RELEASE.md)

완료한 계획·QA·트리아지 기록은 저장소에 누적하지 않는다. 변경 이유와 과거 검증은
Git history, 이슈, 릴리스 기록에서 찾는다.
