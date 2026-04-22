# HOP 데스크톱 배포 빌드

Tauri 데스크톱 앱은 `apps/desktop/`에서 빌드한다. 배포용 GitHub Actions 워크플로는 `.github/workflows/hop-desktop.yml`이다.

관련 문서:

* 초기 제품 스펙: [`docs/specs/initial/SPEC.md`](../specs/initial/SPEC.md)
* 현재 구현 상태: [`docs/specs/initial/IMPLEMENTATION_STATUS.md`](../specs/initial/IMPLEMENTATION_STATUS.md)
* upstream 경계: [`docs/architecture/UPSTREAM.md`](../architecture/UPSTREAM.md)

## 워크플로 동작

`HOP Desktop Release`는 두 가지 방식으로 실행된다.

| 트리거 | 빌드 플랫폼 | 릴리즈 |
| --- | --- | --- |
| 데스크톱/에디터 코드, root pnpm 의존성, 번들 폰트/로고, 관련 문서, upstream submodule pointer를 건드린 Pull Request | Linux x64만 | 릴리즈 없음. 스모크 빌드 artifact만 생성 |
| 수동 `workflow_dispatch` | macOS arm64, macOS x64 기본 선택. Windows x64, Linux x64는 필요할 때 선택 | 선택적으로 draft/prerelease 릴리즈 생성 |

태그 push는 자동 빌드를 실행하지 않는다. 릴리즈 빌드는 GitHub Actions에서 수동으로 실행하고, `build_ref`에 빌드할 branch, tag, commit SHA를 입력한다. `create_release`를 켠 상태에서 `build_ref`를 비워 두면 `release_tag`를 빌드 ref로 사용한다. HOP 데스크톱 릴리즈 태그는 `v*` 네임스페이스를 사용한다.

빌드 대상은 다음과 같다.

| 플랫폼 | Runner | Target |
| --- | --- | --- |
| macOS arm64 | `macos-15` | `aarch64-apple-darwin` |
| macOS x64 | `macos-15-intel` | `x86_64-apple-darwin` |
| Windows x64 | `windows-2025` | `x86_64-pc-windows-msvc` |
| Linux x64 | `ubuntu-24.04` | `x86_64-unknown-linux-gnu` |

각 빌드 잡은 Rust, Node, Linux Tauri 의존성을 준비하고, 루트 workspace lockfile 기준으로 Node 의존성을 설치한 뒤 `tauri-apps/tauri-action`으로 번들을 만든다. upstream `rhwp`는 `third_party/rhwp` submodule로 checkout된다.

릴리즈 생성은 별도 잡에서만 수행한다. 일반 빌드 잡은 `contents: read` 권한만 갖고, GitHub Release를 만들거나 갱신하는 잡만 `contents: write` 권한을 갖는다. Apple, Tauri updater, Windows signing secret은 전체 workflow env에 올리지 않고 필요한 빌드 step에만 전달한다.

홈페이지와 README는 GitHub의 latest-release direct download URL을 사용한다. 따라서 릴리즈 잡은 Tauri가 만든 원본 bundle 파일을 그대로 올리지 않고, 아래 고정 이름으로 복사한 asset을 GitHub Release에 업로드한다.

| 플랫폼 | 릴리즈 asset | 직접 다운로드 URL |
| --- | --- | --- |
| macOS Apple Silicon | `HOP-macos-arm64.dmg` | `/releases/latest/download/HOP-macos-arm64.dmg` |
| macOS Intel | `HOP-macos-x64.dmg` | `/releases/latest/download/HOP-macos-x64.dmg` |
| Windows x64 | `HOP-windows-x64.msi` | `/releases/latest/download/HOP-windows-x64.msi` |
| Linux x64 | `HOP-linux-x64.AppImage` | `/releases/latest/download/HOP-linux-x64.AppImage` |

현재 공개 다운로드는 macOS signed/notarized 빌드를 먼저 노출한다. Windows와 Linux는 workflow에서 선택해 빌드할 수 있고, 생성된 경우 고정 이름 asset으로 함께 업로드된다. `HOP-windows-x64.exe`, `HOP-linux-x64.deb`, `HOP-linux-x64.rpm`은 만들어진 경우 함께 올린다. `SHA256SUMS.txt`는 고정 이름으로 복사된 릴리즈 asset과 updater asset 기준으로 생성한다.

Linux 공개 안내에는 AppImage를 기본 링크로 유지하되, AppImage에서 fcitx5 기반 한글 IME가 불안정할 때는 GitHub Releases의 `.deb` 또는 `.rpm` 패키지를 우선 사용하라는 문구를 함께 노출한다.

자동 업데이트는 GitHub Release의 `latest.json`을 사용한다.

