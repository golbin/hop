# HOP 문서

이 디렉터리는 HOP의 제품 스펙, 아키텍처 결정, 운영 문서를 둔다.

## 구성

```text
docs/
  DEVELOPMENT.md             로컬 개발 환경과 주요 명령
  KEYBOARD_SHORTCUTS.md      키보드 단축키 레퍼런스
  specs/
    initial/
      SPEC.md                초기 제품 및 public beta 스펙
      IMPLEMENTATION_STATUS.md 초기 스펙 기준 구현 상태
    windows-file-association-launch.md Windows 파일 연결 런치 스펙
  architecture/
    UPSTREAM.md              upstream rhwp 경계와 업데이트 방식
  operations/
    DESKTOP_RELEASE.md       데스크톱 릴리즈와 서명/공증 메모
```

## 작성 규칙

* 새 제품 스펙은 `docs/specs/<topic>/` 아래에 둔다.
* 스펙 구현이 시작되면 같은 폴더에 구현 상태 문서를 함께 둔다.
* 로컬 개발 환경과 명령은 `docs/DEVELOPMENT.md`에 둔다.
* 여러 스펙에 걸쳐 적용되는 아키텍처 결정은 `docs/architecture/`에 둔다.
* 빌드, 배포, 서명, 유지보수 절차는 `docs/operations/`에 둔다.
* HOP 제품 동작을 `third_party/rhwp`의 변경으로 문서화하지 않는다. HOP가 소유하는 동작은 `apps/desktop` 또는 `apps/studio-host`에 있어야 한다.
