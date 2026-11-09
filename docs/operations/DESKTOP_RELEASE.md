# HOP 데스크톱 릴리스

배포는 `.github/workflows/hop-desktop.yml`의 수동 `HOP Desktop Release`로 수행한다.
태그 push와 PR은 빌드를 자동 실행하지 않는다. 빌드는 고정 태그에서 수행하며,
macOS 서명·공증, updater 서명과 asset 검증을 마친 draft를 안정 채널에 공개한다.

## 순서

1. 전체 변경을 리뷰하고 완료한 작업 문서를 정리한다. 관련 PR의 cherry-pick 출처를 보존한다.
2. 아래 버전 소스를 같은 `MAJOR.MINOR.PATCH`로 맞추고 릴리스 노트를 준비한다.
3. 원격 main 변경을 확인한 뒤 작업 브랜치를 main에 머지한다. 강제 push는 사용하지 않는다.
4. **머지된 main**에서 필수 검증을 수행한다. 통과 전에 태그·배포 빌드를 시작하지 않는다.
5. 검증한 main을 push하고 `vMAJOR.MINOR.PATCH` 태그를 생성·push한다. 기존 태그는 이동하지 않는다.
6. 해당 태그의 GitHub draft release를 만들고 릴리스 노트를 넣는다.
7. workflow를 실행해 지원 플랫폼을 빌드하고 draft에 산출물을 올린다.
8. 다운로드한 산출물·설치·updater를 검증한 다음 정식 릴리스를 publish한다.

버전 소스:

- 루트 `package.json`, `apps/desktop/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- desktop `Cargo.toml`과 `Cargo.lock`의 `hop-desktop` package
- Quick Look Preview/Thumbnail `Info.plist`의 `CFBundleShortVersionString`

`pnpm run test:upstream`의 버전 계약이 정합성을 확인한다.
Quick Look `CFBundleVersion`은 별도의 bundle build number다.

## 머지 후 필수 검증

Rust는 `config/rhwp-upstream.json`의 toolchain을 지정한다. JavaScript는 Node 24와 pnpm을 사용한다.

```sh
pnpm install --frozen-lockfile
pnpm upstream:verify
pnpm test
pnpm run clippy:desktop
pnpm run build:studio
git diff --check
```

관련 Rust crate의 fmt와 Quick Look clippy도 확인한다. workflow를 바꿨으면 actionlint를 실행한다.
최종 로컬 앱 smoke가 필요할 때만 이 단계에서 debug bundle을 만든다.

```sh
pnpm --filter hop-desktop tauri build --debug --bundles app
```

플랫폼 GUI에서는 복사한 sample로 열기·편집·저장·재열기, HWPX 열기, PDF·인쇄 진입,
미저장 guard, 다중 창, drag/drop과 변경된 UI를 확인한다. native 색 선택은 OS마다
확정 방식이 다르다. Windows에서는 Enter 확정과 바깥 클릭 취소를, GTK에서는 선택창을
닫기 전 연속 색 변경도 확인한다. 실제 수행한 OS·경로를
기록하고, 자동 테스트나 다른 OS의 성공을 실물 인쇄·IME·문서 호환성 검증으로 대체하지 않는다.

## Workflow 입력과 플랫폼

| 입력 | 정식 릴리스 설정 |
| --- | --- |
| `build_ref`, `release_tag` | 같은 `vMAJOR.MINOR.PATCH` 태그 |
| macOS arm64/x64, Windows x64, Linux x64/arm64 | 모두 선택 |
| `run_tests` | true |
| `create_release` | true |
| `release_draft` | true; 검증 후 publish |
| `prerelease` | false; 베타일 때만 true |

릴리스 태그는 앱 버전과 일치해야 한다. `create_release=true`에서 `build_ref`를 비우면
`release_tag`가 사용되며, 두 macOS target과 signing/notarization credential이 필수다.
artifact만 확인하는 별도 작업은 `create_release=false`로 실행하고, commit ref는 전체 SHA를 사용한다.

| 플랫폼 | Runner | Rust target |
| --- | --- | --- |
| macOS arm64 | macos-15 | aarch64-apple-darwin |
| macOS x64 | macos-15-intel | x86_64-apple-darwin |
| Windows x64 | windows-2025 | x86_64-pc-windows-msvc |
| Linux x64 | ubuntu-22.04 | x86_64-unknown-linux-gnu |
| Linux arm64 | ubuntu-22.04-arm | aarch64-unknown-linux-gnu |

빌드 job은 contents read 권한만 사용하고, 별도 release job만 contents write를 사용한다.
Node 24, Corepack/pnpm과 frozen lockfile을 사용하며 upstream submodule도 고정 commit으로 checkout한다.
Linux는 ELF의 최대 GLIBC 요구가 2.35를 넘으면 실패한다. x64 AppImage는 extract smoke도 수행한다.
Linux arm64의 배포 범위는 Debian/Ubuntu 계열 deb다.

## 배포 파일과 updater

README의 `/releases/latest/download/` 링크 때문에 다음 이름은 유지한다.

| 플랫폼 | 고정 asset 이름 |
| --- | --- |
| macOS arm64 / x64 | `HOP-macos-arm64.dmg` / `HOP-macos-x64.dmg` |
| Windows x64 | `HOP-windows-x64.msi` |
| Linux x64 | `HOP-linux-x64.deb`, `HOP-linux-x64.rpm`, `HOP-linux-x64.AppImage` |
| Linux arm64 | `HOP-linux-arm64.deb` |

생성된 경우 Windows exe도 올린다. updater bundle과 sig, `latest.json`, `SHA256SUMS.txt`도 포함한다.
workflow는 기존 draft의 릴리스 노트를 유지하고 산출물만 갱신한다.

공개 전 확인할 항목:

- tag가 검증한 main commit을 가리키며 모든 선택 플랫폼 job이 성공했는가.
- 고정 asset이 빠지지 않았고 `SHA256SUMS.txt`와 다운로드 파일의 SHA-256이 일치하는가.
- macOS 앱·두 Quick Look 확장·공유 엔진 dylib의 서명, 앱 notarization과 staple이 유효한가.
- 두 확장이 `@rpath`로 번들 내부 공통 라이브러리를 찾고, native build smoke가 통과했는가.
- `latest.json`의 버전, 해당 태그 URL, installer-specific/fallback platform key와 서명이 맞는가.
- updater 서명을 앱에 설정된 public key로 검증했는가.
- 다운로드한 설치 파일에서 변경된 핵심 흐름이 동작하는가.

Linux x64 AppImage는 Tauri가 만든 실행 파일·HOP 리소스·AppImage runtime을 보존하고,
`scripts/repack-linux-appimage.mjs`에서 시스템 WebKitGTK를 사용하는 파일 구성으로 다시 패키징한다.
공식 appimagetool 1.9.1의 SHA-256을 검사한다. 시스템 런타임을 로드할 수 있으면 번들 GTK·입력기·테마 경로 설정을 사용하지 않고, 없으면 기존 번들 실행 경로를 유지한다. 실행 파일의 내장 rpath만 제거하고, 번들 경로에서는 기존 AppRun의 LD_LIBRARY_PATH를 사용한다. 실행 파일을 중복 저장하지 않는다.
재패키징하면 기존 `.sig`를 삭제하므로 릴리스 workflow에서 반드시 다시 서명한다.
AppImage updater marker, 리소스 해시, 시스템 WebKitGTK 실행과 한글 입력을 확인한다.

Windows MSI 바로가기 변경은 HOP가 설치되지 않은 임시 Windows VM에서 관리자 PowerShell로 확인한다.
아래 검사는 실제 설치·업그레이드·제거를 수행하며 로그는 `%TEMP%`에 남긴다.
0.5.1의 바로가기 누락 복구, 첫 설치, 기존 바로가기 유지, 사용자가 삭제한 바탕화면 바로가기 유지와 제거를 검사한다.

```powershell
.\scripts\test-windows-msi.ps1 -BaselineMsi C:\qa\HOP-0.5.1.msi -CandidateMsi C:\qa\HOP-candidate.msi
```

안정 updater endpoint는 `https://github.com/golbin/hop/releases/latest/download/latest.json`이다.
installer-specific key는 해당 패키지 형식을 가리키며, generic Linux fallback은 deb를 사용한다.
AppImage를 updater로 deb에 전환하는 흐름은 보장하지 않는다. draft/prerelease는 안정 latest 채널이 아니다.
앱은 release 빌드에서만 자동 업데이트를 확인하고, dirty native session이 없을 때만 재시작한다.
publish 후 public latest endpoint가 검증한 manifest와 일치하는지도 확인한다.

