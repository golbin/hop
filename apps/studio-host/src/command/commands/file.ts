import { fileCommands as upstreamFileCommands } from '@/upstream/commands';
import type { CommandDef, CommandServices } from '@/upstream/commands';
import type { DesktopBridgeApi } from '@/core/tauri-bridge';
import { openPrintDialog } from '@/ui/print-dialog';
import { openRecentDocumentsDialog } from '@/ui/recent-documents-dialog';
import { replaceUpstreamCommands } from '../replace-upstream-commands';
import {
  exportDocument,
  exportFormatLabel,
  type DocumentExportEngine,
  type ExportFormat,
} from '../export-formats';

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
  emitStatus(services, `${action} 실패: ${message}`);
  alert(`${action}에 실패했습니다:\n${message}`);
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

    await runDesktopAction(services, '파일 열기', async () => {
      const payload = await desktop.openDocumentFromDialog();
      if (payload) services.eventBus.emit('desktop-document-loaded', payload);
    });
  })],
  ['file:open-recent', withDesktopOverride('file:open-recent', async (services) => {
    const desktop = recentBridge(services.wasm);
    if (!desktop) return upstream('file:open-recent').execute(services);

    await runDesktopAction(services, '최근 문서 열기', async () => {
      const documents = await desktop.listRecentDocuments();
      if (documents.length === 0) {
        emitStatus(services, '최근 문서가 없습니다');
        alert('최근 문서가 없습니다.');
        return;
      }

      const selected = await openRecentDocumentsDialog(documents, {
        clearRecentDocuments: () => desktop.clearRecentDocuments(),
      });
      if (!selected) {
        emitStatus(services, '최근 문서 목록을 닫았습니다');
        return;
      }

      emitStatus(services, '파일 로딩 중...');
      const payload = await desktop.openDocumentByPath(selected.path);
      if (payload) services.eventBus.emit('desktop-document-loaded', payload);
    });
  })],
  ['file:save', withDesktopOverride('file:save', async (services) => {
    const desktop = desktopBridge(services.wasm);
    if (!desktop) return upstream('file:save').execute(services);

    await runDesktopAction(services, '저장', async () => {
      emitStatus(services, '저장 중...');
      const result = await desktop.saveDocumentFromCommand();
      if (result) {
        services.eventBus.emit('desktop-document-saved', result);
        emitStatus(services, '저장 완료');
      }
    });
  })],
  ['file:save-as', withDesktopOverride('file:save-as', async (services) => {
    const desktop = desktopBridge(services.wasm);
    if (!desktop) return upstream('file:save-as').execute(services);

    await runDesktopAction(services, '다른 이름으로 저장', async () => {
      emitStatus(services, '다른 이름으로 저장 중...');
      const result = await desktop.saveDocumentAsFromCommand();
      if (result) {
        services.eventBus.emit('desktop-document-saved', result);
        emitStatus(services, '저장 완료');
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
      if (statusEl) statusEl.textContent = `인쇄 실패: ${message}`;
      alert(`인쇄에 실패했습니다:\n${message}`);
    }
  })],
]);

function runFormatExport(services: CommandServices, format: ExportFormat): void {
  const engine = services.wasm as unknown as DocumentExportEngine;
  const label = exportFormatLabel(format);
  try {
    emitStatus(services, `${label} 내보내기 중...`);
    exportDocument(engine, format);
    emitStatus(services, `${label} 내보내기 완료`);
  } catch (error) {
    reportCommandError(services, `${label} 내보내기`, error);
  }
}

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
      await runDesktopAction(services, '새 창 열기', () => desktop.createNewWindow());
    },
  },
  {
    id: 'file:export-pdf',
    label: 'PDF 내보내기',
    canExecute: (ctx) => ctx.hasDocument,
    async execute(services) {
      const desktop = desktopBridge(services.wasm);
      if (!desktop) {
        // 웹: rhwp 엔진에는 PDF 출력이 없다. 브라우저 인쇄 파이프라인으로 내보내며,
        // 인쇄 대화상자에서 "PDF로 저장"을 선택하면 폰트가 임베드된 벡터 PDF가 만들어진다.
        try {
          emitStatus(services, 'PDF 내보내기 준비 중... (대화상자에서 "PDF로 저장"을 선택하세요)');
          await openPrintDialog(services.wasm, {
            onStatus: (message) => emitStatus(services, message),
          });
        } catch (error) {
          reportCommandError(services, 'PDF 내보내기', error);
        }
        return;
      }

      await runDesktopAction(services, 'PDF 내보내기', async () => {
        emitStatus(services, 'PDF 내보내기 중...');
        const jobId = await desktop.exportPdfFromCommand();
        if (jobId) emitStatus(services, 'PDF 내보내기 완료');
      });
    },
  },
  {
    id: 'file:export-hwpx',
    label: 'HWPX로 내보내기',
    canExecute: (ctx) => ctx.hasDocument,
    async execute(services) {
      runFormatExport(services, 'hwpx');
    },
  },
  {
    id: 'file:export-hml',
    label: 'HML로 내보내기',
    canExecute: (ctx) => ctx.hasDocument,
    async execute(services) {
      runFormatExport(services, 'hml');
    },
  },
  {
    id: 'file:export-html',
    label: 'HTML로 내보내기',
    canExecute: (ctx) => ctx.hasDocument,
    async execute(services) {
      runFormatExport(services, 'html');
    },
  },
  {
    id: 'file:export-doc',
    label: 'Word 문서(.doc)로 내보내기',
    canExecute: (ctx) => ctx.hasDocument,
    async execute(services) {
      runFormatExport(services, 'doc');
    },
  },
];

export const fileCommands: CommandDef[] = [
  ...replaceUpstreamCommands(upstreamFileCommands, [...desktopCommands.values()]),
  ...hopOnlyCommands,
];
