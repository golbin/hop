export { applyI18nToDom, getLocale, isSupportedLocale, resolveLocale, t } from '@upstream/i18n';
export type { Catalog, Locale } from '@upstream/i18n';
export { registerCatalog, setLocale } from '@upstream/i18n/core';
export {
  collectBrowserSources,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  storeLocale,
} from '@upstream/i18n/resolve';
export { default as upstreamKoCatalog } from '@upstream/i18n/locales/ko';
export { default as upstreamEnCatalog } from '@upstream/i18n/locales/en';
