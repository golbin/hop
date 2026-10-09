# 여러 단에 걸친 제목 표와 본문 겹침

## 배경과 문제

HOP 0.4.5 / rhwp 0.8.7에서 본문 너비에 가까운 쪽 기준 Square 표와
2단 본문이 겹친다. 첨부 학술대회 양식은 제목·요약을 1×1 표에 두고,
그 아래에 서론과 2단 본문을 배치한다. 표 속성 자체는 정상 파싱된다.

## 목표와 비범위

공간 예약과 실제 배치가 같은 본문 점유 조건을 사용하도록 수정한다.
입력 파일의 textWrap 속성, 저장 바이트, 문단과 제어문자 순서는 변경하지 않는다.
글꼴 대체, 원본 문서 공개, upstream PR 제출은 이 작업 범위 밖이다.

## 제약과 구현 방향

HOP의 third_party/rhwp는 읽기 전용이다. 엔진 수정은 별도 fork에서 진행하고,
HOP에서는 검증한 엔진 커밋, WASM, provenance를 함께 연결해야 한다.
현재 stable v0.8.7을 기준으로 downstream용 수정안을 준비한다.
Square 전체를 TopAndBottom으로 처리하지 않고 여러 단을 막는 쪽/용지 기준
표만 대상으로 한다. 작은 표 옆으로 흐르는 본문과 글앞/글뒤 개체는 반례다.

## 검증 계획

수정 전 원본 WASM에서 첨부 문서를 재현한다. 원본 속성을 바꾸는 실험은
진단에만 사용하고 산출 코드에 포함하지 않는다. 수정 엔진에서 원본 입력의
모든 쪽, 제목 표/본문 겹침, 본문 순서·중복·누락과 저장 후 재열기를 확인한다.
Native와 fresh WASM, HOP studio build 및 해당 upstream 검사를 실행한다.
독립적인 한컴 PDF가 없어 현재 한컴 출력과의 픽셀 일치는 미검증이다.

## 복구

HOP의 엔진 pin과 WASM/provenance 갱신을 같은 커밋에서 되돌린다.
원본 HWP는 읽기만 하며 수정하지 않는다.

## 검증 결과

rhwp fork의 `f97972b063823581a18b18c958efa6de2b029d10` 소스를 사용한다.
Actions에서 native check, WASM clippy, 기존 float_placement unit tests와 fresh
release WASM 빌드가 통과했다. 생성 artifact의 SOURCE_COMMIT으로 검증된 소스와
HOP pin을 연결한다.

첨부 문서는 공개 업로드 없이 로컬에서 검증했다. 전체 3쪽의 텍스트 run이 수정 전과
동일하며, 첫쪽 제목 표의 하단은 y=620이고 본문의 최소 y는 103.9에서 680.5로 바뀌었다.
표의 Square 속성은 유지되고 저장 후 재열기에서도 겹침이 없다. 글앞/글뒤, 겹침 허용,
하단 정렬, 본문 밖, 단 기준, 인라인, 좁은 표, 1단의 9개 변형은 이전 SVG와 byte 단위로
같다. 모든 쪽의 SVG를 PNG로 렌더링하여 배치를 확인했다.

HOP upstream 계약 검증과 studio build도 통과했다. Windows의 CRLF checkout 때문에
source counterpart baseline이 달라지는 문제는 source text만 LF로 정규화하여 해결하며,
생성된 WASM artifact의 provenance는 실제 bytes의 해시를 그대로 검증한다.
