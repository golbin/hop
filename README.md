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
* [Linux x64 (.deb, Ubuntu/Debian 계열 권장)](https://github.com/golbin/hop/releases/latest/download/HOP-linux-x64.deb)
* [Linux x64 (.rpm, Fedora/openSUSE 계열)](https://github.com/golbin/hop/releases/latest/download/HOP-linux-x64.rpm)
* [Linux x64 (AppImage, portable)](https://github.com/golbin/hop/releases/latest/download/HOP-linux-x64.AppImage)

macOS 빌드는 signed/notarized `.dmg`입니다. Homebrew를 통해서 설치할 수도 있습니다.
```sh
brew install hop
```

전체 릴리즈는 [GitHub Releases](https://github.com/golbin/hop/releases)에서 확인할 수 있습니다.

## 설치 유의사항

### Windows

Windows 빌드는 아직 서명되지 않아 Edge나 Windows SmartScreen에서 "일반적으로 다운로드되지 않습니다" 또는 실행 경고가 뜰 수 있습니다. 다운로드 항목의 `...` 메뉴에서 `유지`를 선택한 뒤 다운로드할 수 있습니다.

### Linux

Linux에서는 한글 IME와 WebKitGTK 런타임 안정성을 위해 `.deb` 또는 `.rpm` 패키지를 우선 사용해 주세요. AppImage는 portable 실행이 필요할 때만 권장하며, 일부 Wayland/IME 환경에서는 한영 전환이나 창 표시가 불안정할 수 있습니다.

Arch, CachyOS, EndeavourOS 계열은 아직 공식 네이티브 패키지를 제공하지 않습니다. AppImage 실행 문제가 있다면 `.deb`를 `debtap`으로 변환하여 사용하시되, `depend = gtk` 항목을 제거하고 변환하시면 됩니다.

## 개발하기

개발 환경 준비, 실행 명령, 프로젝트 구조, `rhwp`와의 관계는 [개발 문서](docs/DEVELOPMENT.md)에 정리해 두었습니다.

## Credits

HOP는 [rhwp](https://github.com/edwardkim/rhwp)를 기반으로 합니다. HWP 엔진을 공개해 주신 개발자분께 감사드립니다.

License: MIT
