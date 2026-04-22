import { resolve } from 'node:path';

const overrideIds = [
  'core/font-loader',
  'core/bridge-factory',
  'core/document-files',
  'core/desktop-chrome',
  'core/desktop-events',
  'core/platform',
  'core/tauri-bridge',
  'command/shortcut-map',
  'command/commands/file',
  'ui/about-dialog',
  'ui/custom-select',
  'ui/dialog',
  'ui/print-dialog',
  'ui/toolbar',
  'ui/update-notice',
  'styles/about-dialog.css',
  'styles/custom-select.css',
  'styles/font-set-dialog.css',
  'styles/update-notice.css',
] as const;

export function createHopOverrides(hopSrc: string) {
  return overrideIds.map((id) => ({
    find: `@/${id}`,
    replacement: resolve(hopSrc, id),
  }));
}