## 서명 자격증명

비밀 값은 repository/environment secret에만 저장하고 로그·문서·dotenv에 넣지 않는다.
Apple/Tauri/Windows 값은 필요한 build step에만 전달한다.

| Secret | 용도 |
| --- | --- |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Developer ID Application p12와 비밀번호 |
| `KEYCHAIN_PASSWORD` | 선택; CI 임시 keychain 비밀번호, 없으면 생성 |
| `APPLE_SIGNING_IDENTITY` | 선택; 가져온 인증서의 identity 지정 |
| `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8_BASE64` | App Store Connect API 공증 credential 묶음 |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | API 방식 대신 사용할 Apple ID 공증 credential 묶음 |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater 서명 키와 선택적 비밀번호 |

Apple API 방식 또는 Apple ID 방식 중 완전한 한 묶음을 준비한다. p12/p8은 Base64로 저장한다.
updater 키는 기존 설치본이 신뢰하는 같은 키를 사용하고 백업한다. 키 교체를 일반 릴리스에 섞지 않는다.
updater 산출물 생성은 release workflow의 `createUpdaterArtifacts=true` override로만 활성화한다.

Windows는 현재 Authenticode signCommand가 없어 unsigned다. Azure credential 전달만으로
서명되는 것은 아니다. 추후 서명을 도입할 때 `bundle.windows.signCommand`와 provider 설정을 함께
구현·검증한다. 현재 배포 안내는 README의 Windows 설치 유의사항을 따른다.

## 실패와 복구

실패한 draft는 공개하지 않는다. 태그 전 실패는 수정·재검증 후 진행한다. 태그를 push한 뒤
source 수정이 필요하면 새 버전으로 진행하며 기존 태그를 이동하거나 history를 재작성하지 않는다.
같은 source의 일시적 build 실패만 같은 태그로 재실행한다. 이전 안정 릴리스와 updater feed는
새 draft를 공개하기 전까지 유지한다.
