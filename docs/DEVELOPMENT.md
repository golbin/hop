# HOP 개발하기

이 문서는 HOP를 로컬에서 실행하거나 수정할 때 필요한 기본 정보를 정리합니다.

## 빠른 시작

처음 한 번 의존성과 submodule을 준비합니다.

```sh
git submodule update --init --recursive
npm ci
```

studio host를 빌드합니다.

```sh
npm run build:studio
```

데스크톱 앱을 개발 모드로 실행합니다.

```sh
npm --workspace apps/desktop run dev
```

debug 번들을 만들 때는 다음 명령을 사용합니다.

```sh
npm --workspace apps/desktop run tauri -- build --debug --bundles app
```

## 프로젝트 구조

```text
apps/
  desktop/       Tauri 2 데스크톱 앱
  studio-host/   upstream rhwp-studio 위에 얹는 HOP overlay
third_party/
  rhwp/          read-only upstream submodule
assets/          아이콘, 폰트, 스크린샷
docs/            스펙, 아키텍처, 운영 문서
scripts/         유지보수 스크립트
```

HOP 전용 동작은 `apps/desktop`과 `apps/studio-host`에 둡니다. `third_party/rhwp`는 upstream submodule로 유지하고, HOP 제품 기능 때문에 직접 수정하지 않는 것을 원칙으로 합니다.

## rhwp와의 관계

HOP는 `rhwp`의 문서 엔진과 웹 에디터를 기반으로 합니다. HOP가 맡는 부분은 데스크톱 앱에서 필요한 얇은 제품 레이어입니다.

* Tauri 2 앱 셸
* native menu와 파일 명령 연결
* Rust document session 관리
* atomic save
* native SVG-to-PDF export 경로
* webview print 경로
* single-instance와 파일 open event 라우팅
* 새 창 생성과 창별 drag/drop 처리
* GitHub Actions 기반 desktop build/release 초안

upstream이 업데이트되면 submodule pointer를 올리고, HOP overlay에서 필요한 호환성만 조정하는 구조를 목표로 합니다.

## 아직 준비 중인 부분

public beta 전까지는 아래 항목이 더 필요합니다.

* HWPX 저장은 아직 막아 두었습니다. HWPX 열기는 가능하지만, 안전한 HWPX serializer가 준비되기 전까지 저장은 지원하지 않습니다.
* autosave/recovery는 아직 없습니다.
* 외부 파일 변경 감지는 아직 없습니다.
* 큰 문서에서는 현재 WASM mirror를 거치는 구간이 있어 native-authoritative 구조로 더 개선해야 합니다.
* signing, notarization, updater manifest는 배포 자격증명이 준비된 뒤 활성화할 예정입니다.

현재 상태에서도 HWP 문서를 열고, 가볍게 편집하고, 저장하고, PDF로 내보내는 기본 데스크톱 흐름은 확인할 수 있습니다.

## 개발 명령

desktop Rust 테스트:

```sh
npm run test:desktop
```

desktop Rust clippy:

```sh
npm run clippy:desktop
```

upstream 갱신:

```sh
RUN_CHECKS=1 scripts/update-upstream.sh
```

## 관련 문서

* [초기 제품 스펙](specs/initial/SPEC.md)
* [초기 구현 상태](specs/initial/IMPLEMENTATION_STATUS.md)
* [upstream 경계와 업데이트 방식](architecture/UPSTREAM.md)
* [데스크톱 릴리즈 노트](operations/DESKTOP_RELEASE.md)
