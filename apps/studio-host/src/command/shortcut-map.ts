import {
  defaultShortcuts as upstreamDefaultShortcuts,
} from '@/upstream/shortcuts';
import type { ShortcutDef } from '@/upstream/shortcuts';
import { detectDesktopPlatform, hasPrimaryModifier } from '../core/platform';

export type { ShortcutDef };

const hopShortcuts: [ShortcutDef, string][] = [
  [{ key: 'n', ctrl: true, shift: true }, 'file:new-window'],
  [{ key: 'o', ctrl: true, alt: true }, 'file:open-recent'],
];

const hopShortcutKeys = new Set(hopShortcuts.map(([shortcut]) => shortcutKey(shortcut)));

export const defaultShortcuts: [ShortcutDef, string][] = [
  ...hopShortcuts,
  ...upstreamDefaultShortcuts.filter(([shortcut]) => !hopShortcutKeys.has(shortcutKey(shortcut))),
];

export function matchShortcut(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  shortcuts: [ShortcutDef, string][],
): string | null {
  const primaryModifier = hasPrimaryModifier(event);
  const anyPrimaryModifier = event.ctrlKey || event.metaKey;
  const platform = detectDesktopPlatform() === 'macos' ? 'mac' : 'other';
  const eventKey = event.key.toLowerCase();
  const eventCode = event.code.toLowerCase();

  for (const [def, commandId] of shortcuts) {
    if (def.platform && def.platform !== platform) continue;
    if (def.ctrl ? !primaryModifier : anyPrimaryModifier) continue;
    if ((def.shift ?? false) !== event.shiftKey) continue;
    if ((def.alt ?? false) !== event.altKey) continue;
    if (eventKey === def.key) return commandId;
    if (def.code && eventCode === def.code.toLowerCase()) return commandId;
  }

  return null;
}

function shortcutKey(shortcut: ShortcutDef): string {
  return [
    shortcut.key.toLowerCase(),
    shortcut.code?.toLowerCase() ?? '',
    shortcut.ctrl ? 'ctrl' : '',
    shortcut.shift ? 'shift' : '',
    shortcut.alt ? 'alt' : '',
    shortcut.platform ?? '',
  ].join(':');
}
