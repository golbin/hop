# Windows 포터블 사용법

`HOP-windows-x64-portable.zip`은 설치 프로그램 없이 사용하는 Windows x64 배포입니다.

1. ZIP을 사용자 계정이 쓸 수 있는 폴더에 **전체 압축 해제**합니다.
2. 설치형 HOP가 실행 중이면 먼저 종료한 뒤, 압축을 푼 `HOP` 폴더에서 `HOP.exe`를 실행합니다.
3. 앱의 열기 메뉴 또는 문서 드래그 앤 드롭으로 HWP/HWPX 파일을 엽니다.

`HOP.exe`만 따로 옮기지 마세요. `fonts`는 PDF 내보내기에 필요하며,
`hop-portable.json`은 설치형 자동 업데이트를 비활성화합니다.
관리자 권한, 시작 메뉴 등록, 자동 파일 연결 등록은 필요하지 않습니다.
설정, 최근 문서, 로그, WebView 캐시는 기존 HOP와 같은 사용자 AppData
경로에 저장됩니다. USB 안에 모든 데이터를 보관하는 방식은 아닙니다.
회사에서 허용하는 실행 정책은 설치형과 포터블 모두에 적용됩니다.

## WebView2

기본 ZIP은 PC에 이미 있는 Microsoft Edge WebView2 Runtime을 사용합니다.
런타임이 없는 PC에서 설치도 허용되지 않는다면, 배포 담당자가 Microsoft의
**x64 Fixed Version** 런타임을 ZIP에 포함해야 합니다. 포함된 런타임은
`HOP/WebView2/msedgewebview2.exe` 위치에 있어야 합니다. HOP가 시작할 때
이 폴더를 자동으로 선택하며 설치 프로그램을 실행하지 않습니다.

Fixed Version은 자동 갱신되지 않으므로 배포 담당자가 보안 업데이트를
포함해 새 ZIP을 제공해야 합니다. Windows 10에서 버전 120 이상인 고정
런타임은 Microsoft가 안내하는 AppContainer 읽기/실행 권한 준비도 필요합니다.
회사 배포 절차에서 준비하고 대상 PC에서 확인하세요.
[Microsoft WebView2 배포 안내](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution#details-about-the-fixed-version-runtime-distribution-mode)를 참조하세요.

## 업데이트 및 제거

문서를 저장하고 모든 HOP 창을 닫은 후 새 ZIP을 새 폴더에 풀어 실행합니다.
포터블은 MSI/NSIS 자동 업데이트를 확인하거나 실행하지 않습니다.
프로그램을 제거하려면 압축 해제한 폴더를 삭제합니다. AppData의 설정과 캐시는 유지됩니다.

## 개발자 빌드

Node 24, pnpm, 프로젝트에서 지정한 Rust, MSVC/Windows SDK 및 rhwp
서브모듈을 준비한 Windows 개발 환경에서 실행합니다.
MSVC와 Windows SDK의 라이브러리 경로를 사용할 수 있도록 Visual Studio의
**Developer PowerShell**에서 실행하세요.

```powershell
pnpm install --frozen-lockfile
pnpm run build:portable:windows
```

결과: `apps/desktop/src-tauri/target/portable/HOP-windows-x64-portable.zip`

고정 런타임까지 포함하려면 Microsoft에서 받은 x64 Fixed Version CAB을
먼저 압축 해제한 후 `msedgewebview2.exe`가 들어 있는 폴더를 지정합니다.
런타임 다운로드 및 재배포에는 Microsoft 라이선스가 적용됩니다.

```powershell
$env:HOP_WEBVIEW2_RUNTIME_PATH = 'D:\runtimes\Microsoft.WebView2.FixedVersion.x64'
pnpm run build:portable:windows
```

이미 빌드한 실행 파일을 패키징할 때는 다음과 같이 지정합니다.

```powershell
pnpm run build:portable:windows -SkipBuild -ExecutablePath 'apps/desktop/src-tauri/target/release/hop-desktop.exe'
pnpm run test:portable:windows
```

GitHub Actions의 **HOP Windows Portable → Run workflow**를 실행하면 설치 파일을
만들지 않고 Windows x64 ZIP만 빌드합니다. 완료된 실행의 Artifacts에서
`hop-desktop-windows-x64-portable`을 다운로드한 뒤, 그 안의
`HOP-windows-x64-portable.zip`을 전체 압축 해제해 사용합니다.
이 워크플로는 저장소에 변경사항을 반영한 후 실행할 수 있습니다.

기존 `HOP Desktop Release`에서 `windows_x64=true`를 선택해도
설치 파일과 함께 `hop-desktop-windows-x64-portable` artifact가 만들어집니다.
기본 CI ZIP은 설치된 WebView2를 사용합니다. 고정 런타임 포함 ZIP은 위의
로컬 빌드 명령으로 만듭니다. 릴리스에서도 ZIP을 같은 이름의 asset으로
수집하고 `SHA256SUMS.txt`에 포함합니다.
