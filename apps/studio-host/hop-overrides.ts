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
  'command/commands/file',
  'ui/about-dialog',
  'ui/custom-select',
  'ui/dialog',
  'ui/home-screen',
  'ui/preview-svg',
  'ui/print-dialog',
  'ui/recent-documents-dialog',
  'ui/style-edit-dialog',
  'ui/toolbar',
  'ui/update-notice',
  'ui/validation-modal',
  'view/canvas-view',
  'view/ruler',
  'styles/about-dialog.css',
  'styles/custom-select.css',
  'styles/font-set-dialog.css',
  'styles/home-screen.css',
  'styles/update-notice.css',
  'styles/recent-documents-dialog.css',
] as const;

export function createHopOverrides(hopSrc: string) {
  return overrideIds.map((id) => ({
    find: `@/${id}`,
    replacement: resolve(hopSrc, id),
  }));
}
