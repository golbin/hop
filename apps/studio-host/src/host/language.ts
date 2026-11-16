import type { CommandDef } from '@/upstream/commands';
import {
  isSupportedLocale,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
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

function markChoice(choice: LanguageChoice): void {
  for (const item of document.querySelectorAll<HTMLElement>('[data-language-choice]')) {
    const checked = item.dataset.languageChoice === choice;
    item.classList.toggle('active', checked);
    item.setAttribute('aria-checked', String(checked));
  }
}

function chooseLanguage(choice: LanguageChoice): void {
  const status = document.getElementById('sb-message');
  try {
    if (choice === 'system') localStorage.removeItem(LOCALE_STORAGE_KEY);
    else localStorage.setItem(LOCALE_STORAGE_KEY, choice);
  } catch {
    if (status) status.textContent = t('hop.language.saveFailed');
    return;
  }
  markChoice(choice);
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
