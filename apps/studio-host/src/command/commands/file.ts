import { fileCommands as upstreamFileCommands } from '@/upstream/commands';
import type { CommandDef, CommandServices } from '@/upstream/commands';
import type { DesktopBridgeApi } from '@/core/tauri-bridge';
import { openPrintDialog } from '@/ui/print-dialog';
import { openRecentDocumentsDialog } from '@/ui/recent-documents-dialog';
import { replaceUpstreamCommands } from '../replace-upstream-commands';
import { t } from '../../hop-i18n';

type DesktopFileBridge = Pick<
  DesktopBridgeApi,
  | 'openDocumentFromDialog'
  | 'createNewWindow'
  | 'saveDocumentFromCommand'
  | 'saveDocumentAsFromCommand'
  | 'exportPdfFromCommand'
  | 'printCurrentWebview'
>;

type DesktopRecentBridge = Pick<
  DesktopBridgeApi,
  | 'openDocumentByPath'
  | 'listRecentDocuments'
  | 'clearRecentDocuments'
>;

const upstreamById = new Map(upstreamFileCommands.map((command) => [command.id, command]));
// HOP owns save format choices and PDF export through native paths. Browser-only
// commands must be reviewed explicitly instead of arriving through group merge.
const browserOnlyFileCommands = new Set([
  'file:save-as-hwp',
  'file:save-as-hwpx',
  'file:print-to-pdf',
  'file:export-html',
  'file:export-doc',
]);
const adoptedUpstreamCommands = upstreamFileCommands.filter(
  (command) => !browserOnlyFileCommands.has(command.id),
);

function desktopBridge(wasm: unknown): DesktopFileBridge | null {
  if (!wasm || typeof wasm !== 'object') return null;
  const candidate = wasm as Partial<DesktopFileBridge>;
  return typeof candidate.openDocumentFromDialog === 'function'
    && typeof candidate.createNewWindow === 'function'
    && typeof candidate.saveDocumentFromCommand === 'function'
    && typeof candidate.saveDocumentAsFromCommand === 'function'
    && typeof candidate.exportPdfFromCommand === 'function'
    && typeof candidate.printCurrentWebview === 'function'
    ? candidate as DesktopFileBridge
    : null;
}

function recentBridge(wasm: unknown): DesktopRecentBridge | null {
  if (!wasm || typeof wasm !== 'object') return null;
  const candidate = wasm as Partial<DesktopRecentBridge>;
  return typeof candidate.openDocumentByPath === 'function'
    && typeof candidate.listRecentDocuments === 'function'
    && typeof candidate.clearRecentDocuments === 'function'
    ? candidate as DesktopRecentBridge
    : null;
}

function upstream(id: string): CommandDef {
  const command = upstreamById.get(id);
  if (!command) throw new Error(`Upstream file command is missing: ${id}`);
  return command;
}

function withDesktopOverride(id: string, execute: CommandDef['execute']): CommandDef {
  return {
    ...upstream(id),
    execute,
  };
}

function emitStatus(services: CommandServices, message: string): void {
  services.eventBus.emit('desktop-status', message);
}

function reportCommandError(services: CommandServices, action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  emitStatus(services, t('hop.status.actionFailed', { action, message }));
  alert(t('hop.status.actionFailedAlert', { action, message }));
}

async function runDesktopAction(
  services: CommandServices,
  action: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    reportCommandError(services, action, error);
  }
}

