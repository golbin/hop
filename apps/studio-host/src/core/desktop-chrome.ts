import { normalizeShortcutLabel, type DesktopPlatform } from './platform';

const NON_EDITOR_CHROME_SELECTOR = '#menu-bar, #icon-toolbar, #style-bar, #status-bar';
const SHORTCUT_TEXT_SELECTOR = '.md-shortcut, .tb-split-shortcut';

export function applyDesktopChromePlatformState(
  doc: Document,
  platform: DesktopPlatform,
): void {
  if (platform === 'macos') {
    normalizeShortcutPresentation(doc, platform);
  }
}

export function installNonEditorContextMenuGuards(doc: Document): void {
  const preventContextMenu = (event: Event) => {
    event.preventDefault();
  };

  doc.querySelectorAll<HTMLElement>(NON_EDITOR_CHROME_SELECTOR).forEach((element) => {
    element.addEventListener('contextmenu', preventContextMenu);
  });
}

function normalizeShortcutPresentation(doc: Document, platform: DesktopPlatform): void {
  doc.querySelectorAll<HTMLElement>(SHORTCUT_TEXT_SELECTOR).forEach((element) => {
    const text = element.textContent;
    if (!text) return;
    element.textContent = normalizeShortcutLabel(text, platform);
  });

  doc.querySelectorAll<HTMLElement>('[title]').forEach((element) => {
    const title = element.getAttribute('title');
    if (!title) return;
    const normalized = normalizeDesktopChromeTitle(title, platform);
    if (normalized !== title) {
      element.setAttribute('title', normalized);
    }
  });
}

export function normalizeDesktopChromeTitle(
  title: string,
  platform: DesktopPlatform,
): string {
  if (!hasShortcutTokens(title)) return title;
  return normalizeShortcutLabel(title, platform);
}

function hasShortcutTokens(label: string): boolean {
  return /\b(CmdOrCtrl|Cmd|Ctrl|Alt|Option|Shift|Num)\b/i.test(label);
}
