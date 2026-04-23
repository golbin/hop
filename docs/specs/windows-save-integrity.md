# Windows Save Integrity 1-Pager

## Background

HOP 이슈 `#10`은 Windows에서 문서를 수정한 뒤 `저장` 또는 `다른 이름으로 저장`을 수행하면 결과 파일이 손상된다고 보고한다. 같은 문서를 upstream `rhwp` 쪽에서 저장하면 문제가 재현되지 않는다는 제보가 있어, HOP 데스크톱 저장 파이프라인을 우선 의심해야 한다.

## Problem

현재 HOP 데스크톱 저장은 프런트엔드 WASM이 만든 HWP 바이트를 `Uint8Array -> number[] -> Tauri invoke -> Rust Vec<u8>` 경로로 넘긴 뒤 Rust가 파일로 기록한다. 이 경로는 upstream web 저장 경로와 다르고, Windows WebView IPC에서 대용량 바이너리를 JSON 배열 형태로 전달하는 지점이 취약하다.

## Goal

저장 바이트를 대용량 IPC로 직접 넘기지 않고, 프런트엔드가 scoped filesystem에 staging 파일을 먼저 쓴 다음 Rust가 그 파일을 다시 읽어 검증하고 최종 경로로 교체하도록 바꾼다. 이렇게 해서 Windows 저장 손상 가능성을 줄이고, 최종 파일 교체 전 Rust 검증도 유지한다.

## Non-goals

`third_party/rhwp` 직렬화 로직 변경, HWPX 저장 지원 확대, 인쇄/PDF 경로 변경, 또는 파일 포맷 자체의 호환성 개선은 이번 범위가 아니다.

## Constraints

`pnpm`만 사용한다. `third_party/rhwp`는 read-only로 유지한다. macOS, Windows, Linux에서 같은 저장 UX를 유지해야 한다. 기존 외부 변경 감지, revision guard, 저장 후 dirty 상태 갱신을 깨뜨리면 안 된다.

## Implementation outline

데스크톱 앱에 `tauri-plugin-fs`를 연결하고, 프런트엔드가 저장 대상 옆의 staging 파일 하나에만 쓰도록 한다. Rust는 `commit_staged_hwp_save` 명령으로 staging 파일을 읽어 HWP 파싱/변환 검증 후 최종 파일을 교체하고 세션 상태를 갱신한다. frontend fs scope도 부모 디렉터리 전체가 아니라, 매 저장마다 생성한 exact staging 파일 경로만 동적으로 허용한다.

## Verification plan

Rust 단위 테스트로 staging 저장 커밋 경로를 추가 검증하고, 기존 데스크톱 테스트를 다시 실행한다. 프런트엔드 저장 브리지 단위 테스트는 staging 파일 쓰기와 커밋 명령 인자를 검증한다. 수동으로는 Windows에서 기존 파일 저장, 다른 이름으로 저장, 파일 연결로 연 문서 재저장을 확인한다.

## Rollback or recovery notes

회귀가 생기면 프런트엔드 staging 저장 경로와 `commit_staged_hwp_save` 명령만 되돌리면 된다. 기존 `save_hwp_bytes` 경로는 남겨두지 않고 대체하되, rollback 범위는 HOP 데스크톱 셸과 studio-host 브리지에 한정된다.
