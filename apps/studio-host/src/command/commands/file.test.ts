import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileCommands } from './file';

const upstreamOpen = vi.hoisted(() => vi.fn());
const upstreamOpenRecent = vi.hoisted(() => vi.fn());
const upstreamSave = vi.hoisted(() => vi.fn());
const upstreamSaveAs = vi.hoisted(() => vi.fn());
const upstreamSaveAsCanExecute = vi.hoisted(() => vi.fn(() => true));
const openPrintDialog = vi.hoisted(() => vi.fn());
const openRecentDocumentsDialog = vi.hoisted(() => vi.fn());

vi.mock('@/upstream/commands', () => ({
  fileCommands: [
    { id: 'file:open', label: 'Open', execute: upstreamOpen },
    { id: 'file:open-recent', label: 'Open recent', execute: upstreamOpenRecent },
    { id: 'file:save', label: 'Save', execute: upstreamSave },
    {
      id: 'file:save-as',
      label: 'Save as',
      shortcutLabel: 'Ctrl+Shift+S',
      canExecute: upstreamSaveAsCanExecute,
      execute: upstreamSaveAs,
    },
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

  it('preserves upstream recent and save-as behavior outside the desktop bridge', async () => {
    await command('file:open-recent').execute(services({ wasm: {} }) as never);
    await command('file:save-as').execute(services({ wasm: {} }) as never);

    expect(upstreamOpenRecent).toHaveBeenCalled();
    expect(upstreamSaveAs).toHaveBeenCalled();
  });

  it('preserves upstream command metadata when replacing desktop behavior', () => {
    const saveAs = command('file:save-as');

    expect(saveAs).toMatchObject({
      label: 'Save as',
      shortcutLabel: 'Ctrl+Shift+S',
      canExecute: upstreamSaveAsCanExecute,
    });
  });

  it('reports desktop open failures instead of leaking an unhandled rejection', async () => {
    const eventBus = { emit: vi.fn() };
    const wasm = desktopBridge({
      openDocumentFromDialog: vi.fn().mockRejectedValue(new Error('open failed')),
    });

    await command('file:open').execute(services({ wasm, eventBus }) as never);

    expect(eventBus.emit).toHaveBeenCalledWith('desktop-status', '파일 열기 실패: open failed');
    expect(globalThis.alert).toHaveBeenCalledWith('파일 열기에 실패했습니다:\nopen failed');
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

  it('routes save-as through the dedicated desktop operation', async () => {
    const result = {
      docId: 'doc-1',
      sourcePath: '/tmp/copy.hwp',
      format: 'hwp',
      revision: 3,
      dirty: false,
      warnings: [],
    };
    const eventBus = { emit: vi.fn() };
    const saveDocumentFromCommand = vi.fn();
    const saveDocumentAsFromCommand = vi.fn().mockResolvedValue(result);
    const wasm = desktopBridge({ saveDocumentFromCommand, saveDocumentAsFromCommand });

    await command('file:save-as').execute(services({ wasm, eventBus }) as never);

    expect(saveDocumentFromCommand).not.toHaveBeenCalled();
    expect(saveDocumentAsFromCommand).toHaveBeenCalledOnce();
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-document-saved', result);
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-status', '저장 완료');
  });

  it('uses desktop print integration when available', async () => {
    const wasm = desktopBridge({
      printCurrentWebview: vi.fn().mockResolvedValue(undefined),
    });
    openPrintDialog.mockResolvedValue(undefined);

    await command('file:print').execute(services({ wasm }) as never);

    expect(openPrintDialog).toHaveBeenCalledWith(
      wasm,
      expect.objectContaining({ print: expect.any(Function) }),
    );
  });

  it('exports PDF via the browser print pipeline in web (no desktop bridge)', async () => {
    openPrintDialog.mockResolvedValue(undefined);
    const eventBus = { emit: vi.fn() };
    const wasm = {};

    await command('file:export-pdf').execute(services({ wasm, eventBus }) as never);

    expect(openPrintDialog).toHaveBeenCalledWith(
      wasm,
      expect.objectContaining({ onStatus: expect.any(Function) }),
    );
    expect(globalThis.alert).not.toHaveBeenCalled();
  });

  it('reports desktop PDF export failures', async () => {
    const eventBus = { emit: vi.fn() };
    const wasm = desktopBridge({
      exportPdfFromCommand: vi.fn().mockRejectedValue(new Error('render failed')),
    });

    await command('file:export-pdf').execute(services({ wasm, eventBus }) as never);

    expect(eventBus.emit).toHaveBeenCalledWith('desktop-status', 'PDF 내보내기 실패: render failed');
    expect(globalThis.alert).toHaveBeenCalledWith('PDF 내보내기에 실패했습니다:\nrender failed');
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
