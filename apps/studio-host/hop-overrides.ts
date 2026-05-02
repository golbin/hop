import { resolve } from 'node:path';

const overrideIds = [
  'core/font-loader',
  'core/font-application',
  'core/font-authoring-policy',
  'core/local-fonts',
  'core/bridge-factory',
  'core/document-files',
  'core/desktop-chrome',
  'core/desktop-events',
  'core/platform',
  'core/tauri-bridge',
  'command/shortcut-map',
  'command/commands/edit',
  'command/commands/format',
  'command/commands/table',
  'command/commands/file',
  'engine/cell-selection-renderer',
  'engine/input-handler',
  'engine/input-handler-keyboard',
  'engine/table-object-renderer',
  'engine/table-resize-renderer',
  'ui/about-dialog',
  'ui/custom-select',
  'ui/dialog',
  'ui/print-dialog',
  'ui/style-edit-dialog',
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