```text
https://github.com/golbin/hop/releases/latest/download/latest.json
```

릴리즈 잡은 Tauri updater용 압축 bundle과 `.sig` 파일을 `HOP-updater-*` 또는 설치 파일 이름으로 함께 올리고, `latest.json` 안의 다운로드 URL은 해당 릴리즈 태그의 asset을 가리키게 만든다. manifest에는 `darwin-aarch64-app`, `windows-x86_64-msi`, `linux-x86_64-appimage`처럼 Tauri가 먼저 찾는 installer-specific key와 fallback key를 함께 넣는다. 앱은 시작 시 이 manifest를 확인한다. 업데이트가 있으면 다운로드와 설치를 수행하고, Rust 쪽에서 아직 dirty 문서 세션이 없을 때만 재시작한다.

수동 실행에서 `create_release`를 켜면 macOS arm64와 macOS x64를 모두 빌드해야 한다. README와 홈페이지가 두 macOS `.dmg`에 직접 링크하기 때문이다. macOS 공개 릴리즈가 unsigned로 나가는 일을 막기 위해, macOS release build는 Apple signing certificate와 notarization credential이 없으면 실패한다. 일부 플랫폼만 확인하고 싶을 때는 `create_release`를 끄고 artifact 빌드만 실행한다.

## 수동 빌드

GitHub Actions에서 `HOP Desktop Release`를 선택한 뒤 `Run workflow`를 실행한다.

플랫폼 체크박스로 필요한 OS만 빌드할 수 있다. artifact만 필요하면 `create_release`는 끈 상태로 둔다.

수동 릴리즈를 만들 때는 다음처럼 실행한다.

1. 먼저 로컬에서 `v0.1.0` 같은 태그를 만들고 push한다.
2. GitHub Actions에서 `HOP Desktop Release`를 선택한다.
3. `create_release`를 켠다.
4. `release_tag`에 `v0.1.0` 같은 태그를 입력한다.
5. 필요하면 `build_ref`에도 같은 태그를 입력한다. 비워 두면 `release_tag`를 사용한다.
6. macOS arm64, macOS x64 체크박스를 켠다.
7. artifact를 확인하기 전까지는 `release_draft`를 켜 둔다.
8. 베타/프리뷰 배포일 때만 `prerelease`를 켠다.

`create_release`를 켤 때 `release_tag`는 필수다. `build_ref`를 함께 입력했다면 `release_tag`와 같아야 하며, `release_tag`는 `vMAJOR.MINOR.PATCH` 형식이어야 한다. 이 제한은 릴리즈가 선택한 태그에서 빌드되도록 보장하기 위한 것이다.

`release_tag`는 `apps/desktop/src-tauri/tauri.conf.json`의 `version`과도 일치해야 한다. 예를 들어 앱 version이 `0.1.2`이면 릴리즈 태그는 `v0.1.2`여야 한다. 둘이 어긋나면 설치된 앱이 자기 자신을 계속 업데이트 대상으로 판단할 수 있으므로 워크플로가 실패한다.

GitHub의 `releases/latest` endpoint는 draft 릴리즈를 제공하지 않고, prerelease도 안정 채널의 latest로 쓰기 어렵다. `prerelease=true` 빌드는 수동 테스트용 asset 배포로 보고, 자동 업데이트 안정 채널은 publish된 정식 릴리즈로 운영한다.

## 태그 선택 릴리즈

정식 릴리즈는 태그를 push한 뒤, GitHub Actions에서 해당 태그를 선택해 만든다.

```bash
git tag v0.1.0
git push origin v0.1.0
```

태그를 push해도 자동 빌드는 실행되지 않는다. GitHub Actions에서 `create_release=true`, `release_tag=v0.1.0`으로 수동 실행한다. `build_ref`를 비워 두면 `release_tag`가 빌드 ref로 사용된다.

이 방식은 macOS arm64와 macOS x64를 빌드하고 draft GitHub Release를 만든다. artifact와 릴리즈 노트를 확인한 뒤 GitHub에서 draft를 publish한다. 같은 태그로 workflow를 다시 실행하면 기존 릴리즈 노트는 덮어쓰지 않고 artifact만 `--clobber`로 갱신한다.

## macOS 사이닝과 공증

서명되지 않은 macOS 빌드는 내부 테스트에는 쓸 수 있지만, 공개 배포에는 서명과 공증을 적용해야 한다. Mac App Store 밖에서 배포할 앱은 `Developer ID Application` 인증서를 사용한다.

공개 macOS 릴리즈를 만들기 전에 필요한 준비는 다음과 같다.

