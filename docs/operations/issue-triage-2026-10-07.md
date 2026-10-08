# 열린 이슈 검증 및 소규모 수정

## Background / Problem

열린 이슈 25개와 PR 1개를 검토했다. 배포판 v0.4.4에 이미 반영된 항목도 열려 있고,
rhwp v0.8.7 로컬 통합과 배포판 상태는 다르다. native 파일 열기는 upstream 암호 UI를
우회하며(#98), 도구 상자 라벨을 끄는 옵션이 없다(#97).

## Goal / Non-goals

근거가 충분한 이슈는 종료하고, 입력·테마·툴바·PDF와 첨부 문서를 검증한다.
암호 열기 및 라벨 옵션은 작고 독립적인 HOP 기능으로 구현한다. upstream 수정,
임의 OS 우회, 모바일·ARM 패키징, 제품 버전 변경·커밋·배포는 범위 밖이다.

## Constraints / Implementation

- upstream은 read-only. 기존 암호 UI와 WASM atomic load를 조합한다.
- 취소·오입력 시 기존 문서와 native session을 보존한다. 암호는 저장하거나 로그하지 않는다.
- native 저장 검증은 암호 HWP를 지원하지 않는다. 원본의 암호를 조용히 제거하지 않도록
  직접 저장은 차단하고, 다른 이름으로 암호 없이 저장할 때 명시적인 안내·선택을 받는다.
- 라벨 옵션은 보기 메뉴, 전용 root 속성·CSS, 단일 저장 키로 구현한다.
- 종료는 배포·실제 검증 근거에 따른다. 배포 전 수정과 미검증 OS는 명시해 열어둔다.

## Verification / Recovery

암호 재시도·취소·session 정리·저장 guard를 focused test로 확인한다. Studio/upstream
테스트와 빌드, Chromium UI 동작 및 실제 WASM fixture를 검증한다. 출력 문제는 원본을
보존한 복사본으로 비교한다. 중요한 파일/session 변경은 GPT-6.1 Sol 직접 리뷰를 받는다.
오류 시 이번 작업 파일만 복구한다. GitHub 종료 판단이 틀렸으면 해당 이슈를 다시 연다.

## Results

### GitHub 조치

2026-10-07에 #90(다크 테마), #92(검색 가능한 PDF), #93(툴바 정렬)을 completed로 종료했다.
각각 v0.4.3/v0.4.4 릴리스 및 기존 유지보수자의 검증 기록이 있다. 나머지 이슈 22개와
PR #101은 열려 있다. 오래됐다는 이유만으로 버그를 종료하지 않았다.

### 구현

- #98: browser/native 파일 열기에 기존 upstream 암호 대화상자를 연결했다. 오입력은 재시도,
  취소는 기존 문서/session 유지 및 후보 native session 정리로 처리한다.
- 암호 문서의 native 직접 저장은 차단한다. Save As에서 암호 없는 HWP로 변환한다는
  확인을 받으며, 저장 commit 성공 후에만 암호 저장 guard를 해제한다.
- #97: 보기 메뉴에 라벨 표시/숨김 옵션을 추가했다. upstream DOM을 보존하고 전용 CSS와
  localStorage 키 하나로 구현했다. 재실행 및 같은 origin의 다른 창에도 적용된다.
- #95/#100: rhwp v0.8.7에 이미 포함된 입력 수정으로 해결되는 것을 확인했다. 별도 HOP
  우회 패치는 추가하지 않았다. 해당 upstream 통합은 로컬 commit 2e9aaf4에 있다.

### 실제 검증

- Studio 테스트 159개 통과, upstream 계약 테스트 34개 통과.
- TypeScript 검사 및 Studio production build 통과. 기존 번들 크기/dynamic import 경고는 남는다.
- native `searchable_pdf_contains_a_unicode_text_map` 테스트 통과.
- Chromium의 실제 입력 이벤트로 p/P/p/P 모두 문서에 들어갔다. CapsLock P keydown은
  소비되지 않았다. 합성 keydown이므로 CapsLock 하드웨어 입력 자체를 검증한 것은 아니다.
- 실제 WASM으로 생성한 암호 HWP에서 오입력→재시도→성공, Enter 제출, Escape 취소,
  기존 문서/암호 guard 보존 및 편집 입력으로 focus 복귀를 확인했다.
- upstream 실제 암호 HWP5 샘플(공개 암호 123456)은 64페이지로 열렸다.
- 라벨 메뉴 클릭, 높이 56→32px, 라벨 숨김, 버튼 overflow 없음, 재로드 후 유지,
  두 창 사이 storage 동기화를 확인했다. 다크 테마 재로드 후 유지도 확인했다.
- #78 공개 첨부 HWP는 현 WASM에서 10페이지 모두 SVG를 생성했다. 각 페이지에 text
  요소가 있으며 6페이지도 렌더링된다. 내용/셀 누락이나 실제 인쇄 결과의 대조 검증은
  수행하지 않았으므로 이슈를 종료하지 않았다.
- GPT-6.1 Sol 직접 리뷰: 중요한 제품 결함 없음. reviewer focused tests 및 타입 검사 통과.
- 테스트용 첨부 복사본은 작업 트리에서 제거했고 upstream source는 변경하지 않았다.

### 남은 항목과 판단

| 이슈/PR | 판단 및 다음 검증 |
| --- | --- |
| #95, #100, PR #101 | 로컬 v0.8.7에서 p/P 입력 확인. GitHub main/배포판 반영 전이므로 유지. PR의 단일 문자 단축키 일괄 차단은 upstream 수정 이후 불필요하다. |
| #97, #98 | 구현 완료. 10월 8일 macOS native dialog·Save As·암호 변환본 재열기까지 확인. 배포 전이므로 이슈 유지. |
| #78 | 공개 원본 10페이지 렌더링 확인. Windows 실제 print/PDF 원본 대조 필요. |
| #99 | 마지막 줄 잘림은 유사 upstream 수정만으로 판단하지 않음. 신고 문서 미첨부라 동일 문서 검증 불가. |
| #85 | macOS 새 표 셀 입력은 즉시 표시됨. 신고된 Windows 환경의 지연 재현 필요. |
| #94 | macOS 약 990pt 창에서 자동 배율 변경 재현 후 desktop load 경계에서 배율 복원. native 재검증 통과, 배포 전 유지. |
| #96 | macOS 창 간 복사에서 첫 문단 가운데 정렬 손실 재현. WASM 직접 HTML paste는 보존되므로 native 전달/변환 경로 조사 필요. |
| #73 | 한컴 저장 호환성/내용 손상은 중요. 원본과 저장 결과 파일 필요, 오래돼도 유지. |
| #76 | 공개 첨부로 macOS 그림 삽입·resize·PDF 포함 확인. 신고 환경과 다른 배치 조건은 계속 검증 필요. |
| #77, #79 | Linux IME/graphics는 해당 배포판·입력기 환경에서 검증 필요. macOS 결과로 종료하지 않음. |
| #68 | 오래된 AppImage launch failure. 최신 AppImage 실행 로그와 Ubuntu 재현 필요. |
| #70 | 위첨자 출력 원본과 PDF/인쇄 대조 필요. |
| #72 | Raspberry Pi/Wayland 창 최대화는 해당 환경 재현 필요. |
| #81 | 성능 문제의 문서와 단계별 시간 필요. |
| #89 | Homebrew 설치와 공식 DMG의 서명/asset 대조 필요. 기존 release 서명 검사만으로 해결 판정하지 않음. |
| #91 | 쪽 번호·표 입력·선택·폭 조정의 여러 요구가 혼재. 동작별 재현과 분리가 필요. |
| #80 | Windows ARM64는 packaging/updater/signing 및 실제 장치 검증이 필요한 큰 작업. |
| #102 | 동일 문서 다중 view는 문서 state/undo/save 소유권 설계가 필요한 큰 작업. |
| #50 | Android는 현재 desktop 제품 범위를 넘어서는 큰 작업. 오래됐다는 이유로 제안을 폐기하지 않음. |

이번 소규모 수정은 커밋·push·배포하지 않았다. 암호 기능은 `document-open.ts` 및 호출부,
라벨 기능은 전용 모듈/CSS/메뉴 항목을 제거하면 되므로 다른 기능과의 결합을 최소화했다.

추가 native computer use 결과와 #94 수정 근거는
[macOS 실제 앱 QA](local-ui-qa-2026-10-08.md)에 기록했다.


## 구현 전체 재검토 및 개선

### Problem / Goal

암호 대화상자의 긴 대기 중 Finder/native 메뉴의 문서 작업이 겹칠 수 있다.
암호 HWP의 종료 확인에서 저장을 고르면 직접 저장 guard가 지원되는 Save As를 가로막았다.
문서/session 소유권을 보존하고, 지원되는 저장 선택은 종료 흐름에서도 이용 가능해야 한다.

### Design / Recovery

- Native 공개 문서 작업 진입점은 하나의 busy 플래그를 공유한다. 진행 중에는 새 작업을
  거절하고 닫기 확인은 false를 반환한다. 큐나 task framework는 추가하지 않았다.
- 열린 transaction의 안전 저장은 private 구현을 호출해 잠금을 재획득하지 않는다.
  정상 완료·실패·취소 모두 finally에서 잠금을 해제한다.
- Browser 파일 열기·새 문서는 초기화가 끝날 때까지 교체 플래그를 공유한다.
- 종료·교체 안전 저장은 암호 문서도 Save As로 연결한다. 암호 없는 저장 확인을 취소하면
  기존 문서와 dirty/encryption 상태를 보존한다.
- 암호 문자열에 빈 문자열을 재할당해도 immutable 문자열을 지우지 못하므로 해당 finally를
  제거했다. 암호 입력 DOM 정리는 기존 upstream 대화상자가 담당하며 앱은 암호를 보관하지 않는다.
- 라벨 변경의 viewport 갱신은 기존 ResizeObserver에 맡긴다. 별도 이벤트/observer를 추가하지 않는다.
- 기존 bridge/main 파일은 이미 300줄을 넘는다. 이번에는 관련 경계에 짧은 진입점과 보호만
  추가했다. 기존 대형 파일 전체 분리는 이슈 수정과 무관한 구조 변경이므로 포함하지 않았다.
  테스트도 기존 native filesystem/session fixture를 재사용해 별도 mock infrastructure를 만들지 않았다.
- 오류 시 이번 변경만 되돌린다. upstream와 외부 API, native Rust 구현은 변경하지 않았다.

### Verification

- Studio 159개 테스트 및 production build 통과. 암호 대기 중 open/picker/new/save/SaveAs/PDF/
  print/close 겹침 차단, 대기 종료 후 재사용, Save As 대기 중 다른 문서 열기 차단을 확인했다.
- 암호 문서의 종료 저장 승인/취소 테스트 통과. 저장 성공 후 보호 해제와 취소 시 보존을 확인했다.
- Chromium 실제 화면에서 암호 입력 중 다른 파일과 새 문서 요청을 보내도 문서 generation은
  바뀌지 않고 대화상자는 하나였다. 암호 제출 후 정상 로드되고 다음 새 문서 생성도 성공했다.
- 라벨 숨김 후 scroll-container와 내부 viewport 모두 751→775px로 갱신됐다.
- GPT-6.1 Sol 직접 리뷰에서 경쟁 조건(P1)과 종료 저장 경로(P2)를 확인했다. 수정 후 같은
  리뷰어의 재검토에서 추가 중요 문제 없음. 재검토는 코드/추가 테스트 확인이며 OS 수동 QA는 아니다.
- 각 OS의 실제 native 대화상자와 저장은 이번 재검토에서 수동 실행하지 않았다.
