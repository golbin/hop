import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileCommands } from './file';

const upstreamOpen = vi.hoisted(() => vi.fn());
const upstreamSave = vi.hoisted(() => vi.fn());
const openPrintDialog = vi.hoisted(() => vi.fn());
const openRecentDocumentsDialog = vi.hoisted(() => vi.fn());

vi.mock('@upstream/command/commands/file', () => ({
  fileCommands: [
    { id: 'file:open', label: 'Open', execute: upstreamOpen },
    { id: 'file:save', label: 'Save', execute: upstreamSave },
    { id: 'file:print', label: 'Print', execute: vi.fn() },
  ],
}));

vi.mock('@/ui/print-dialog', () => ({
  openPrintDialog,
}));

vi.mock('@/ui/recent-documents-dialog', () => ({
  openRecentDocumentsDialog,
}));

describe('file command desktop overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openPrintDialog.mockReset();
    openRecentDocumentsDialog.mockReset();
    (globalThis as { alert?: unknown }).alert = vi.fn();
    (globalThis as { window?: unknown }).window = { location: { href: 'http://localhost/' }, open: vi.fn() };
    (globalThis as { document?: unknown }).document = {
      getElementById: vi.fn(() => ({ textContent: 'ready' })),
    };
  });

  it('falls back to upstream open when no desktop bridge is available', async () => {
    await command('file:open').execute(services({ wasm: {} }) as never);

    expect(upstreamOpen).toHaveBeenCalled();
  });

  it('falls back to upstream save when no desktop bridge is available', async () => {
    await command('file:save').execute(services({ wasm: {} }) as never);

    expect(upstreamSave).toHaveBeenCalled();
  });

  it('emits saved events and status when desktop save succeeds', async () => {
    const result = {
      docId: 'doc-1',
      sourcePath: '/tmp/doc.hwp',
      format: 'hwp',
      revision: 2,
      dirty: false,
      warnings: [],
    };
    const eventBus = { emit: vi.fn() };
    const wasm = desktopBridge({
      saveDocumentFromCommand: vi.fn().mockResolvedValue(result),
    });

    await command('file:save').execute(services({ wasm, eventBus }) as never);

    expect(eventBus.emit).toHaveBeenCalledWith('desktop-status', '저장 중...');
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-document-saved', result);
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-status', '저장 완료');
  });

  it('reports desktop save failures through status and alert', async () => {
    const eventBus = { emit: vi.fn() };
    const wasm = desktopBridge({
      saveDocumentFromCommand: vi.fn().mockRejectedValue(new Error('disk full')),
    });

    await command('file:save').execute(services({ wasm, eventBus }) as never);

    expect(eventBus.emit).toHaveBeenCalledWith('desktop-status', '저장 실패: disk full');
    expect(globalThis.alert).toHaveBeenCalledWith('저장에 실패했습니다:\ndisk full');
  });

  it('uses desktop print integration when available', async () => {
    const probeInput = {
      enginePageCount: 1,
      domPageCount: 1,
      pageWidthMm: 210,
      pageHeightMm: 297,
      finalBreakIsAuto: true,
    };
    const printCurrentWebview = vi.fn().mockResolvedValue(undefined);
    const wasm = desktopBridge({
      printCurrentWebview,
    });
    openPrintDialog.mockImplementation(async (_document, options) => {
      await options.print(probeInput);
    });

    await command('file:print').execute(services({ wasm }) as never);

    expect(openPrintDialog).toHaveBeenCalledWith(
      wasm,
      expect.objectContaining({ print: expect.any(Function) }),
    );
    expect(printCurrentWebview).toHaveBeenCalledWith(probeInput);
  });

  it('keeps PDF export desktop-only', async () => {
    await command('file:export-pdf').execute(services({ wasm: {} }) as never);

    expect(globalThis.alert).toHaveBeenCalledWith('PDF 내보내기는 HOP 데스크톱 앱에서 지원합니다.');
  });

  it('does not expose a PDF export shortcut label', () => {
    expect(command('file:export-pdf').shortcutLabel).toBeUndefined();
  });

  it('opens a selected recent document through the desktop bridge', async () => {
    const loaded = { docInfo: { pageCount: 1 }, message: 'loaded' };
    const recent = { path: '/tmp/recent.hwp', fileName: 'recent.hwp' };
    const eventBus = { emit: vi.fn() };
    const wasm = {
      openDocumentByPath: vi.fn().mockResolvedValue(loaded),
      listRecentDocuments: vi.fn().mockResolvedValue([recent]),
      clearRecentDocuments: vi.fn(),
    };
    openRecentDocumentsDialog.mockResolvedValue(recent);

    await command('file:open-recent').execute(services({ wasm, eventBus }) as never);

    expect(openRecentDocumentsDialog).toHaveBeenCalledWith(
      [recent],
      expect.objectContaining({ clearRecentDocuments: expect.any(Function) }),
    );
    expect(wasm.openDocumentByPath).toHaveBeenCalledWith('/tmp/recent.hwp');
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-document-loaded', loaded);
  });

  it('reports an empty recent document list without opening the dialog', async () => {
    const eventBus = { emit: vi.fn() };
    const wasm = {
      openDocumentByPath: vi.fn(),
      listRecentDocuments: vi.fn().mockResolvedValue([]),
      clearRecentDocuments: vi.fn(),
    };

    await command('file:open-recent').execute(services({ wasm, eventBus }) as never);

    expect(openRecentDocumentsDialog).not.toHaveBeenCalled();
    expect(wasm.openDocumentByPath).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-status', '최근 문서가 없습니다');
  });
});

function command(id: string) {
  const found = fileCommands.find((item) => item.id === id);
  if (!found) throw new Error(`missing command ${id}`);
  return found;
}

function services({
  wasm,
  eventBus = { emit: vi.fn() },
}: {
  wasm: unknown;
  eventBus?: { emit: ReturnType<typeof vi.fn> };
}) {
  return { wasm, eventBus };
}

function desktopBridge(overrides: Record<string, unknown>) {
  return {
    openDocumentFromDialog: vi.fn(),
    createNewWindow: vi.fn(),
    saveDocumentFromCommand: vi.fn(),
    saveDocumentAsFromCommand: vi.fn(),
    exportPdfFromCommand: vi.fn(),
    printCurrentWebview: vi.fn(),
    ...overrides,
  };
}
