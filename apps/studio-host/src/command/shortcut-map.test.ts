import { afterEach, describe, expect, it } from 'vitest';
import { defaultShortcuts, matchShortcut } from './shortcut-map';
import { resetDesktopPlatformOverride } from '../core/platform';

describe('shortcut-map', () => {
  afterEach(() => {
    delete (globalThis as { navigator?: Navigator }).navigator;
    resetDesktopPlatformOverride();
  });

  it('matches Meta shortcuts on macOS', () => {
    installNavigator({ platform: 'MacIntel', userAgent: 'Mac OS X' });

    expect(matchShortcut(keyEvent({ key: 's', metaKey: true }), defaultShortcuts)).toBe('file:save');
    expect(matchShortcut(keyEvent({ key: 'n', metaKey: true, shiftKey: true }), defaultShortcuts))
      .toBe('file:new-window');
    expect(matchShortcut(keyEvent({ key: 'o', metaKey: true, altKey: true }), defaultShortcuts))
      .toBe('file:open-recent');
  });

  it('keeps Ctrl+E mapped to upstream delete instead of PDF export', () => {
    installNavigator({ platform: 'Win32', userAgent: 'Windows NT 10.0' });

    expect(matchShortcut(keyEvent({ key: 'e', ctrlKey: true }), defaultShortcuts)).toBe('edit:delete');
  });

  it('does not treat Meta as Ctrl on Windows', () => {
    installNavigator({ platform: 'Win32', userAgent: 'Windows NT 10.0' });

    expect(matchShortcut(keyEvent({ key: 's', metaKey: true }), defaultShortcuts)).toBeNull();
    expect(matchShortcut(keyEvent({ key: 's', ctrlKey: true }), defaultShortcuts)).toBe('file:save');
  });

  it('preserves upstream physical-key shortcuts when Option changes the key value', () => {
    installNavigator({ platform: 'MacIntel', userAgent: 'Mac OS X' });

    expect(matchShortcut(
      keyEvent({ key: '©', code: 'KeyG', altKey: true }),
      defaultShortcuts,
    )).toBe('edit:goto');
  });

  it('preserves select-all and Save As while Korean IME reports Process', () => {
    installNavigator({ platform: 'MacIntel', userAgent: 'Mac OS X' });
    expect(matchShortcut(keyEvent({ key: 'Process', code: 'KeyA', metaKey: true }), defaultShortcuts))
      .toBe('edit:select-all');
    expect(matchShortcut(keyEvent({ key: 'Process', code: 'KeyS', metaKey: true, shiftKey: true }), defaultShortcuts))
      .toBe('file:save-as');
  });

  it('does not run unmodified shortcuts while a non-primary system modifier is held', () => {
    installNavigator({ platform: 'Win32', userAgent: 'Windows NT 10.0' });

    expect(matchShortcut(
      keyEvent({ key: 'p', code: 'KeyP', metaKey: true }),
      defaultShortcuts,
    )).toBeNull();
  });
});

function installNavigator(value: Pick<Navigator, 'platform' | 'userAgent'>): void {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
  });
}

function keyEvent(
  overrides: Partial<Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>>,
): KeyboardEvent {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}
