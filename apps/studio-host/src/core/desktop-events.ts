import type { CommandDispatcher } from '@/upstream/commands';
import type { EventBus } from '@/upstream/core';
import { isTauriRuntime } from '@/core/bridge-factory';
import { findLatestSupportedDocumentPath, hasSupportedDocumentPath } from '@/core/document-files';
import type { DesktopBridgeApi, DesktopLoadPayload, DesktopUpdateState } from './tauri-bridge';
import { t } from '../hop-i18n';

type DesktopRuntimeBridge = Partial<
  Pick<
    DesktopBridgeApi,
    | 'openDocumentByPath'
    | 'takePendingOpenPaths'
    | 'createNewDocumentAsync'
    | 'confirmWindowClose'
    | 'destroyCurrentWindow'
    | 'cancelAppQuit'
    | 'hasUnsavedChanges'
    | 'getUpdateState'
  >
>;

interface DesktopEventsOptions {
  bridge: unknown;
  dispatcher: CommandDispatcher;
  eventBus: EventBus;
  setMessage(message: string): void;
  onUpdateState(state: DesktopUpdateState): void;
}

interface CloseRequestEvent {
  preventDefault(): void;
}

export async function setupDesktopEvents({
  bridge,
  dispatcher,
  eventBus,
  setMessage,
  onUpdateState,
}: DesktopEventsOptions): Promise<void> {
  if (!isTauriRuntime()) return;

  const desktop = bridge as DesktopRuntimeBridge;
  const { listen } = await import('@tauri-apps/api/event');
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const currentWindow = getCurrentWebviewWindow();

  await listen('hop-job-progress', (event) => {
    const payload = event.payload as { message?: string };
    if (payload?.message) setMessage(payload.message);
  });

  await listen('hop-update-state', (event) => {
    onUpdateState(event.payload as DesktopUpdateState);
  });

  await currentWindow.listen('hop-menu-command', (event) => {
    const command = String(event.payload || '');
    if (command) dispatcher.dispatch(command);
  });

  await currentWindow.listen('hop-app-quit-requested', async () => {
    await handleDesktopAppQuitRequest(desktop, setMessage);
  });

  await currentWindow.listen('hop-open-paths', async (event) => {
    const payload = event.payload as { paths?: string[] };
    const pending = await desktop.takePendingOpenPaths?.();
    await openLatestDesktopDocument({
      bridge: desktop,
      eventBus,
      paths: [...(payload.paths ?? []), ...(pending ?? [])],
      setMessage,
    });
  });

  await currentWindow.listen('tauri://drag-enter', (event) => {
    const payload = event.payload as { paths?: string[] };
    if (hasSupportedDocumentPath(payload.paths ?? [])) {
      setDesktopDragActive(true);
      setMessage(t('hop.status.dropToOpen'));
    }
  });

  await currentWindow.listen('tauri://drag-leave', () => {
    setDesktopDragActive(false);
  });

  await currentWindow.listen('tauri://drag-drop', () => {
    setDesktopDragActive(false);
  });

  await currentWindow.onCloseRequested(async (event) => {
    await handleDesktopCloseRequest(event, desktop, setMessage);
  });

  const pending = await desktop.takePendingOpenPaths?.();
  await openLatestDesktopDocument({
    bridge: desktop,
    eventBus,
    paths: pending ?? [],
    setMessage,
  });

  if (desktop.getUpdateState) {
    try {
      onUpdateState(await desktop.getUpdateState());
    } catch (error) {
      console.warn('[desktop-events] updater state hydrate failed:', error);
    }
  }
}

export async function createDesktopDocument(bridge: unknown): Promise<DesktopLoadPayload | null> {
  const desktop = bridge as DesktopRuntimeBridge;
  if (!desktop.createNewDocumentAsync) return null;
  return desktop.createNewDocumentAsync();
}

async function handleDesktopCloseRequest(
  event: CloseRequestEvent,
  desktop: DesktopRuntimeBridge,
  setMessage: (message: string) => void,
): Promise<void> {
  if (!desktop.destroyCurrentWindow) return;
  event.preventDefault();
  await confirmAndDestroyWindow(desktop, {
    context: 'close request',
    errorPrefix: t('hop.status.windowCloseFailed'),
    setMessage,
  });
}

async function handleDesktopAppQuitRequest(
  desktop: DesktopRuntimeBridge,
  setMessage: (message: string) => void,
): Promise<void> {
  if (!desktop.destroyCurrentWindow) return;
  await confirmAndDestroyWindow(desktop, {
    context: 'app quit request',
    errorPrefix: t('hop.status.appQuitFailed'),
    onCancel: () => desktop.cancelAppQuit?.(),
    setMessage,
  });
}

function setDesktopDragActive(active: boolean): void {
  document.getElementById('scroll-container')?.classList.toggle('drag-over', active);
}

async function confirmAndDestroyWindow(
  desktop: DesktopRuntimeBridge,
  {
    context,
    errorPrefix,
    onCancel,
    setMessage,
  }: {
    context: string;
    errorPrefix: string;
    onCancel?: () => Promise<void> | void;
    setMessage: (message: string) => void;
  },
): Promise<void> {
  if (!desktop.destroyCurrentWindow) return;

  try {
    const canClose = desktop.confirmWindowClose ? await desktop.confirmWindowClose() : true;
    if (canClose) {
      await desktop.destroyCurrentWindow();
    } else {
      await onCancel?.();
    }
  } catch (error) {
    console.error(`[desktop-events] ${context} failed:`, error);
    if (!desktop.hasUnsavedChanges?.()) {
      await desktop.destroyCurrentWindow();
    } else {
      setMessage(`${errorPrefix}: ${error}`);
      await onCancel?.();
    }
  }
}

async function openLatestDesktopDocument({
  bridge,
  eventBus,
  paths,
  setMessage,
}: {
  bridge: DesktopRuntimeBridge;
  eventBus: EventBus;
  paths: string[];
  setMessage(message: string): void;
}): Promise<void> {
  const path = findLatestSupportedDocumentPath(paths);
  if (!path) {
    if (paths.length > 0) setMessage(t('hop.status.onlyHwpOpen'));
    return;
  }
  if (!bridge.openDocumentByPath) return;

  try {
    setMessage(t('hop.status.loadingFile'));
    const loaded = await bridge.openDocumentByPath(path);
    if (loaded) eventBus.emit('desktop-document-loaded', loaded);
  } catch (error) {
    const errMsg = t('hop.status.fileLoadFailed', { error: String(error) });
    setMessage(errMsg);
    console.error('[desktop-events] 데스크톱 파일 로드 실패:', error);
  }
}
