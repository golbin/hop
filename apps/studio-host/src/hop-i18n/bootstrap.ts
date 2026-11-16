import { invoke, isTauri } from '@tauri-apps/api/core';
import './index';
import { applyI18nToDom, collectBrowserSources, resolveLocale, setLocale } from '@/upstream/i18n';
import type { Locale } from '@/upstream/i18n';

async function start(): Promise<void> {
  let locale = resolveLocale({ ...collectBrowserSources(), preferBrowserLanguage: true });
  if (isTauri()) {
    locale = await invoke<Locale>('init_ui_locale', { locale });
  }
  setLocale(locale);
  applyI18nToDom();

  // Upstream editor modules translate some labels when they are first imported.
  await import('../main');
}

void start().catch((error: unknown) => {
  console.error('[startup] HOP initialization failed', error);
  const status = document.getElementById('sb-message');
  if (status) status.textContent = String(error);
});
