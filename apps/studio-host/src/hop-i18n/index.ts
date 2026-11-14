/**
 * HOP 문자열 진입점. HOP 코드는 upstream 대신 이 모듈에서 t 를 가져온다.
 *
 * upstream 언어팩은 모듈을 읽는 순간 자기 카탈로그를 등록한다. 여기서 HOP 고유 카탈로그를 합쳐
 * 다시 등록하므로, 이 모듈을 거친 t 는 앱이든 단위 테스트든 `hop.*` 키를 안다.
 * 로케일 결정(OS 언어 따르기)과 정적 마크업 갱신은 bootstrap.ts 가 맡는다.
 */

import { getLocale, registerCatalog, t, upstreamEnCatalog, upstreamKoCatalog } from '@/upstream/i18n';
import type { Catalog } from '@/upstream/i18n';
import hopKo from './locales/ko';
import hopEn from './locales/en';

registerCatalog('ko', { ...upstreamKoCatalog, ...hopKo } as Catalog);
registerCatalog('en', { ...upstreamEnCatalog, ...hopEn } as Catalog);

export { getLocale, t };
