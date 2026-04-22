import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TauriBridge } from './tauri-bridge';

const invokeMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
const messageMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openMock,
  save: saveMock,
  message: messageMock,
}));

vi.mock('@/core/wasm-bridge', () => ({
  WasmBridge: class {
    fileName = 'document.hwp';
    loadDocumentMock = vi.fn((_bytes: Uint8Array, fileName: string) => ({
      pageCount: fileName.endsWith('.hwpx') ? 3 : 2,
      fontsUsed: [],
    }));
    createNewDocumentMock = vi.fn(() => ({ pageCount: 1, fontsUsed: [] }));
    exportHwpMock = vi.fn(() => new Uint8Array([1, 2, 3]));

    loadDocument(bytes: Uint8Array, fileName: string) {
      return this.loadDocumentMock(bytes, fileName);
    }

    createNewDocument() {
      return this.createNewDocumentMock();
    }

    exportHwp() {
      return this.exportHwpMock();
    }
  },
}));

describe('TauriBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { document?: { title: string } }).document = { title: '' };
  });

  it('opens a native document by path, mirrors bytes into wasm, and updates title state', async () => {
    const bridge = new TauriBridge();
    invokeMock.mockResolvedValue({
      document: nativeOpenResult({
        docId: 'doc-opened',
        fileName: 'opened.hwp',
        sourcePath: '/tmp/opened.hwp',
        revision: 7,
      }),
      bytes: [10, 20, 30],
    });

    const loaded = await bridge.openDocumentByPath('/tmp/opened.hwp');

    expect(invokeMock).toHaveBeenCalledWith('open_document_with_bytes', { path: '/tmp/opened.hwp' });
    expect(getWasmMock(bridge, 'loadDocumentMock')).toHaveBeenCalledWith(
      new Uint8Array([10, 20, 30]),
      'opened.hwp',
    );
    expect(loaded).toEqual({
      docInfo: { pageCount: 2, fontsUsed: [] },
      message: 'opened.hwp — 2페이지',
    });
    expect(document.title).toBe('opened.hwp - HOP');
    expect(bridge.hasUnsavedChanges()).toBe(false);
  });

  it('cleans up a newly opened native document when wasm loading fails', async () => {
    const bridge = new TauriBridge();
    getWasmMock(bridge, 'loadDocumentMock').mockImplementationOnce(() => {
      throw new Error('bad wasm load');
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'open_document_with_bytes') {
        return {
          document: nativeOpenResult({ docId: 'doc-bad', fileName: 'bad.hwp' }),
          bytes: [1],
        };
      }
      if (command === 'close_document') return undefined;
      throw new Error(`unexpected command ${command}`);
    });

    await expect(bridge.openDocumentByPath('/tmp/bad.hwp')).rejects.toThrow('bad wasm load');

    expect(invokeMock).toHaveBeenCalledWith('close_document', { docId: 'doc-bad' });
  });

  it('closes the replaced native document after opening a new one', async () => {
    const bridge = new TauriBridge();
    invokeMock
      .mockResolvedValueOnce({
        document: nativeOpenResult({ docId: 'old-doc', fileName: 'old.hwp' }),
        bytes: [1],
      })
      .mockResolvedValueOnce({
        document: nativeOpenResult({ docId: 'new-doc', fileName: 'new.hwp' }),
        bytes: [2],
      })
      .mockResolvedValueOnce(undefined);

    await bridge.openDocumentByPath('/tmp/old.hwp');
    await bridge.openDocumentByPath('/tmp/new.hwp');

    expect(invokeMock).toHaveBeenLastCalledWith('close_document', { docId: 'old-doc' });
    expect(document.title).toBe('new.hwp - HOP');
  });

  it('opens a document selected from the Tauri dialog', async () => {
    const bridge = new TauriBridge();
    openMock.mockResolvedValue('/tmp/dialog.hwpx');
    invokeMock.mockResolvedValue({
      document: nativeOpenResult({
        docId: 'dialog-doc',
        fileName: 'dialog.hwpx',
        sourcePath: '/tmp/dialog.hwpx',
        format: 'hwpx',
      }),
      bytes: [4, 5, 6],
    });

    const loaded = await bridge.openDocumentFromDialog();

    expect(openMock).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: 'HWP/HWPX 문서', extensions: ['hwp', 'hwpx'] }],
    });
    expect(loaded?.message).toBe('dialog.hwpx — 3페이지');
  });

  it('creates a new native document and releases it if wasm creation fails', async () => {
    const bridge = new TauriBridge();
    getWasmMock(bridge, 'createNewDocumentMock').mockImplementationOnce(() => {
      throw new Error('new doc failed');
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'create_document') return nativeOpenResult({ docId: 'new-native' });
      if (command === 'close_document') return undefined;
      throw new Error(`unexpected command ${command}`);
    });

    await expect(bridge.createNewDocumentAsync()).rejects.toThrow('new doc failed');

    expect(invokeMock).toHaveBeenCalledWith('close_document', { docId: 'new-native' });
  });

  it('tracks dirty state in the document title and mirrors it natively', async () => {
    const bridge = new TauriBridge();
    invokeMock.mockResolvedValue(undefined);

    applyOpenResult(bridge, {
      docId: 'doc-1',
      fileName: 'source.hwp',
      sourcePath: '/tmp/source.hwp',
      format: 'hwp',
      pageCount: 1,
      revision: 3,
      dirty: false,
      warnings: [],
    });

    expect(document.title).toBe('source.hwp - HOP');
    expect(bridge.hasUnsavedChanges()).toBe(false);

    bridge.markDocumentDirty();
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('mark_document_dirty', { docId: 'doc-1' });
    });

    expect(bridge.hasUnsavedChanges()).toBe(true);
    expect(document.title).toBe('• source.hwp - HOP');
  });

  it('proxies updater commands through the Tauri bridge', async () => {
    const bridge = new TauriBridge();
    invokeMock
      .mockResolvedValueOnce({ status: 'available', version: '0.1.3' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(bridge.getUpdateState()).resolves.toEqual({
      status: 'available',
      version: '0.1.3',
    });
    await expect(bridge.startUpdateInstall()).resolves.toBeUndefined();
    await expect(bridge.restartToApplyUpdate()).resolves.toBeUndefined();
    await expect(bridge.cancelAppQuit()).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'get_update_state', {});
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'start_update_install', {});
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'restart_to_apply_update', {});
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'cancel_app_quit', {});
  });

  it('blocks direct save for HWPX sources', async () => {
    const bridge = new TauriBridge();
    applyOpenResult(bridge, {
      docId: 'doc-1',
      fileName: 'source.hwpx',
      sourcePath: '/tmp/source.hwpx',
      format: 'hwpx',
      pageCount: 1,
      revision: 1,
      dirty: false,
      warnings: [],
    });

    await expect(bridge.saveDocumentFromCommand()).rejects.toThrow('HWPX 원본 저장은 아직 안전하게 지원하지 않습니다');
  });

  it('saves HWP bytes through native state with extension and revision guards', async () => {
    const bridge = new TauriBridge();
    applyOpenResult(bridge, {
      docId: 'doc-1',
      fileName: 'source.hwp',
      sourcePath: '/tmp/source.hwp',
      format: 'hwp',
      pageCount: 1,
      revision: 5,
      dirty: true,
      warnings: [],
    });
    saveMock.mockResolvedValue('/tmp/report');
    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'check_external_modification') {
        expect(args).toEqual({ docId: 'doc-1', targetPath: '/tmp/report.hwp' });
        return { changed: false };
      }
      if (command === 'save_hwp_bytes') {
        expect(args).toEqual({
          docId: 'doc-1',
          bytes: [1, 2, 3],
          targetPath: '/tmp/report.hwp',
          expectedRevision: 5,
          allowExternalOverwrite: false,
        });
        return {
          docId: 'doc-1',
          sourcePath: '/tmp/report.hwp',
          format: 'hwp',
          revision: 6,
          dirty: false,
          warnings: [],
        };
      }
      throw new Error(`unexpected command ${command}`);
    });

    const result = await bridge.saveDocumentAsFromCommand();

    expect(result?.sourcePath).toBe('/tmp/report.hwp');
    expect(result?.revision).toBe(6);
    expect(bridge.hasUnsavedChanges()).toBe(false);
    expect(document.title).toBe('report.hwp - HOP');
  });

  it('returns null when the user cancels an external overwrite warning', async () => {
    const bridge = new TauriBridge();
    applyOpenResult(bridge, {
      docId: 'doc-1',
      fileName: 'source.hwp',
      sourcePath: '/tmp/source.hwp',
      format: 'hwp',
      pageCount: 1,
      revision: 5,
      dirty: true,
      warnings: [],
    });
    invokeMock.mockResolvedValue({
      changed: true,
      sourcePath: '/tmp/source.hwp',
      reason: 'changed',
    });
    messageMock.mockResolvedValue('저장 취소');

    const result = await bridge.saveDocumentFromCommand();

    expect(result).toBeNull();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(messageMock).toHaveBeenCalled();
  });
});

function applyOpenResult(bridge: TauriBridge, result: Record<string, unknown>) {
  (bridge as unknown as { applyNativeOpenResult(result: Record<string, unknown>): void })
    .applyNativeOpenResult(result);
}

function nativeOpenResult(overrides: Record<string, unknown> = {}) {
  return {
    docId: 'doc-1',
    fileName: 'source.hwp',
    sourcePath: '/tmp/source.hwp',
    format: 'hwp',
    pageCount: 1,
    revision: 1,
    dirty: false,
    warnings: [],
    ...overrides,
  };
}

function getWasmMock(bridge: TauriBridge, name: 'loadDocumentMock' | 'createNewDocumentMock' | 'exportHwpMock') {
  return (bridge as unknown as Record<typeof name, ReturnType<typeof vi.fn>>)[name];
}
