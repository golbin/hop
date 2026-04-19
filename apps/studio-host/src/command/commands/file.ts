import { fileCommands as upstreamFileCommands } from '@upstream/command/commands/file';
import type { CommandDef, CommandServices } from '@/command/types';
import type { DesktopBridgeApi } from '@/core/tauri-bridge';
import { openPrintDialog } from '@/ui/print-dialog';

type DesktopFileBridge = Pick<
  DesktopBridgeApi,
  | 'openDocumentFromDialog'
  | 'createNewWindow'
  | 'saveDocumentFromCommand'
  | 'saveDocumentAsFromCommand'
  | 'exportPdfFromCommand'
  | 'printCurrentWebview'
>;

const upstreamById = new Map(upstreamFileCommands.map((command) => [command.id, command]));

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
  emitStatus(services, `${action} 실패: ${message}`);
  alert(`${action}에 실패했습니다:\n${message}`);
}

const desktopCommands = new Map<string, CommandDef>([
  ['file:open', withDesktopOverride('file:open', async (services) => {
    const desktop = desktopBridge(services.wasm);
    if (!desktop) return upstream('file:open').execute(services);

    const payload = await desktop.openDocumentFromDialog();
    if (payload) services.eventBus.emit('desktop-document-loaded', payload);
  })],
  ['file:save', withDesktopOverride('file:save', async (services) => {
    const desktop = desktopBridge(services.wasm);
    if (!desktop) return upstream('file:save').execute(services);

    try {
      emitStatus(services, '저장 중...');
      const result = await desktop.saveDocumentFromCommand();
      if (result) {
        services.eventBus.emit('desktop-document-saved', result);
        emitStatus(services, '저장 완료');
      }
    } catch (error) {
      reportCommandError(services, '저장', error);
    }
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
      if (statusEl) statusEl.textContent = `인쇄 실패: ${message}`;
      alert(`인쇄에 실패했습니다:\n${message}`);
    }
  })],
]);

const hopOnlyCommands: CommandDef[] = [
  {
    id: 'file:new-window',
    label: '새 창',
    shortcutLabel: 'Ctrl+Shift+N',
    async execute(services) {
      const desktop = desktopBridge(services.wasm);
      if (!desktop) {
        window.open(window.location.href, '_blank');
        return;
      }
      await desktop.createNewWindow();
    },
  },
  {
    id: 'file:save-as',
    label: '다른 이름으로 저장',
    canExecute: (ctx) => ctx.hasDocument,
    async execute(services) {
      const desktop = desktopBridge(services.wasm);
      if (!desktop) return upstream('file:save').execute(services);

      try {
        emitStatus(services, '다른 이름으로 저장 중...');
        const result = await desktop.saveDocumentAsFromCommand();
        if (result) {
          services.eventBus.emit('desktop-document-saved', result);
          emitStatus(services, '저장 완료');
        }
      } catch (error) {
        reportCommandError(services, '다른 이름으로 저장', error);
      }
    },
  },
  {
    id: 'file:export-pdf',
    label: 'PDF 내보내기',
    canExecute: (ctx) => ctx.hasDocument,
    async execute(services) {
      const desktop = desktopBridge(services.wasm);
      if (!desktop) {
        alert('PDF 내보내기는 HOP 데스크톱 앱에서 지원합니다.');
        return;
      }

      emitStatus(services, 'PDF 내보내기 중...');
      const jobId = await desktop.exportPdfFromCommand();
      if (jobId) emitStatus(services, 'PDF 내보내기 완료');
    },
  },
];

export const fileCommands: CommandDef[] = [
  ...upstreamFileCommands.map((command) => desktopCommands.get(command.id) ?? command),
  ...hopOnlyCommands,
];
