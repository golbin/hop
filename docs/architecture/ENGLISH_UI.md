# 영어 UI

HOP 화면과 데스크톱 쪽 문구를 한국어와 영어로 보여 준다. `third_party/rhwp`는 고치지 않고, upstream 언어팩(`rhwp-studio/src/i18n`)을 그대로 쓰면서 HOP 문구만 더한다.

## 언어 결정

1. 질의 문자열 `?lang=en` (개발용)
2. 사용자가 고른 언어: 보기 → 언어 메뉴, `localStorage['rhwp-locale']`
3. OS(웹뷰) 언어: 영어 OS 에서는 처음부터 영어
4. 그 밖에는 한국어

언어를 바꾸면 선택만 저장하고 다음 실행부터 적용한다. upstream 언어팩과 같은 이유다(열린 대화상자와 상태 표시를 안전하게 다시 그리기 어렵다).

## 구성

- `apps/studio-host/src/hop-i18n/index.ts`: upstream 카탈로그에 HOP 카탈로그(`locales/ko.ts`, `locales/en.ts`, 키는 `hop.*`)를 합쳐 등록한다. HOP 코드는 여기서 `t`를 가져온다.
- `apps/studio-host/src/hop-i18n/bootstrap.ts`: 위 순서로 로케일을 정한다. upstream 모듈이 최상위에서 `t()`를 부르기 전에 평가되도록 `main.ts`의 첫 import 로 둔다.
- `apps/studio-host/index.html`: 문구마다 `data-i18n*` 표시를 붙인다. upstream 마크업에 같은 문구가 있으면 그 키를 쓴다.
- `apps/studio-host/src/host/language.ts`: 보기 → 언어 메뉴(시스템 설정/한국어/English).
- `apps/desktop/src-tauri/src/ui_text.rs`: 데스크톱 쪽 오류·진행 문구 표. 웹뷰가 시작할 때 `set_ui_locale` 로 언어를 알려 준다. 알려 주기 전과 테스트에서는 한국어다.

번역하지 않는 것: 글꼴 이름, 엔진 오류를 판별하는 문구(`document-open.ts`), 개발자용 로그.

## upstream 병합 후 확인

`pnpm run test:studio`의 `hop-i18n/coverage.test.ts`가 다음을 막는다.

- `index.html`에 표시 없는 한국어 문구나 툴팁이 생김
- 없는 키를 쓰는 `data-i18n*` 표시나 `t('...')` 호출
- HOP ko/en 카탈로그의 키·자리표시자 불일치

실패하면 새 문구에 upstream 키(같은 문구가 upstream `index.html`이나 카탈로그에 있으면)나 `hop.*` 키를 붙인다. 데스크톱 쪽은 `ui_text.rs` 테스트가 키 누락과 자리표시자 개수를 확인한다.