const desktopCommands = new Map<string, CommandDef>([
  ['file:open', withDesktopOverride('file:open', async (services) => {
    const desktop = desktopBridge(services.wasm);
    if (!desktop) return upstream('file:open').execute(services);

    await runDesktopAction(services, t('hop.action.openFile'), async () => {
      const payload = await desktop.openDocumentFromDialog();
      if (payload) services.eventBus.emit('desktop-document-loaded', payload);
    });
  })],
  ['file:open-recent', withDesktopOverride('file:open-recent', async (services) => {
    const desktop = recentBridge(services.wasm);
    if (!desktop) return upstream('file:open-recent').execute(services);

    await runDesktopAction(services, t('command.file.openRecent.registryLabel'), async () => {
      const documents = await desktop.listRecentDocuments();
      if (documents.length === 0) {
        emitStatus(services, t('hop.status.noRecent'));
        alert(t('hop.status.noRecentAlert'));
        return;
      }

      const selected = await openRecentDocumentsDialog(documents, {
        clearRecentDocuments: () => desktop.clearRecentDocuments(),
      });
      if (!selected) {
        emitStatus(services, t('hop.status.recentClosed'));
        return;
      }

      emitStatus(services, t('hop.status.loadingFile'));
      const payload = await desktop.openDocumentByPath(selected.path);
      if (payload) services.eventBus.emit('desktop-document-loaded', payload);
    });
  })],
  ['file:clear-recent', withDesktopOverride('file:clear-recent', async (services) => {
    const desktop = recentBridge(services.wasm);
    if (!desktop) return upstream('file:clear-recent').execute(services);

    await runDesktopAction(services, t('hop.action.clearRecent'), async () => {
      await desktop.clearRecentDocuments();
      emitStatus(services, t('hop.status.recentCleared'));
    });
  })],
  ['file:save', withDesktopOverride('file:save', async (services) => {
    const desktop = desktopBridge(services.wasm);
    if (!desktop) return upstream('file:save').execute(services);

    await runDesktopAction(services, t('command.file.save.label'), async () => {
      emitStatus(services, t('hop.status.saving'));
      const result = await desktop.saveDocumentFromCommand();
      if (result) {
        services.eventBus.emit('desktop-document-saved', result);
        emitStatus(services, t('hop.status.saved'));
      }
    });
  })],
  ['file:save-as', withDesktopOverride('file:save-as', async (services) => {
    const desktop = desktopBridge(services.wasm);
    if (!desktop) return upstream('file:save-as').execute(services);

    await runDesktopAction(services, t('command.file.saveAs.registryLabel'), async () => {
      emitStatus(services, t('hop.status.savingAs'));
      const result = await desktop.saveDocumentAsFromCommand();
      if (result) {
        services.eventBus.emit('desktop-document-saved', result);
        emitStatus(services, t('hop.status.saved'));
      }
    });
  })],
  ['file:print', withDesktopOverride('file:print', async (services) => {
    const statusEl = document.getElementById('sb-message');
    const previousStatus = statusEl?.textContent || '';
    const desktop = desktopBridge(services.wasm);

    try {
      await openPrintDialog(services.wasm, {
        onStatus: (message) => {
          if (statusEl) statusEl.textContent = message;
          emitStatus(services, message);
        },
        print: desktop ? () => desktop.printCurrentWebview() : undefined,
      });
      if (statusEl) statusEl.textContent = previousStatus;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (statusEl) statusEl.textContent = t('hop.status.printFailed', { message });
      alert(t('hop.status.printFailedAlert', { message }));
    }
  })],
]);

const hopOnlyCommands: CommandDef[] = [
  {
    id: 'file:new-window',
    label: t('hop.menu.newWindow'),
    shortcutLabel: 'Ctrl+Shift+N',
    async execute(services) {
      const desktop = desktopBridge(services.wasm);
      if (!desktop) {
        window.open(window.location.href, '_blank');
        return;
      }
      await runDesktopAction(services, t('hop.action.openNewWindow'), () => desktop.createNewWindow());
    },
  },
  {
    id: 'file:export-pdf',
    label: t('hop.menu.exportPdf'),
    canExecute: (ctx) => ctx.hasDocument,
    async execute(services) {
      const desktop = desktopBridge(services.wasm);
      if (!desktop) {
        alert(t('hop.status.pdfDesktopOnly'));
        return;
      }

      await runDesktopAction(services, t('hop.menu.exportPdf'), async () => {
        emitStatus(services, t('hop.status.exportingPdf'));
        const jobId = await desktop.exportPdfFromCommand();
        if (jobId) emitStatus(services, t('hop.status.exportedPdf'));
      });
    },
  },
];

export const fileCommands: CommandDef[] = [
  ...replaceUpstreamCommands(adoptedUpstreamCommands, [...desktopCommands.values()]),
  ...hopOnlyCommands,
];
