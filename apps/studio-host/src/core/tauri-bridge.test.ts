import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashBytes } from './chunked-fs';
import { TauriBridge } from './tauri-bridge';

const invokeMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
const messageMock = vi.hoisted(() => vi.fn());
const fsOpenMock = vi.hoisted(() => vi.fn());
const statMock = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openMock,
  save: saveMock,
  message: messageMock,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  open: fsOpenMock,
  stat: statMock,
  remove: removeMock,
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
    sourceFormat = 'hwp';

    loadDocument(bytes: Uint8Array, fileName: string) {
      this.sourceFormat = fileName.endsWith('.hwpx') || bytes[0] === 0x50 ? 'hwpx' : 'hwp';
      return this.loadDocumentMock(bytes, fileName);
    }

    createNewDocument() {
      return this.createNewDocumentMock();
    }

    exportHwp() {
      return this.exportHwpMock();
    }

    getSourceFormat() {
      return this.sourceFormat;
    }
  },
}));

describe('TauriBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { document?: { title: string } }).document = { title: '' };
    statMock.mockResolvedValue({ size: 3, isFile: true, mtime: new Date('2026-04-23T00:00:00.000Z') });
    removeMock.mockResolvedValue(undefined);
  });

  it('forwards sanitized print probe inputs and queries probe configuration', async () => {
    const bridge = new TauriBridge();
    const probeInput = {
      enginePageCount: 1,
      domPageCount: 1,
      pageWidthMm: 210,
      pageHeightMm: 297,
      finalBreakIsAuto: true,
    };
    invokeMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce(true);

    await bridge.printCurrentWebview(probeInput);
    const configured = await bridge.printGeometryProbeConfigured();

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'print_webview', { probeInput });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'print_geometry_probe_configured', {});
    expect(configured).toBe(true);
  });

  it('opens a native document by path, mirrors bytes into wasm, and updates title state', async () => {
    const bridge = new TauriBridge();
    fsOpenMock.mockResolvedValue(readHandle([10, 20, 30]));
    invokeMock.mockResolvedValue(nativeOpenResult({
      docId: 'doc-opened',
      fileName: 'opened.hwp',
      sourcePath: '/tmp/opened.hwp',
      revision: 7,
    }));

    const loaded = await bridge.openDocumentByPath('/tmp/opened.hwp');

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'prepare_document_open', {
      path: '/tmp/opened.hwp',
    });
    expect(fsOpenMock).toHaveBeenCalledWith('/tmp/opened.hwp', { read: true });
    expect(invokeMock).toHaveBeenCalledWith('open_document_tracking', {
      path: '/tmp/opened.hwp',
      sourceFingerprint: {
        len: 3,
        modifiedMillis: new Date('2026-04-23T00:00:00.000Z').getTime(),
        contentHash: hashBytes(new Uint8Array([10, 20, 30])),
      },
    });
    expect(invokeMock).toHaveBeenCalledWith('note_finder_recent_document', {
      path: '/tmp/opened.hwp',
    });
    expect(invokeMock).toHaveBeenCalledWith('record_recent_document', {
      path: '/tmp/opened.hwp',
    });
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

  it('reads large documents in multiple fs chunks before handing them to wasm', async () => {
    const bridge = new TauriBridge();
    const bytes = new Uint8Array(4 * 1024 * 1024 + 3);
    bytes[0] = 1;
    bytes[bytes.length - 1] = 9;
    statMock.mockResolvedValue({ size: bytes.length, isFile: true });
    fsOpenMock.mockResolvedValue(readHandle(bytes));
    invokeMock.mockResolvedValue(nativeOpenResult({
      docId: 'doc-large',
      fileName: 'large.hwp',
      sourcePath: '/tmp/large.hwp',
    }));

    await bridge.openDocumentByPath('/tmp/large.hwp');

    const [loadedBytes, loadedName] = getWasmMock(bridge, 'loadDocumentMock').mock.calls[0]!;
    expect(loadedName).toBe('large.hwp');
    expect(loadedBytes.byteLength).toBe(bytes.byteLength);
    expect(loadedBytes[0]).toBe(1);
    expect(loadedBytes[loadedBytes.byteLength - 1]).toBe(9);
  });

  it('rejects open when the file changes while being read', async () => {
    const bridge = new TauriBridge();
    statMock
      .mockResolvedValueOnce({ size: 3, isFile: true, mtime: new Date('2026-04-23T00:00:00.000Z') })
      .mockResolvedValueOnce({ size: 4, isFile: true, mtime: new Date('2026-04-23T00:00:01.000Z') });
    fsOpenMock.mockResolvedValue(readHandle([1, 2, 3]));

    await expect(bridge.openDocumentByPath('/tmp/changing.hwp')).rejects.toThrow(
      '파일을 읽는 중 변경되었습니다. 다시 시도하세요.',
    );

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('prepare_document_open', { path: '/tmp/changing.hwp' });
    expect(invokeMock).not.toHaveBeenCalledWith('open_document_tracking', expect.anything());
  });

  it('cleans up a newly opened native document when wasm loading fails', async () => {
    const bridge = new TauriBridge();
    getWasmMock(bridge, 'loadDocumentMock').mockImplementationOnce(() => {
      throw new Error('bad wasm load');
    });
    fsOpenMock.mockResolvedValue(readHandle([1]));
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'prepare_document_open') return undefined;
      if (command === 'open_document_tracking') return nativeOpenResult({ docId: 'doc-bad', fileName: 'bad.hwp' });
      if (command === 'close_document') return undefined;
      throw new Error(`unexpected command ${command}`);
    });

    await expect(bridge.openDocumentByPath('/tmp/bad.hwp')).rejects.toThrow('bad wasm load');

    expect(invokeMock).toHaveBeenCalledWith('close_document', { docId: 'doc-bad' });
  });

  it('closes the replaced native document after opening a new one', async () => {
    const bridge = new TauriBridge();
    fsOpenMock
      .mockResolvedValueOnce(readHandle([1]))
      .mockResolvedValueOnce(readHandle([2]));
    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'prepare_document_open') return undefined;
      if (command === 'note_finder_recent_document') return undefined;
      if (command === 'record_recent_document') return undefined;
      if (command === 'close_document') return undefined;
      if (command === 'open_document_tracking') {
        return args.path === '/tmp/old.hwp'
          ? nativeOpenResult({ docId: 'old-doc', fileName: 'old.hwp' })
          : nativeOpenResult({ docId: 'new-doc', fileName: 'new.hwp' });
      }
      throw new Error(`unexpected command ${command}`);
    });

    await bridge.openDocumentByPath('/tmp/old.hwp');
    await bridge.openDocumentByPath('/tmp/new.hwp');

    expect(invokeMock).toHaveBeenLastCalledWith('close_document', { docId: 'old-doc' });
    expect(document.title).toBe('new.hwp - HOP');
  });

  it('opens a document selected from the Tauri dialog', async () => {
    const bridge = new TauriBridge();
    openMock.mockResolvedValue('/tmp/dialog.hwpx');
    fsOpenMock.mockResolvedValue(readHandle([4, 5, 6]));
    invokeMock.mockResolvedValue(nativeOpenResult({
      docId: 'dialog-doc',
      fileName: 'dialog.hwpx',
      sourcePath: '/tmp/dialog.hwpx',
      format: 'hwpx',
    }));

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

  it('resets source format to hwp after creating a native blank document', async () => {
    const bridge = new TauriBridge();
    fsOpenMock.mockResolvedValue(readHandle([4, 5, 6]));
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'prepare_document_open') return undefined;
      if (command === 'open_document_tracking') {
        return nativeOpenResult({
          docId: 'opened-hwpx',
          fileName: 'opened.hwpx',
          sourcePath: '/tmp/opened.hwpx',
          format: 'hwpx',
        });
      }
      if (command === 'create_document') {
        return nativeOpenResult({
          docId: 'new-hwp',
          fileName: '새 문서.hwp',
          sourcePath: null,
          format: 'hwp',
        });
      }
      if (command === 'note_finder_recent_document') return undefined;
      if (command === 'record_recent_document') return undefined;
      if (command === 'close_document') return undefined;
      throw new Error(`unexpected command ${command}`);
    });

    await bridge.openDocumentByPath('/tmp/opened.hwpx');

    expect(bridge.getSourceFormat()).toBe('hwpx');

    await bridge.createNewDocumentAsync();

    expect(bridge.getSourceFormat()).toBe('hwp');
  });

  it('uses wasm-detected source format for opened bytes when the native extension is misleading', async () => {
    const bridge = new TauriBridge();
    fsOpenMock.mockResolvedValue(readHandle([0x50, 0x4b, 0x03, 0x04]));
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'prepare_document_open') return undefined;
      if (command === 'open_document_tracking') {
        return nativeOpenResult({
          docId: 'misnamed-hwpx',
          fileName: 'misnamed.hwp',
          sourcePath: '/tmp/misnamed.hwp',
          format: 'hwp',
        });
      }
      if (command === 'note_finder_recent_document') return undefined;
      if (command === 'record_recent_document') return undefined;
      throw new Error(`unexpected command ${command}`);
    });

    await bridge.openDocumentByPath('/tmp/misnamed.hwp');

    expect(bridge.getSourceFormat()).toBe('hwpx');
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

  it('proxies recent document commands through the Tauri bridge', async () => {
    const bridge = new TauriBridge();
    const documents = [{ path: '/tmp/recent.hwp', fileName: 'recent.hwp' }];
    invokeMock
      .mockResolvedValueOnce(documents)
      .mockResolvedValueOnce(undefined);

    await expect(bridge.listRecentDocuments()).resolves.toEqual(documents);
    await expect(bridge.clearRecentDocuments()).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_recent_documents', {});
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'clear_recent_documents', {});
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
    const handle = writeHandle();
    fsOpenMock.mockResolvedValue(handle);
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
      if (command === 'prepare_staged_hwp_save') {
        expect(args).toEqual({ targetPath: '/tmp/report.hwp' });
        return '/tmp/report.hwp.hop-save-1234abcd.tmp';
      }
      if (command === 'check_external_modification') {
        expect(args).toEqual({ docId: 'doc-1', targetPath: '/tmp/report.hwp' });
        return { changed: false };
      }
      if (command === 'commit_staged_hwp_save') {
        expect(args).toEqual({
          docId: 'doc-1',
          stagedPath: '/tmp/report.hwp.hop-save-1234abcd.tmp',
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
      if (command === 'note_finder_recent_document') return undefined;
      throw new Error(`unexpected command ${command}`);
    });

    const result = await bridge.saveDocumentAsFromCommand();

    expect(fsOpenMock).toHaveBeenCalledWith('/tmp/report.hwp.hop-save-1234abcd.tmp', {
      write: true,
      create: true,
      truncate: true,
    });
    expect(handle.write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(handle.close).toHaveBeenCalled();
    const commitCallIndex = invokeMock.mock.calls.findIndex(([command]) => command === 'commit_staged_hwp_save');
    expect(commitCallIndex).toBeGreaterThan(-1);
    expect(handle.close.mock.invocationCallOrder[0]).toBeLessThan(
      invokeMock.mock.invocationCallOrder[commitCallIndex]!,
    );
    expect(statMock).toHaveBeenCalledWith('/tmp/report.hwp.hop-save-1234abcd.tmp');
    expect(removeMock).toHaveBeenCalledWith('/tmp/report.hwp.hop-save-1234abcd.tmp');
    expect(invokeMock).toHaveBeenCalledWith('note_finder_recent_document', {
      path: '/tmp/report.hwp',
    });
    expect(result?.sourcePath).toBe('/tmp/report.hwp');
    expect(result?.revision).toBe(6);
    expect(bridge.hasUnsavedChanges()).toBe(false);
    expect(document.title).toBe('report.hwp - HOP');
  });

  it('writes large staged saves in multiple fs chunks', async () => {
    const bridge = new TauriBridge();
    const handle = writeHandle();
    const bytes = new Uint8Array(4 * 1024 * 1024 + 5);
    bytes[0] = 1;
    bytes[bytes.length - 1] = 9;
    fsOpenMock.mockResolvedValue(handle);
    statMock.mockResolvedValue({ size: bytes.length, isFile: true });
    getWasmMock(bridge, 'exportHwpMock').mockReturnValue(bytes);
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
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'check_external_modification') return { changed: false };
      if (command === 'prepare_staged_hwp_save') return '/tmp/source.hwp.hop-save-large.tmp';
      if (command === 'commit_staged_hwp_save') {
        return {
          docId: 'doc-1',
          sourcePath: '/tmp/source.hwp',
          format: 'hwp',
          revision: 6,
          dirty: false,
          warnings: [],
        };
      }
      if (command === 'note_finder_recent_document') return undefined;
      throw new Error(`unexpected command ${command}`);
    });

    await bridge.saveDocumentFromCommand();

    expect(handle.write).toHaveBeenCalledTimes(2);
    const writes = handle.write.mock.calls as unknown as Array<[Uint8Array]>;
    expect(writes[0]?.[0].byteLength).toBe(4 * 1024 * 1024);
    expect(writes[0]?.[0][0]).toBe(1);
    expect(writes[1]?.[0].byteLength).toBe(5);
    expect(writes[1]?.[0][4]).toBe(9);
  });

  it('rejects staged saves before native commit when the written file size is incomplete', async () => {
    const bridge = new TauriBridge();
    const handle = writeHandle();
    fsOpenMock.mockResolvedValue(handle);
    statMock.mockResolvedValue({ size: 2, isFile: true });
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
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'check_external_modification') return { changed: false };
      if (command === 'prepare_staged_hwp_save') return '/tmp/source.hwp.hop-save-short.tmp';
      if (command === 'commit_staged_hwp_save') throw new Error('commit should not run');
      throw new Error(`unexpected command ${command}`);
    });

    await expect(bridge.saveDocumentFromCommand()).rejects.toThrow('staging 파일 크기 검증 실패');

    expect(handle.close).toHaveBeenCalled();
    expect(invokeMock.mock.calls.some(([command]) => command === 'commit_staged_hwp_save')).toBe(false);
    expect(removeMock).toHaveBeenCalledWith('/tmp/source.hwp.hop-save-short.tmp');
  });

  it('exports PDF through a staged hwp file instead of byte IPC', async () => {
    const bridge = new TauriBridge();
    const handle = writeHandle();
    fsOpenMock.mockResolvedValue(handle);
    saveMock.mockResolvedValue('/tmp/report');
    applyOpenResult(bridge, {
      docId: 'doc-1',
      fileName: 'source.hwp',
      sourcePath: '/tmp/source.hwp',
      format: 'hwp',
      pageCount: 1,
      revision: 5,
      dirty: false,
      warnings: [],
    });
    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'prepare_staged_hwp_pdf_export') {
        expect(args).toEqual({ targetPath: '/tmp/report.pdf' });
        return '/tmp/report.pdf.hop-export-abcd1234.hwp';
      }
      if (command === 'export_pdf_from_hwp_path') {
        expect(args).toEqual({
          stagedPath: '/tmp/report.pdf.hop-export-abcd1234.hwp',
          targetPath: '/tmp/report.pdf',
          pageRange: null,
          openAfter: true,
        });
        return 'job-1';
      }
      throw new Error(`unexpected command ${command}`);
    });

    const result = await bridge.exportPdfFromCommand();

    expect(result).toBe('job-1');
    expect(fsOpenMock).toHaveBeenCalledWith('/tmp/report.pdf.hop-export-abcd1234.hwp', {
      write: true,
      create: true,
      truncate: true,
    });
    expect(handle.write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(removeMock).toHaveBeenCalledWith('/tmp/report.pdf.hop-export-abcd1234.hwp');
  });

  it('removes the staged export file when PDF export fails', async () => {
    const bridge = new TauriBridge();
    const handle = writeHandle();
    fsOpenMock.mockResolvedValue(handle);
    saveMock.mockResolvedValue('/tmp/report');
    applyOpenResult(bridge, {
      docId: 'doc-1',
      fileName: 'source.hwp',
      sourcePath: '/tmp/source.hwp',
      format: 'hwp',
      pageCount: 1,
      revision: 5,
      dirty: false,
      warnings: [],
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'prepare_staged_hwp_pdf_export') {
        return '/tmp/report.pdf.hop-export-abcd1234.hwp';
      }
      if (command === 'export_pdf_from_hwp_path') {
        throw new Error('pdf export failed');
      }
      throw new Error(`unexpected command ${command}`);
    });

    await expect(bridge.exportPdfFromCommand()).rejects.toThrow('pdf export failed');

    expect(removeMock).toHaveBeenCalledWith('/tmp/report.pdf.hop-export-abcd1234.hwp');
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

  it('removes the staging file even when the native save commit fails', async () => {
    const bridge = new TauriBridge();
    const handle = writeHandle();
    fsOpenMock.mockResolvedValue(handle);
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
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'check_external_modification') {
        return { changed: false };
      }
      if (command === 'prepare_staged_hwp_save') {
        return '/tmp/source.hwp.hop-save-deadbeef.tmp';
      }
      if (command === 'commit_staged_hwp_save') {
        throw new Error('native commit failed');
      }
      throw new Error(`unexpected command ${command}`);
    });

    await expect(bridge.saveDocumentFromCommand()).rejects.toThrow('native commit failed');

    expect(handle.write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(handle.close).toHaveBeenCalled();
    expect(removeMock).toHaveBeenCalledWith('/tmp/source.hwp.hop-save-deadbeef.tmp');
  });
});

function readHandle(bytes: ArrayLike<number>) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let offset = 0;
  return {
    read: vi.fn(async (buffer: Uint8Array) => {
      if (offset >= data.length) return null;
      const count = Math.min(buffer.byteLength, data.length - offset);
      buffer.set(data.subarray(offset, offset + count));
      offset += count;
      return count;
    }),
    close: vi.fn(async () => undefined),
  };
}

function writeHandle() {
  return {
    write: vi.fn(async (bytes: Uint8Array) => bytes.byteLength),
    close: vi.fn(async () => undefined),
  };
}

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
