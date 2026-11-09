# 키보드 단축키

`기본키`는 macOS에서 Cmd(⌘), Windows/Linux에서 Ctrl이다.
macOS의 Alt는 Option(⌥)이다. 아래 표는 HOP가 연결한 명령을 기준으로 한다.
문서·선택 영역·표 셀 등 현재 편집 상태에 따라 실행 가능한 명령이 달라진다.

## 공통 파일·편집

| 단축키 | 동작 |
| --- | --- |
| Alt+N | 새 문서 |
| 기본키+Shift+N | 새 창 |
| 기본키+O | 열기 |
| 기본키+Alt+O | 최근 문서 |
| 기본키+S | 저장 |
| 기본키+Shift+S | 다른 이름으로 저장 |
| 기본키+P | 인쇄 |
| F7 | 편집 용지 |
| 기본키+Z | 되돌리기 |
| 기본키+Shift+Z 또는 기본키+Y | 다시 실행 |
| 기본키+X / C / V | 잘라내기 / 복사 / 붙여넣기 |
| 기본키+A | 모두 선택 |
| 기본키+F | 찾기 |
| 기본키+F2 | 찾아 바꾸기 |
| 기본키+L | 다시 찾기 |
| Alt+G | 찾아가기 |

## 서식·쪽·표

| 단축키 | 동작 |
| --- | --- |
| 기본키+B / I / U | 굵게 / 기울임 / 밑줄 |
| Alt+L | 글자 모양 |
| Alt+T | 문단 모양 |
| F6 | 스타일 대화상자 |
| 기본키+] 또는 Alt+Shift+E | 글자 크기 증가 |
| 기본키+[ 또는 Alt+Shift+R | 글자 크기 감소 |
| Alt+Shift+Z / A | 줄 간격 증가 / 감소 |
| 기본키+Shift+L | 왼쪽 정렬 |
| 기본키+Shift+M | 양쪽 정렬 |
| Alt+Shift+H / C / D | 오른쪽 / 가운데 / 배분 정렬 |
| 기본키+Enter | 쪽 나누기 |
| 기본키+Shift+Enter | 단 나누기 |
| Alt+Enter | 표 줄·칸 추가 대화상자 |
| Alt+Delete | 표 줄·칸 삭제 대화상자 |
| Alt+F10 | 문자표 |

## 보기와 선택 컨트롤

| 단축키 | 동작 |
| --- | --- |
| 기본키+= 또는 기본키++ | 확대 |
| 기본키+- | 축소 |
| 기본키+0 | 100% |
| 기본키+F1 | 기본 도구 상자 표시 전환 |
| Escape | 열린 선택 메뉴·팔레트 닫기 |

상태 표시줄의 배율 버튼과 보기 메뉴에서 확대·축소 대화상자를 열 수 있다.
글꼴 등 선택 버튼은 Enter/Space로 열고, Tab·방향키로 항목을 이동한 뒤 Enter/Space로 선택한다.
색상 버튼에서는 아래 방향키로 첫 색상에 포커스를 옮길 수 있다.

## macOS native 메뉴 차이

| 단축키 | 동작 |
| --- | --- |
| Cmd+N | 새 문서 |
| Cmd+E | PDF 내보내기 |
| Cmd+Option+T | 표 셀 선택 |
| Cmd+Q | 앱 종료 |

Windows/Linux의 Ctrl+E는 upstream의 지우기 명령이다. macOS에서는 native 메뉴의
PDF 내보내기가 우선한다. Windows/Linux 새 문서는 Alt+N을 사용하고 창 닫기는 OS 동작을 따른다.

일부 Alt 단축키에는 한글 IME 대응 키와 물리 키도 등록돼 있다. 전체 매핑의 기준은
`apps/studio-host/src/command/shortcut-map.ts`, 고정 upstream의 `command/shortcut-map.ts`,
`apps/desktop/src-tauri/src/menu.rs`다. 단축키 변경 시 native 메뉴와 이 문서도 함께 확인한다.
