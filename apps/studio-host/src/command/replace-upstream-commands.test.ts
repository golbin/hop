import { describe, expect, it, vi } from 'vitest';
import studioHtml from '../../index.html?raw';
import type { CommandDef } from '@/upstream/commands';
import {
  insertCommands,
  formatCommands,
  pageCommands,
  tableCommands,
  toolCommands,
  viewCommands,
} from '@/upstream/commands';
import { toolbarLabelsCommand } from '../host/toolbar-labels';
import { editCommands } from './commands/edit';
import { fileCommands } from './commands/file';
import { assertUniqueCommandIds, replaceUpstreamCommands } from './replace-upstream-commands';
import { defaultShortcuts } from './shortcut-map';

const command = (id: string): CommandDef => ({ id, label: id, execute: vi.fn() });
const productionCommandGroups = [
  fileCommands,
  editCommands,
  [...viewCommands, toolbarLabelsCommand],
  formatCommands,
  insertCommands,
  tableCommands,
  pageCommands,
  toolCommands,
] as const;
const productionCommandIds = new Set(productionCommandGroups.flat().map(({ id }) => id));

describe('replaceUpstreamCommands', () => {
  it('preserves upstream order while replacing selected commands', () => {
    const replacement = command('edit:paste');
    expect(replaceUpstreamCommands(
      [command('edit:copy'), command('edit:paste')],
      [replacement],
    )).toEqual([expect.objectContaining({ id: 'edit:copy' }), replacement]);
  });

  it('rejects an override whose upstream target disappeared', () => {
    expect(() => replaceUpstreamCommands(
      [command('edit:copy')],
      [command('edit:paste')],
    )).toThrow(/edit:paste/);
  });

  it('rejects duplicate HOP override targets', () => {
    expect(() => replaceUpstreamCommands(
      [command('edit:paste')],
      [command('edit:paste'), command('edit:paste')],
    )).toThrow(/Duplicate/);
  });

  it('rejects duplicate command IDs across contribution groups', () => {
    expect(() => assertUniqueCommandIds([
      [command('file:save')],
      [command('file:save')],
    ])).toThrow(/file:save/);
  });

  it('keeps the production command contribution graph free of duplicate IDs', () => {
    expect(() => assertUniqueCommandIds(productionCommandGroups)).not.toThrow();
  });

  it('registers every command referenced by the studio HTML', () => {
    const missing = Array.from(studioHtml.matchAll(/<[^>]*\bdata-cmd="([^"]+)"[^>]*>/g))
      .map(([, id]) => id)
      .filter((id) => !productionCommandIds.has(id));

    expect([...new Set(missing)]).toEqual([]);
  });

  it('keeps production shortcuts unique and backed by registered commands', () => {
    const shortcutKeys = defaultShortcuts.map(([shortcut]) => [
      shortcut.key.toLowerCase(),
      shortcut.code?.toLowerCase() ?? '',
      shortcut.ctrl ? 'ctrl' : '',
      shortcut.shift ? 'shift' : '',
      shortcut.alt ? 'alt' : '',
      shortcut.platform ?? '',
    ].join(':'));
    const missing = defaultShortcuts
      .map(([, id]) => id)
      .filter((id) => !productionCommandIds.has(id));

    expect(new Set(shortcutKeys).size).toBe(shortcutKeys.length);
    expect([...new Set(missing)]).toEqual([]);
  });
});
