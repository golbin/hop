# rhwp 이관 항목 정리: 2026-04-22

## 목적

이 문서는 HOP 저장소의 오픈 이슈 중 HOP 데스크톱 셸이 아니라 `rhwp` 또는 `rhwp-studio`에서 처리해야 할 항목을 정리한다. 목적은 이 저장소에서 `third_party/rhwp`를 계속 read-only로 유지하면서도, upstream 이관 대상과 근거를 명확히 남기는 것이다.

## 검토한 자료

- HOP 오픈 이슈 `#3`, `#4`, `#6`, `#7`
- [UPSTREAM.md](./UPSTREAM.md)
- [vite.config.ts](../../apps/studio-host/vite.config.ts)
- [hop-overrides.ts](../../apps/studio-host/hop-overrides.ts)
- [ruler.ts](../../third_party/rhwp/rhwp-studio/src/view/ruler.ts)
- [input-handler-mouse.ts](../../third_party/rhwp/rhwp-studio/src/engine/input-handler-mouse.ts)
- [viewport-manager.ts](../../third_party/rhwp/rhwp-studio/src/view/viewport-manager.ts)
- [canvas-view.ts](../../third_party/rhwp/rhwp-studio/src/view/canvas-view.ts)
- [equation/mod.rs](../../third_party/rhwp/src/renderer/equation/mod.rs)

## 경계 요약

HOP는 `rhwp-studio` 전체를 소유하지 않는다. 실제로는 Vite alias override를 통해 일부 파일만 shadowing하고 있고, 편집기 캔버스, 눈금자 상호작용, 편집기 내부 컨텍스트 메뉴 처리, 줌 처리, 페이지 렌더링, 수식 렌더링은 여전히 upstream 소유 영역이다.

따라서 사용자 제보가 아래 범주에 속할 때만 HOP 이슈로 남긴다.

- Tauri 셸 통합
- 네이티브 메뉴 및 창 동작
- HOP 데스크톱 브리지 코드
- HOP가 직접 오버라이드한 메뉴, 커맨드, 스타일
- 패키징과 릴리즈 통합

그 외 편집기 본체 동작은 원칙적으로 upstream 소유로 본다. 다만 이후 조사에서 HOP 오버라이드 계층이 원인으로 확인되면 소유권은 다시 검토한다.

## 이관 항목

### 1. 눈금자 여백 드래그 미지원

- 원본 이슈: HOP `#4`의 2번 항목
- 사용자 제보: 페이지 여백 간격을 드래그해도 반응하지 않음

소유권 판단 근거:
- 현재 upstream 눈금자 구현은 표시와 리사이즈 처리는 있지만, 여백 조절을 위한 포인터 hit test나 drag 처리 연결은 보이지 않는다.
- HOP는 이 눈금자 surface를 override하지 않는다.

근거 코드:
- [ruler.ts](../../third_party/rhwp/rhwp-studio/src/view/ruler.ts): 렌더링과 크기 갱신 중심이며, 여백 드래그를 위한 이벤트 연결이 없음

upstream에 요청할 범위:
- 눈금자 hit test 추가
- 여백 조절 drag affordance 추가
- 여백 변경 명령과 연결
- 단일 단, 다단, 표/셀 내부 문맥에서 모두 검증

### 2. 컨텍스트 메뉴 이후 페이지 하이라이트 잔류

- 원본 이슈: HOP `#4`의 3번 항목
- 사용자 제보: 컨텍스트 메뉴를 띄운 뒤 닫아도 페이지 전체가 포커스된 것처럼 계속 강조됨

소유권 판단 근거:
- 편집기 캔버스 내부의 컨텍스트 메뉴 라우팅과 선택 상태 정리는 upstream input handler가 담당한다.
- HOP는 해당 mouse input surface를 override하지 않는다.

근거 코드:
- [input-handler-mouse.ts](../../third_party/rhwp/rhwp-studio/src/engine/input-handler-mouse.ts): 편집기 내부 `onContextMenu` 처리 소유

upstream에 요청할 범위:
- 컨텍스트 메뉴 종료 후 selection, object selection, focus cleanup 경로 점검
- 우선 macOS에서 재현 확인 후, 다른 OS에서도 동일 동작인지 교차 검증

### 3. 트랙패드 제스처와 줌 상호작용 품질

- 원본 이슈: HOP `#3`의 제스처 관련 항목
- 사용자 제보: 터치패드 확대/축소 및 이동 제스처가 부자연스럽고 불편함

소유권 판단 근거:
- viewport의 wheel 및 zoom 동작은 upstream이 소유한다.
- HOP는 `viewport-manager.ts`를 override하지 않는다.

