import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopDocument, setupDesktopEvents } from './desktop-events';

const tauriListen = vi.hoisted(() => vi.fn());
const currentWindow = vi.hoisted(() => ({
  listen: vi.fn(),
  onCloseRequested: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriListen,
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => currentWindow,
}));

vi.mock('@/core/bridge-factory', () => ({
  isTauriRuntime: () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
}));

describe('desktop events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriListen.mockReset();
    currentWindow.listen.mockReset();
    currentWindow.onCloseRequested.mockReset();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing outside the Tauri runtime', async () => {
    await setupDesktopEvents({
      bridge: {},
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage: vi.fn(),
      onUpdateState: vi.fn(),
    });

    expect(tauriListen).not.toHaveBeenCalled();
    expect(currentWindow.listen).not.toHaveBeenCalled();
  });

  it('opens the latest supported document path from app events and pending paths', async () => {
    const { windowHandlers } = installTauriMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const loaded = { docInfo: { pageCount: 1 }, message: 'loaded' };
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(['pending.HWP']),
      openDocumentByPath: vi.fn().mockResolvedValue(loaded),
    };
    const eventBus = { emit: vi.fn() };

    await setupDesktopEvents({
      bridge,
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: eventBus as never,
      setMessage: vi.fn(),
      onUpdateState: vi.fn(),
    });

    await windowHandlers.get('hop-open-paths')?.({
      payload: { paths: ['first.hwp', 'notes.txt'] },
    });

    expect(bridge.openDocumentByPath).toHaveBeenCalledWith('pending.HWP');
    expect(eventBus.emit).toHaveBeenCalledWith('desktop-document-loaded', loaded);
  });

  it('reports unsupported dropped/opened paths without calling the bridge', async () => {
    const { windowHandlers } = installTauriMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const setMessage = vi.fn();
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue([]),
      openDocumentByPath: vi.fn(),
    };

    await setupDesktopEvents({
      bridge,
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage,
      onUpdateState: vi.fn(),
    });

    await windowHandlers.get('hop-open-paths')?.({
      payload: { paths: ['readme.txt'] },
    });

    expect(setMessage).toHaveBeenCalledWith('HWP/HWPX 파일만 열 수 있습니다');
    expect(bridge.openDocumentByPath).not.toHaveBeenCalled();
  });

  it('toggles drag state only for supported document paths', async () => {
    const { windowHandlers } = installTauriMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    const { classList } = installDocumentStub();
    const setMessage = vi.fn();

    await setupDesktopEvents({
      bridge: { takePendingOpenPaths: vi.fn().mockResolvedValue([]) },
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage,
      onUpdateState: vi.fn(),
    });

    await windowHandlers.get('tauri://drag-enter')?.({ payload: { paths: ['notes.txt'] } });
    expect(classList.toggle).not.toHaveBeenCalledWith('drag-over', true);

    await windowHandlers.get('tauri://drag-enter')?.({ payload: { paths: ['doc.HWPX'] } });
    expect(classList.toggle).toHaveBeenCalledWith('drag-over', true);
    expect(setMessage).toHaveBeenCalledWith('HWP/HWPX 파일을 놓으면 문서를 엽니다');

    await windowHandlers.get('tauri://drag-leave')?.({ payload: {} });
    await windowHandlers.get('tauri://drag-drop')?.({ payload: {} });
    expect(classList.toggle).toHaveBeenCalledWith('drag-over', false);
    expect(classList.toggle).toHaveBeenCalledTimes(3);
  });

  it('routes menu commands and close requests through desktop adapters', async () => {
    const { windowHandlers, getCloseHandler } = installTauriMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const dispatcher = { dispatch: vi.fn() };
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue([]),
      confirmWindowClose: vi.fn().mockResolvedValue(true),
      destroyCurrentWindow: vi.fn().mockResolvedValue(undefined),
    };

    await setupDesktopEvents({
      bridge,
      dispatcher: dispatcher as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage: vi.fn(),
      onUpdateState: vi.fn(),
    });

    await windowHandlers.get('hop-menu-command')?.({ payload: 'file:save' });
    const preventDefault = vi.fn();
    await getCloseHandler()?.({ preventDefault });

    expect(dispatcher.dispatch).toHaveBeenCalledWith('file:save');
    expect(preventDefault).toHaveBeenCalled();
    expect(bridge.confirmWindowClose).toHaveBeenCalled();
    expect(bridge.destroyCurrentWindow).toHaveBeenCalled();
  });

  it('routes app quit requests through the existing close guard and cancels on refusal', async () => {
    const { windowHandlers } = installTauriMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue([]),
      confirmWindowClose: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      destroyCurrentWindow: vi.fn().mockResolvedValue(undefined),
      cancelAppQuit: vi.fn().mockResolvedValue(undefined),
    };

    await setupDesktopEvents({
      bridge,
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage: vi.fn(),
      onUpdateState: vi.fn(),
    });

    await windowHandlers.get('hop-app-quit-requested')?.({ payload: null });
    await windowHandlers.get('hop-app-quit-requested')?.({ payload: null });

    expect(bridge.destroyCurrentWindow).toHaveBeenCalledTimes(1);
    expect(bridge.cancelAppQuit).toHaveBeenCalledTimes(1);
  });

  it('falls back to native close when clean close confirmation fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getCloseHandler } = installTauriMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const setMessage = vi.fn();
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue([]),
      confirmWindowClose: vi.fn().mockRejectedValue(new Error('bridge stalled')),
      hasUnsavedChanges: vi.fn(() => false),
      destroyCurrentWindow: vi.fn().mockResolvedValue(undefined),
    };

    await setupDesktopEvents({
      bridge,
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage,
      onUpdateState: vi.fn(),
    });

    const preventDefault = vi.fn();
    await getCloseHandler()?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(bridge.destroyCurrentWindow).toHaveBeenCalled();
    expect(setMessage).not.toHaveBeenCalled();
  });

  it('keeps dirty windows open when close confirmation fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getCloseHandler } = installTauriMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const setMessage = vi.fn();
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue([]),
      confirmWindowClose: vi.fn().mockRejectedValue(new Error('dialog failed')),
      hasUnsavedChanges: vi.fn(() => true),
      destroyCurrentWindow: vi.fn().mockResolvedValue(undefined),
    };

    await setupDesktopEvents({
      bridge,
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage,
      onUpdateState: vi.fn(),
    });

    const preventDefault = vi.fn();
    await getCloseHandler()?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(bridge.destroyCurrentWindow).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith('창 닫기 실패: Error: dialog failed');
  });

  it('delegates createDesktopDocument only when the bridge supports it', async () => {
    await expect(createDesktopDocument({})).resolves.toBeNull();

    const payload = { docInfo: { pageCount: 1 }, message: 'new' };
    await expect(createDesktopDocument({
      createNewDocumentAsync: vi.fn().mockResolvedValue(payload),
    })).resolves.toBe(payload);
  });

  it('hydrates update state and listens for later updater events', async () => {
    const { eventHandlers } = installTauriMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const onUpdateState = vi.fn();
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue([]),
      getUpdateState: vi.fn().mockResolvedValue({
        status: 'available',
        version: '0.1.3',
      }),
    };

    await setupDesktopEvents({
      bridge,
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage: vi.fn(),
      onUpdateState,
    });

    expect(onUpdateState).toHaveBeenCalledWith({
      status: 'available',
      version: '0.1.3',
    });

    await eventHandlers.get('hop-update-state')?.({
      payload: { status: 'ready', version: '0.1.3' },
    });

    expect(onUpdateState).toHaveBeenCalledWith({
      status: 'ready',
      version: '0.1.3',
    });
  });

  it('does not fail desktop event setup when updater state hydration throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installTauriMocks();
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    installDocumentStub();

    const onUpdateState = vi.fn();
    const bridge = {
      takePendingOpenPaths: vi.fn().mockResolvedValue([]),
      getUpdateState: vi.fn().mockRejectedValue(new Error('updater unavailable')),
    };

    await expect(setupDesktopEvents({
      bridge,
      dispatcher: { dispatch: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      setMessage: vi.fn(),
      onUpdateState,
    })).resolves.toBeUndefined();

    expect(onUpdateState).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      '[desktop-events] updater state hydrate failed:',
      expect.any(Error),
    );
  });
});

function installTauriMocks() {
  const windowHandlers = new Map<string, (event: { payload: unknown }) => unknown>();
  const eventHandlers = new Map<string, (event: { payload: unknown }) => unknown>();
  let closeHandler: ((event: { preventDefault(): void }) => Promise<void>) | undefined;
  tauriListen.mockImplementation(async (name: string, handler: (event: { payload: unknown }) => unknown) => {
    eventHandlers.set(name, handler);
    return vi.fn();
  });
  currentWindow.listen.mockImplementation(async (name: string, handler: (event: { payload: unknown }) => unknown) => {
    windowHandlers.set(name, handler);
    return vi.fn();
  });
  currentWindow.onCloseRequested.mockImplementation(async (handler: typeof closeHandler) => {
    closeHandler = handler;
    return vi.fn();
  });
  return {
    eventHandlers,
    windowHandlers,
    getCloseHandler: () => closeHandler,
  };
}

function installDocumentStub() {
  const classList = { toggle: vi.fn() };
  (globalThis as { document?: unknown }).document = {
    getElementById: vi.fn(() => ({ classList })),
  };
  return { classList };
}
