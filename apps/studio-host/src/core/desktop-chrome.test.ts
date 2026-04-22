import { describe, expect, it } from 'vitest';
import { normalizeDesktopChromeTitle } from './desktop-chrome';
import { normalizeShortcutLabel } from './platform';

describe('desktop-chrome', () => {
  it('normalizes macOS shortcut labels', () => {
    expect(normalizeShortcutLabel('Ctrl+Shift+S', 'macos')).toBe('⌘⇧S');
    expect(normalizeDesktopChromeTitle('찾기 (Ctrl+F)', 'macos')).toBe('찾기 (⌘F)');
  });

  it('does not rewrite non-shortcut tooltips', () => {
    expect(normalizeDesktopChromeTitle('줄 간격 증가 (+5%)', 'macos')).toBe('줄 간격 증가 (+5%)');
    expect(normalizeDesktopChromeTitle('파일 이름 + 쪽 번호', 'macos')).toBe('파일 이름 + 쪽 번호');
  });
});