1. 유료 Apple Developer Program 계정에 가입한다.
2. Apple Developer에서 `Developer ID Application` 인증서를 만든다.
3. 인증서를 private key와 함께 `.p12`로 export한다.
4. App Store Connect에서 notarization용 API key를 만든다.
5. 아래 GitHub repository secret을 등록한다.
6. GitHub Actions에서 `HOP Desktop Release`를 수동 실행한다.

수동 실행으로 바로 공개 릴리즈를 만들려면 `create_release`를 켜고, `release_draft`를 끈다. 먼저 artifact를 확인하고 싶으면 `release_draft`를 켜 둔 뒤 GitHub Releases 화면에서 직접 publish한다.

GitHub repository secrets에 다음 값을 설정한다.

| Secret | 필수 여부 | 용도 |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | 사이닝 시 필수 | Base64 인코딩된 `.p12` 인증서 |
| `APPLE_CERTIFICATE_PASSWORD` | 사이닝 시 필수 | `.p12` export 시 사용한 비밀번호 |
| `KEYCHAIN_PASSWORD` | 권장 | CI 임시 keychain 비밀번호. 비워 두면 자동 생성 |
| `APPLE_SIGNING_IDENTITY` | 선택 | 정확한 signing identity. 비워 두면 가져온 인증서 중 첫 번째 적합한 identity 사용 |
| `APPLE_API_KEY` | API 공증 시 필수 | App Store Connect API key ID |
| `APPLE_API_ISSUER` | API 공증 시 필수 | App Store Connect issuer ID |
| `APPLE_API_KEY_P8_BASE64` | API 공증 시 필수 | Base64 인코딩된 `.p8` private key |

`APPLE_CERTIFICATE`는 export한 인증서에서 만든다.

```bash
openssl base64 -A -in /path/to/developer-id-application.p12 -out certificate-base64.txt
```

`APPLE_API_KEY_P8_BASE64`는 App Store Connect API key에서 만든다.

```bash
openssl base64 -A -in /path/to/AuthKey_XXXXXXXXXX.p8 -out appstore-api-key-base64.txt
```

권장 설정은 App Store Connect API key 방식이다. 이 경우 `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8_BASE64` 세 값을 모두 설정한다. 셋 중 하나라도 빠지면 macOS release build는 실패한다.

Tauri는 Apple ID 기반 공증도 지원한다. 이 방식을 쓰려면 다음 secret을 설정한다.

| Secret | 용도 |
| --- | --- |
| `APPLE_ID` | Apple 계정 이메일 |
| `APPLE_PASSWORD` | 앱 암호 |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

Apple 인증 정보는 `.env`에 저장하지 않는다. CI 사이닝 정보는 GitHub repository secret이나 environment secret으로만 관리한다.

macOS release build는 다음 조건을 만족하지 않으면 실패한다.

* `APPLE_CERTIFICATE`가 설정되어 있어야 한다.
* `APPLE_CERTIFICATE_PASSWORD`가 설정되어 있어야 한다.
* App Store Connect API key 방식 또는 Apple ID 방식 중 하나의 notarization credential 묶음이 모두 설정되어 있어야 한다.

## Windows 사이닝

### Problem 1-Pager

* Background: 홈페이지는 GitHub Release의 `HOP-windows-x64.msi`를 직접 다운로드 링크로 제공한다.
* Problem: 서명되지 않은 새 `.msi`는 Edge/Windows SmartScreen에서 "일반적으로 다운로드되지 않습니다"로 차단되거나 실행 전 경고가 뜰 수 있다.
* Goal: 공개 Windows 설치 파일의 다운로드 차단과 실행 경고를 줄인다.
* Non-goals: 사용자 브라우저 보안 설정을 우회하거나, 검증되지 않은 설치 파일을 안전하다고 표시하지 않는다.
* Constraints: 릴리즈 asset 이름은 README와 홈페이지 링크 때문에 안정적으로 유지해야 하며, 서명 secret은 GitHub repository secret 또는 environment secret에만 둔다.
* Implementation outline: 단기적으로 홈페이지와 README에는 경고 원인과 `...` 메뉴의 유지 동작을 안내한다. 운영자와 고급 사용자를 위해 GitHub Releases에는 체크섬 확인 경로를 유지한다. 정식 공개 배포 전에는 Windows Authenticode 코드 사이닝을 추가하고, 가능하면 평판 확보에 유리한 인증서 또는 Trusted Signing 경로를 사용한다.
* Verification plan: Windows에서 Edge 다운로드, 설치 파일 서명 상태, `SHA256SUMS.txt` 체크섬, GitHub Release asset 이름을 확인한다.
* Rollback or recovery notes: 서명 설정이 실패하면 릴리즈를 draft 상태로 유지하고 unsigned Windows asset은 공개 링크에서 내리거나 릴리즈 노트에 명확히 표시한다.

