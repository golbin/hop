import {
  defaultShortcuts as upstreamDefaultShortcuts,
  matchShortcut,
} from '@upstream/command/shortcut-map';
import type { ShortcutDef } from '@upstream/command/shortcut-map';

export type { ShortcutDef };
export { matchShortcut };

const hopShortcuts: [ShortcutDef, string][] = [
  [{ key: 'n', ctrl: true, shift: true }, 'file:new-window'],
  [{ key: 'o', ctrl: true }, 'file:open'],
  [{ key: 's', ctrl: true, shift: true }, 'file:save-as'],
  [{ key: 'e', ctrl: true }, 'file:export-pdf'],
];

const hopShortcutKeys = new Set(hopShortcuts.map(([shortcut]) => shortcutKey(shortcut)));

export const defaultShortcuts: [ShortcutDef, string][] = [
  ...hopShortcuts,
  ...upstreamDefaultShortcuts.filter(([shortcut]) => !hopShortcutKeys.has(shortcutKey(shortcut))),
];

function shortcutKey(shortcut: ShortcutDef): string {
  return [
    shortcut.key.toLowerCase(),
    shortcut.ctrl ? 'ctrl' : '',
    shortcut.shift ? 'shift' : '',
    shortcut.alt ? 'alt' : '',
  ].join(':');
}
