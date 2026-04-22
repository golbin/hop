import { resolve } from 'node:path';

const overrideIds = [
  'core/font-loader',
  'core/bridge-factory',
  'core/document-files',
  'core/desktop-events',
  'core/tauri-bridge',
  'command/shortcut-map',
  'command/commands/file',
  'engine/cell-selection-renderer',
  'engine/input-handler',
  'engine/table-object-renderer',
  'engine/table-resize-renderer',
  'ui/about-dialog',
  'ui/custom-select',
  'ui/dialog',
  'ui/print-dialog',
  'ui/toolbar',
  'ui/update-notice',
  'view/canvas-view',
  'view/ruler',
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