근거 코드:
- [viewport-manager.ts](../../third_party/rhwp/rhwp-studio/src/view/viewport-manager.ts): modifier-wheel 기반 zoom 처리 소유

upstream에 요청할 범위:
- 트랙패드 pinch 처리
- momentum scroll과 modifier key 해석
- zoom anchor 동작
- 가능하면 macOS와 Windows precision touchpad 기준으로 모두 검증

### 4. 줌 단계별 blur 및 고DPI 선명도 문제

- 원본 이슈:
- HOP `#3`의 DPI blur 항목
- HOP `#7`의 zoom 단계별 blur 항목
- 사용자 제보:
- 특정 확대율 또는 고해상도 환경에서 글자와 이미지가 흐릿해짐

소유권 판단 근거:
- canvas render scale과 device pixel ratio 처리 로직은 upstream 소유다.
- HOP는 페이지 렌더링이나 `canvas-view` surface를 override하지 않는다.

근거 코드:
- [canvas-view.ts](../../third_party/rhwp/rhwp-studio/src/view/canvas-view.ts): `renderScale = zoom * dpr` 계산 수행

upstream에 요청할 범위:
- fractional zoom에서 CSS 크기와 physical pixel 크기 관계 점검
- blur 원인이 raster snapping인지, 페이지 재정렬인지, canvas 재사용인지, guide redraw인지 분리 조사
- 100%, 125%, 133%, 150%, 200% 기준 재현 매트릭스 추가

### 5. 수식 렌더링 공백 또는 오동작

- 원본 이슈: HOP `#6`
- 사용자 제보: HWP 문서의 수식이 비어 보이거나 정상적으로 렌더링되지 않음

소유권 판단 근거:
- 수식 파싱과 렌더링은 upstream `rhwp` renderer가 담당한다.
- HOP는 엔진 소비자일 뿐이며 vendor 코드 안에서 수식 렌더링을 고치면 안 된다.

근거 코드:
- [equation/mod.rs](../../third_party/rhwp/src/renderer/equation/mod.rs): tokenizer, parser, layout, SVG rendering 모듈 제공

추가 메모:
- 현재 submodule에는 최근 수식 관련 커밋이 이미 여러 개 포함되어 있으므로, 완전 미지원이라기보다 일부 문법 미지원이나 회귀일 가능성이 있다.

upstream에 요청할 범위:
- HOP 이슈 재현 문서와 upstream sample equation 문서로 함께 재현
- 원인이 parser coverage인지, layout gap인지, wasm rendering integration인지 분리
- 만약 upstream studio에서는 재현되지 않고 HOP에서만 재현되면 upstream 이관 전에 소유권을 다시 점검

## 권장 upstream 이슈 분할

하나의 큰 이슈로 넘기지 말고 아래처럼 쪼개는 편이 낫다.

1. `rhwp-studio`: 눈금자 여백 드래그 상호작용 미지원
2. `rhwp-studio`: 컨텍스트 메뉴 후 선택 또는 포커스 하이라이트 잔류
3. `rhwp-studio`: 트랙패드 제스처 및 고DPI/줌 blur 문제
4. `rhwp`: 수식 렌더링 재현 및 지원 범위 점검

## upstream 이슈 작성 메모

- upstream 이슈 본문에 원래 HOP 이슈 번호를 같이 적어 추적 가능하게 만든다.
- 가능하면 HOP 이슈에 첨부된 스크린샷을 같이 사용한다.
- 확대율, OS 버전, 패키징 방식 같은 재현 조건을 구체적으로 적는다.
- 수식 렌더링은 재배포 가능한 최소 HWP/HWPX 샘플이 있으면 함께 첨부한다.
- blur 관련 제보는 Windows 고DPI인지 Linux AppImage인지 같이 적어서 runtime 차이와 renderer 차이를 분리할 수 있게 한다.

## HOP에 남겨둘 항목

아래 항목은 새 증거가 나오지 않는 한 upstream으로 넘기지 않는다.

- macOS 네이티브 단축키 동작
- macOS 네이티브 메뉴 표기
- 상단 메뉴 우클릭 시 예상치 못한 reload/debug 노출
- HOP override 계층이 원인인 Windows shortcut routing 문제
- Linux AppImage fcitx5 패키징 또는 runtime integration 문제
- Flatpak 배포 요청

## 다음 단계

- HOP 쪽 셸 계층 조사, 특히 Windows shortcut routing과 equation 재현 범위 점검이 끝난 뒤 upstream 이슈를 만들거나 갱신한다.
