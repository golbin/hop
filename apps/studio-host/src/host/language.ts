import type { CommandDef } from '@/upstream/commands';
import {
  collectBrowserSources,
  getLocale,
  isSupportedLocale,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  resolveLocale,
  storeLocale,
} from '@/upstream/i18n';
import type { Locale } from '@/upstream/i18n';
import { t } from '../hop-i18n';

/** 'system' 은 저장된 선택을 지우고 OS 언어를 따른다. */
type LanguageChoice = 'system' | Locale;

const CHOICES: readonly LanguageChoice[] = ['system', 'ko', 'en'];

function readChoice(): LanguageChoice {
  const stored = readStoredLocale();
  return isSupportedLocale(stored) ? stored : 'system';
}

function writeChoice(choice: LanguageChoice): void {
  if (choice !== 'system') {
    storeLocale(choice);
    return;
  }
  try { localStorage.removeItem(LOCALE_STORAGE_KEY); }
  catch { /* Keep the current window usable when storage is unavailable. */ }
}

function markChoice(choice: LanguageChoice): void {
  for (const item of document.querySelectorAll<HTMLElement>('[data-language-choice]')) {
    const checked = item.dataset.languageChoice === choice;
    item.classList.toggle('active', checked);
    item.setAttribute('aria-checked', String(checked));
  }
}

/** 다음 실행에서 쓰일 로케일. bootstrap.ts 와 같은 규칙으로 정한다. */
function nextLaunchLocale(): Locale {
  return resolveLocale({ ...collectBrowserSources(), preferBrowserLanguage: true });
}

/**
 * 언어를 고른다. upstream 언어팩과 같이 선택만 저장하고 화면은 다음 실행부터 바꾼다.
 * 이미 열린 대화상자와 상태 표시까지 안전하게 다시 그리려면 앱을 새로 띄우는 편이 낫다.
 */
function chooseLanguage(choice: LanguageChoice): void {
  writeChoice(choice);
  markChoice(choice);
  if (nextLaunchLocale() === getLocale()) return;
  const status = document.getElementById('sb-message');
  if (status) status.textContent = t('hop.language.appliesNextLaunch');
}

/** 메뉴의 언어 선택 표시를 저장된 선택에 맞춘다. */
export function initLanguageMenu(): void {
  markChoice(readChoice());
}

export const languageCommands: CommandDef[] = CHOICES.map((choice) => ({
  id: `view:language-${choice}`,
  label: t(`hop.language.${choice}`),
  execute() {
    chooseLanguage(choice);
  },
}));
