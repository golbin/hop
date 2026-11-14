/**
 * HOP 언어 초기화. main.ts 가 가장 먼저 import 해야 한다.
 *
 * upstream 언어팩은 모듈을 읽는 순간 로케일을 정한다(질의 문자열 → 저장값 → ko).
 * HOP 는 사용자가 고른 언어가 없으면 OS(웹뷰) 언어를 따른다. 영어 OS 에서는 처음부터 영어로 뜬다.
 * HOP 고유 카탈로그는 ./index.ts 가 합친다.
 *
 * upstream 모듈 가운데 최상위에서 t() 를 부르는 상수 표가 있으므로, 그 모듈들이 평가되기 전에
 * 로케일이 정해져 있어야 한다. 그래서 이 파일은 main.ts 의 첫 import 로 둔다.
 */

import './index';
import { applyI18nToDom, getLocale, resolveLocale } from '@upstream/i18n';
import type { Locale } from '@upstream/i18n';
import { setLocale } from '@upstream/i18n/core';
import { collectBrowserSources } from '@upstream/i18n/resolve';

setLocale(resolveLocale({ ...collectBrowserSources(), preferBrowserLanguage: true }));

/** 정적 마크업(data-i18n*)을 정해진 로케일로 갱신한다. DOM 이 준비된 뒤 한 번 부른다. */
export function initHopI18n(): Locale {
  applyI18nToDom();
  return getLocale();
}
