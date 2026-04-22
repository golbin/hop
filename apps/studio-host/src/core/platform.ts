export type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'unknown';

type NavigatorLike = Pick<Navigator, 'platform' | 'userAgent'> | undefined;
type ModifierEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>;
type PlatformResolver = () => Promise<DesktopPlatform>;

let desktopPlatformOverride: DesktopPlatform | null = null;

export function detectDesktopPlatform(
  nav: NavigatorLike = typeof navigator === 'undefined' ? undefined : navigator,
): DesktopPlatform {
  if (desktopPlatformOverride) return desktopPlatformOverride;

  const platform = (nav?.platform ?? '').toLowerCase();
  const userAgent = (nav?.userAgent ?? '').toLowerCase();

  if (platform.includes('mac') || userAgent.includes('mac os')) return 'macos';
  if (platform.includes('win') || userAgent.includes('windows')) return 'windows';
  if (platform.includes('linux') || userAgent.includes('linux')) return 'linux';
  return 'unknown';
}

export async function hydrateDesktopPlatform(
  resolvePlatform: PlatformResolver = invokeDesktopPlatform,
): Promise<DesktopPlatform> {
  const platform = await resolvePlatform().catch(() => detectDesktopPlatform());
  desktopPlatformOverride = platform;
  return platform;
}

export function resetDesktopPlatformOverride(): void {
  desktopPlatformOverride = null;
}

export function usesMetaAsPrimaryModifier(platform = detectDesktopPlatform()): boolean {
  return platform === 'macos';
}

export function hasPrimaryModifier(
  event: ModifierEvent,
  platform = detectDesktopPlatform(),
): boolean {
  return usesMetaAsPrimaryModifier(platform) ? event.metaKey : event.ctrlKey;
}

export function normalizeShortcutLabel(
  label: string,
  platform = detectDesktopPlatform(),
): string {
  if (platform !== 'macos') return label;

  return label
    .replace(/CmdOrCtrl/gi, '⌘')
    .replace(/\bCmd\b/gi, '⌘')
    .replace(/\bCtrl\b/gi, '⌘')
    .replace(/\bAlt\b/gi, '⌥')
    .replace(/\bOption\b/gi, '⌥')
    .replace(/\bShift\b/gi, '⇧')
    .replace(/\bNum\s+/gi, '')
    .replace(/\+/g, '')
    .replace(/,\s*/g, ' ');
}

async function invokeDesktopPlatform(): Promise<DesktopPlatform> {
  if (typeof window === 'undefined' || window.location?.protocol !== 'tauri:') {
    return detectDesktopPlatform();
  }

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<DesktopPlatform>('desktop_platform');
}
