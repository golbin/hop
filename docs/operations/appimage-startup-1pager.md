# 0.5.2 Linux·Windows 호환성

## 배경과 문제

- #124: 0.5.1이 CachyOS/KDE Wayland/NVIDIA, 155%·100% 다중 모니터에서 종료된다. 보고자가 deb의 거대 공유 메모리 버퍼·SIGSEGV와 OOM 기록 없음을 확인했고, `GDK_BACKEND=x11`에서는 정상 실행됨을 확인했다. VM에서 NVIDIA 하드웨어 재현을 한 것은 아니다.
- Debian 13/WebKitGTK 2.54/Fcitx5 VM에서 기존 AppImage의 호스트 입력기 모듈 로드가 `g_once_init_leave_pointer` 부재로 실패한다. 번들 GLib 2.72와 호스트 모듈을 섞는 것이 문제다.
- #116: 0.5.1 MSI 첫 설치가 성공해도 세 바로가기가 없다. 전역 `REINSTALLMODE=amu`가 생성까지 막는 것을 Windows Server 2025(build 26100) VM에서 재현했다.

## 목표와 비목표

검증한 Linux 시작·입력기·Windows 설치 문제를 최소 경계 변경으로 고쳐 0.5.2로 배포한다.
macOS/Windows/Linux, 기존 AppImage 단독 실행, updater 서명과 안정 asset 이름을 유지한다.
`third_party/rhwp`는 수정하지 않는다. 샌드박스 해제, 배율 강제 변경, 입력기 비활성화는 하지 않는다.
#96은 SDK 0.9.0의 단일 문단 HTML 붙여넣기에서 정렬·줄 간격 손실을 재현했으나 별도 우회 구현은 넣지 않는다.
#121 첨부는 손실 보고 0으로 열기·저장·재열기가 되지만 한컴 뷰어 호환성 해결로 간주하지 않는다.
하드웨어·원본 파일·외부 뷰어가 필요한 나머지 이슈는 검증 범위를 구분한다.

## 구현

- Linux 시작 전, 명시적인 GDK_BACKEND가 없고 DISPLAY가 있을 때 AppImage 또는 KDE Wayland만 x11을 기본으로 선택한다. 다른 세션과 사용자 설정은 보존한다.
- 원본 AppImage의 실행 파일·리소스·runtime·번들 fallback을 보존한다. 실행 파일의 내장 rpath만 제거하여 시스템 라이브러리를 검색하게 한다. 번들 경로는 기존 AppRun.wrapped의 LD_LIBRARY_PATH를 사용한다. glibc loader `--list`가 성공하면 전체 시스템 런타임을 사용하고, 아니면 기존 GTK hook/AppRun.wrapped를 사용한다. GTK/GLib/IME를 부분적으로 섞지 않는다. 재시작에서 이전 GTK_DATA_PREFIX/GTK_EXE_PREFIX 쌍으로 식별한 번들 소유 경로만 제거한다. 외부 사용자 경로·빈 override·논리적 입력기/백엔드 선택은 유지한다. 런처를 별도 AppRun 파일로 두어 JS 문자열 이스케이프와 중복을 없앤다.
- 공식 appimagetool 1.9.1을 SHA-256으로 검증하고 원본 AppImage runtime을 재사용해 자동 runtime 다운로드를 피한다. Zstd 22로 패키징한다. 기존 서명을 삭제하고 릴리스 workflow에서 다시 서명한다. 두 실행 경로 모두 CI에서 실제 시작을 검사한다.
- MSI는 전역 REINSTALLMODE·RemoveShortcuts 특례를 제거한다. AppSearch로 기존 바탕화면 바로가기를 확인하고 업그레이드 때 해당 구성 요소만 조건부 설치한다. 시작 메뉴와 설치 폴더의 제거 바로가기는 정상 MSI 수명주기로 복구한다.
- 길이 예외: 기존 linux_runtime.rs는 302줄이다. 독립적인 시작 정책 18줄을 기존 OS 경계에 추가하고, 테스트를 분리한다. 추가 추상화는 두지 않는다.

## 검증

- 기존 AppImage의 Fcitx 실패/수정 패키지의 `가나다` 조합, HWP 저장·재열기, PDF 저장·한글 텍스트 보존을 확인한다.
- 시스템 라이브러리와 번들 라이브러리 각각의 실행 경로를 실제 프로세스 maps로 확인한다. 사용할 수 없는 호스트 WebKit 라이브러리를 주입한 경우도 번들로 실행되어야 한다.
- AppImage의 ELF 코드·리소스 해시, 실제 라이브러리 경로, AppImage용 updater target, 새 updater 서명을 확인한다.
- MSI 첫 설치, 기존/삭제/누락 바로가기 업그레이드, 다음 버전 업그레이드와 제거를 검증한다. 시제품 검사 후 최종 WiX 설치 산출물로 반복한다.
- 전체 단위 검사, Linux 환경 정책 검사, fmt/clippy·Studio build, Windows/Linux 후보 패키지 검증 후 5개 플랫폼 릴리스를 검증한다.

## 배포와 복구

버전을 0.5.2로 맞추고 main에 머지한 뒤 필수 검사를 실행한다. 후보 설치 파일 검증 후 새 태그·draft를 만들고, 5개 플랫폼 빌드·서명·공증·업데이터 검증 후 공개한다. 기존 태그와 0.5.1은 유지한다. 실패한 draft는 공개하지 않는다. 임시 QA VM·터널·자격증명을 정리한다. 완료한 이 문서는 삭제하고 근거는 git history와 릴리스에 남긴다.

- 추가 회귀 재현: Tauri 재시작은 환경을 그대로 상속한다. 이전 0.5.1 번들 환경을 새 패키지에 전달하자 WebKitNetworkProcess 경로 오류로 exit127이 났다. 번들 경로 정리 후 동일한 상속 환경과 사용자 override 보존을 실제 런처 테스트 및 VM 프로세스 maps로 검증한다.

- Linux 후보의 시작 검사는 모두 통과했으나 ABI 검사가 strings 결과의 GLIBC_2.142.5로 실패했다. 임의 데이터 문자열을 요구 버전으로 취급하지 않고 readelf의 ELF 버전 메타데이터를 검사한다. 가짜 GLIBC 문자열을 추가한 기존 ELF로 이 차이를 검증한다.
