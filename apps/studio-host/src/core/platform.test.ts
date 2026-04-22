import { afterEach, describe, expect, it } from 'vitest';
import {
  detectDesktopPlatform,
  hydrateDesktopPlatform,
  resetDesktopPlatformOverride,
} from './platform';

describe('platform', () => {
  afterEach(() => {
    delete (globalThis as { navigator?: Navigator }).navigator;
    resetDesktopPlatformOverride();
  });

  it('hydrates and reuses the resolved desktop platform', async () => {
    await expect(hydrateDesktopPlatform(async () => 'macos')).resolves.toBe('macos');
    expect(detectDesktopPlatform({ platform: 'Win32', userAgent: 'Windows NT 10.0' })).toBe('macos');
  });

  it('falls back to navigator detection when hydration fails', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', userAgent: 'Windows NT 10.0' },
      configurable: true,
    });

    await expect(hydrateDesktopPlatform(async () => {
      throw new Error('ipc unavailable');
    })).resolves.toBe('windows');
  });
});