서명되지 않은 Windows 빌드도 실행은 되지만, 공개 배포 파일은 Edge 다운로드 단계와 Windows 실행 단계에서 SmartScreen 경고가 뜰 수 있다. 공개 릴리즈에는 Windows 코드 사이닝 인증서를 붙이는 것이 좋다. 다운로드 단계의 "일반적으로 다운로드되지 않습니다" 경고는 파일이 반드시 악성이라는 뜻이 아니라, 서명/평판이 부족한 새 설치 파일에서 흔히 발생하는 평판 기반 경고다.

사용자에게 안내할 수 있는 임시 절차는 다음과 같다. 공개 페이지에서는 1-2단계 중심으로 안내하고, 체크섬 비교는 릴리즈 문서나 고급 사용자 안내에만 둔다.

1. Edge 다운로드 목록에서 차단된 `HOP-windows-x64.msi`의 `...` 메뉴를 연다.
2. `유지`를 선택한다.
3. 추가 확인 화면이 나오면 게시자와 파일명을 확인한 뒤 유지한다.
4. GitHub Releases의 `SHA256SUMS.txt`와 내려받은 파일의 체크섬을 비교한다.

이 절차는 임시 우회일 뿐이며, 공개 배포에서 경고를 줄이는 실질적인 방법은 Authenticode 서명이다.

실무 선택지는 다음 정도다.

| 선택지 | 비고 |
| --- | --- |
| EV 인증서 | SmartScreen reputation 확보에 유리. 대개 벤더별 도구 필요 |
| Azure Trusted Signing | CI에서 `signtool` 또는 trusted-signing CLI와 함께 쓰기 좋음 |
| Custom `signCommand` | 사용하는 인증서/벤더에 맞춰 `tauri.conf.json`의 `bundle.windows.signCommand`에 연결 |

현재 워크플로는 Azure용 credential secret을 Tauri 빌드에 노출할 수 있게만 해 둔다. 실제 Windows artifact 서명은 `apps/desktop/src-tauri/tauri.conf.json`에 적절한 `bundle.windows.signCommand`를 추가해야 활성화된다.

Azure Trusted Signing을 쓴다면 보통 다음 secret이 필요하다.

| Secret | 용도 |
| --- | --- |
| `AZURE_CLIENT_ID` | Microsoft Entra application client ID |
| `AZURE_CLIENT_SECRET` | Client secret |
| `AZURE_TENANT_ID` | Tenant ID |

사용하는 signing provider가 요구하는 account/profile secret은 `signCommand`와 함께 추가한다.

## Tauri updater 서명

데스크톱 앱은 GitHub Releases의 `latest.json`을 업데이트 endpoint로 사용한다. updater artifact 생성은 일반 PR/로컬 번들 빌드가 signing key를 요구하지 않도록 릴리즈 워크플로에서만 `createUpdaterArtifacts=true` config override로 켠다. 릴리즈 빌드에는 updater private key가 필요하다.

1. keypair를 만든다.

```bash
pnpm --filter hop-desktop tauri signer generate -w ~/.tauri/hop.key
```

현재 `tauri.conf.json`에 들어간 public key는 `~/.tauri/hop.key.pub`에서 나온 값이다. 같은 private key를 계속 사용해야 기존 설치본이 다음 업데이트를 신뢰할 수 있다.

2. private key 내용을 GitHub repository secret `TAURI_SIGNING_PRIVATE_KEY`에 저장한다.
3. private key 비밀번호를 설정했다면 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`에 저장한다. 비밀번호가 없는 key는 워크플로가 빈 password 환경 변수를 넣어 서명한다.
4. GitHub Actions에서 `create_release=true`로 릴리즈를 빌드한다.
5. 릴리즈 asset에 `latest.json`, `HOP-updater-*.sig`, `HOP-updater-*` 파일이 올라갔는지 확인한다.

updater private key는 반드시 백업한다. 이 키를 잃으면 이미 배포된 앱에 신뢰 가능한 업데이트를 보낼 수 없다.

앱 시작 시 자동 업데이트는 debug 빌드에서는 실행하지 않는다. release 빌드에서만 updater endpoint를 확인한다.

## 메모

`../../loom`의 release workflow는 런타임 리소스 패키징, 엄격한 signing/updater 검증, 별도 release script까지 포함한다. HOP은 현재 그 정도 복잡도가 필요하지 않다.

HOP 워크플로는 플랫폼 matrix를 명시적으로 유지하고, lockfile 기반으로 빌드하며, `tauri-action`은 artifact 생성에만 쓰고, GitHub Release 생성은 별도 write-permission job에서 처리한다.
