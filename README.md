# HOP

**HOP is Open HWP**

HOP는 HWP/HWPX 문서를 보고 편집할 수 있는 오픈소스 macOS, Windows, Linux용 데스크탑 앱입니다.

문서 파싱과 렌더링의 기반은 [rhwp](https://github.com/edwardkim/rhwp)를 사용합니다. HOP는 그 위에 얇게 껍데기를 씌운 앱입니다. rhwp가 제공하는 기능을 바탕으로 파일 열기, 저장, PDF 내보내기, 인쇄, 파일 연결 같은 OS 통합 기능을 제공합니다.

![HOP editor](assets/screenshots/hop-editor.webp)

## 할 수 있는 일

현재 HOP는 다음 흐름을 지원합니다.

* HWP/HWPX 문서 열기
* HWP 문서 저장, 다른 이름으로 저장
* PDF로 내보내기
* 인쇄 다이얼로그 열기
* 파일 드래그 앤 드롭으로 열기
* `.hwp`, `.hwpx` 파일 연결
* 여러 창에서 문서 열기

## 다운로드

최신 릴리즈는 아래 링크에서 받을 수 있습니다.

* [macOS Apple Silicon (.dmg)](https://github.com/golbin/hop/releases/latest/download/HOP-macos-arm64.dmg)
* [macOS Intel (.dmg)](https://github.com/golbin/hop/releases/latest/download/HOP-macos-x64.dmg)
* [Windows x64 (.msi)](https://github.com/golbin/hop/releases/latest/download/HOP-windows-x64.msi)
* [Linux x64 (AppImage)](https://github.com/golbin/hop/releases/latest/download/HOP-linux-x64.AppImage)

macOS 빌드는 signed/notarized `.dmg`입니다. Homebrew를 통해서 설치할 수도 있습니다.
```sh
brew install hop
```
Windows 빌드는 아직 서명되지 않아 Edge나 Windows SmartScreen에서 "일반적으로 다운로드되지 않습니다" 또는 실행 경고가 뜰 수 있습니다. 다운로드 항목의 `...` 메뉴에서 `유지`를 선택한 뒤 다운로드할 수 있습니다. Linux에서 AppImage 실행 시 fcitx5 기반 한글 IME가 불안정하면 [GitHub Releases](https://github.com/golbin/hop/releases)에서 `.deb` 또는 `.rpm` 패키지를 우선 사용해 주세요. 전체 릴리즈는 GitHub Releases에서 확인할 수 있습니다.

## 개발하기

개발 환경 준비, 실행 명령, 프로젝트 구조, `rhwp`와의 관계는 [개발 문서](docs/DEVELOPMENT.md)에 정리해 두었습니다.

## Credits

HOP는 [rhwp](https://github.com/edwardkim/rhwp)를 기반으로 합니다. HWP 엔진을 공개해 주신 개발자분께 감사드립니다.

License: MIT
