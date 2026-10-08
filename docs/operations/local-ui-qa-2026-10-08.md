# macOS 실제 앱 QA 및 #94 배율 수정

## Background / Problem

Chromium 검증만으로는 native 파일 선택·저장·암호 UI와 macOS WebKit 동작을 보장할 수 없다.
최신 debug HOP.app을 빌드하고 computer use로 실제 macOS 앱을 조작한다.
#94는 실제 창을 약 1197pt에서 990pt로 줄이고 새 문서를 생성했을 때 100→118%로 재현됐다.
upstream CanvasView.loadDocument의 모바일용 innerWidth < 1024 자동 fit이 desktop에도 적용된다.

## Goal / Non-goals

기존 수정의 native 경로와 재현 가능한 표·그림·clipboard·출력을 확인한다.
Desktop 문서 초기화에서는 사용자가 고른 배율을 유지한다. upstream read-only,
모바일 및 upstream 기본 정책은 변경하지 않으며 commit/push/release는 하지 않는다.

## Implementation / Constraints

HOP 조립 지점 initializeDocument에서 desktop의 기존 배율을 캡처하고,
upstream loadDocument 완료 후 같은 배율로 복원한다. 새 renderer subclass·설정·observer는
추가하지 않는다. 최초 배율은 기존 100%, 사용자가 고른 배율은 이후 문서에서도 유지된다.
QA는 임시 문서와 공개 upstream/이슈 첨부 복사본으로 실행한다. 원본은 덮어쓰지 않는다.
기존 tauri-bridge 및 main은 이미 권장 LOC를 넘지만 이번 수정은 초기화 경계의 짧은 정책뿐이다.

## Verification / Recovery

Studio 테스트·타입·build 및 실제 HOP.app에서 990pt 새 문서/로드 배율을 확인한다.
GPT-6.1 Sol 직접 리뷰를 받는다. 문제 시 이번 initializeDocument 변경만 되돌린다.
OS 차이·한컴 호환성과 미재현은 해결 판정과 구분한다. 개별 결과는 아래에 기록한다.

## Results

### 실행 환경과 검증

- 이 Mac에서 debug HOP.app을 두 번 빌드했다. 마지막 빌드는 #94 수정 포함이며
  TypeScript, Studio production build, Quick Look 빌드 및 Tauri app bundle 생성이 통과했다.
- #94 수정 후 Studio 테스트 159개 통과. GPT-6.1 Sol 직접 리뷰에서 중요 문제 없음.
- macOS Tauri의 WKWebView는 Argent의 Chromium 제어 대상이 아니므로 native computer use로
  앱·파일 선택기·저장 경고·창 전환·인쇄 대화상자를 직접 조작했다.
- QA 파일은 `/tmp/hop-qa-20261008`에 있다. 공개 fixture 복사본과 임시 문서만 사용했다.
  원본은 덮어쓰지 않았고 QA의 저장하지 않은 변경은 버렸다. 라벨 표시와 창 너비를 복원했다.

### 이슈별 결과

| 대상 | 실제 실행 결과 | 판단 |
| --- | --- | --- |
| #94 | 수정 전 약 990pt 창의 새 문서가 100→118%로 바뀜. 수정 후 100% 유지. 확대 버튼으로 선택한 110%도 새 문서 및 파일 열기 후 유지. 라벨 표시/숨김은 약 990pt와 1197pt에서 유지됨. | 배율 문제 추가 수정 완료. 배포 전이므로 이슈 유지. |
| #97 | 보기 메뉴로 라벨 숨김/표시, 높이 변경, 새 창 및 앱 재실행 후 숨김 유지 확인. 마지막에는 원래 표시 상태로 복원. | macOS native 경로 검증 완료. |
| #98 | 암호 HWP 오입력→재시도, Escape 취소 시 기존 문서 유지, 올바른 암호로 64페이지 열기 확인. 직접 저장 차단, Save As 경고 취소 후 차단 유지, 명시적 선택 후 별도 파일 저장 확인. 변환본은 암호 없이 다시 열리고 64페이지 유지. | macOS native 경로 검증 완료. 원본 보존 확인. |
| #95/#100 | 실제 native 앱에서 `pP macOS test` 입력·표시·HWP 저장 성공. 한국어 문자열은 붙여넣기로 확인. | p/P 검증 통과. CapsLock 및 실제 한글 IME 조합 입력은 검증하지 않음. |
| #85 | 새 4×5 표의 셀에 `pP table typing123` 입력 후 즉시 표시됨. | 이 Mac에서는 7초 지연 미재현. 신고된 Windows 환경 확인 필요. |
| #76 | 공개 TestFile.zip의 HWP/PNG로 서명 위치에 그림 배치, 선택 핸들로 확대, native PDF 내보내기 성공. Poppler 렌더링에서도 확대된 서명 그림 존재 확인. | 이 Mac에서 삽입·resize·PDF 누락 미재현. 신고 환경/다른 배치 조건은 미해결. |
| #96 | 가운데 정렬 첫 문단과 왼쪽 정렬 둘째 문단을 전체 복사하고 새 창의 빈 문서에 붙여넣으면 첫 문단이 왼쪽 정렬로 바뀜. 줄 간격 표시도 빈 값. | 실제 결함 재현. 수정 완료로 판단하지 않음. |

암호 원본 복사본의 저장 전후 SHA-256은 모두
`59d4bed335b9552fe78fa68d2a56f7cfa3d586bcdeaaba839af80df13f3e08dc`였다.
Save As 경고를 취소한 `plain-cancelled.hwp`는 생성되지 않았다.

### #96 재현 및 다음 조사

1. 새 문서에 `Centered heading`을 입력하고 가운데 정렬한다.
2. 다음 문단에 `Second paragraph`를 입력하고 왼쪽 정렬한다.
3. Cmd+A, Cmd+C, Cmd+Shift+N으로 새 창을 열고 새 문서를 만든 뒤 Cmd+V 한다.
4. 대상 창의 첫 문단이 왼쪽 정렬로 바뀌며 원본 창은 가운데 정렬을 유지한다.

정렬·줄 간격을 명시한 두 문단 HTML을 native computer use로 붙여넣어도 같은 손실이
보였다. 반면 현재 vendor WASM에 같은 HTML을 직접 `pasteHtml`하면 첫 문단 center/200%,
둘째 left/150%가 보존된다. 빈 문서를 HWP로 직렬화 후 다시 읽은 경우도 같았다.
따라서 이 검사만으로 core HTML parser 결함이나 rich clipboard write 실패를 확정할 수 없다.
다음 조사는 native paste 이벤트의 MIME/HTML 전달, upstream HTML 변환 및 WASM 호출 인수를
비교해야 한다. 확인 전 새 clipboard backend나 광범위한 upstream 우회는 추가하지 않았다.

### 출력과 남은 검증 범위

임시 두 문단 문서의 Cmd+P로 macOS 인쇄 대화상자와 1페이지 미리보기를 확인했고,
취소 후 편집으로 복귀했다. 실물 인쇄는 실행하지 않았다. 이는 Windows #78의 원본 표
출력 대조 검증을 대신하지 않는다. #78은 이전 WASM 10페이지 렌더링 검사까지만 유효하다.
#99/#73/#70/#81의 재현 문서, Linux/Windows 전용 환경, 실제 한컴 저장 호환성은 여전히
필요하다. 이번 결과로 해당 이슈를 종료하지 않았으며 commit/push/release도 하지 않았다.
