import type { CommandDispatcher } from '@/command/dispatcher';
import type { EventBus } from '@/core/event-bus';
import { isTauriRuntime } from '@/core/bridge-factory';
import type { DesktopBridgeApi, DesktopLoadPayload } from './tauri-bridge';

type DesktopRuntimeBridge = Partial<
  Pick<
    DesktopBridgeApi,
    | 'openDocumentByPath'
    | 'takePendingOpenPaths'
    | 'createNewDocumentAsync'
    | 'confirmWindowClose'
    | 'destroyCurrentWindow'
  >
>;

interface DesktopEventsOptions {
  bridge: unknown;
  dispatcher: CommandDispatcher;
  eventBus: EventBus;
  setMessage(message: string): void;
}

export async function setupDesktopEvents({
  bridge,
  dispatcher,
  eventBus,
  setMessage,
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

  await currentWindow.listen('hop-menu-command', (event) => {
    const command = String(event.payload || '');
    if (command) dispatcher.dispatch(command);
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
      setMessage('HWP/HWPX 파일을 놓으면 문서를 엽니다');
    }
  });

  await currentWindow.listen('tauri://drag-leave', () => {
    setDesktopDragActive(false);
  });

  await currentWindow.listen('tauri://drag-drop', () => {
    setDesktopDragActive(false);
  });

  await currentWindow.onCloseRequested(async (event) => {
    if (!desktop.confirmWindowClose || !desktop.destroyCurrentWindow) return;
    event.preventDefault();
    if (await desktop.confirmWindowClose()) {
      await desktop.destroyCurrentWindow();
    }
  });

  const pending = await desktop.takePendingOpenPaths?.();
  await openLatestDesktopDocument({
    bridge: desktop,
    eventBus,
    paths: pending ?? [],
    setMessage,
  });
}

export async function createDesktopDocument(bridge: unknown): Promise<DesktopLoadPayload | null> {
  const desktop = bridge as DesktopRuntimeBridge;
  if (!desktop.createNewDocumentAsync) return null;
  return desktop.createNewDocumentAsync();
}

function hasSupportedDocumentPath(paths: string[]): boolean {
  return paths.some((value) => /\.(hwp|hwpx)$/i.test(value));
}

function setDesktopDragActive(active: boolean): void {
  document.getElementById('scroll-container')?.classList.toggle('drag-over', active);
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
  const path = [...paths].reverse().find((value) => /\.(hwp|hwpx)$/i.test(value));
  if (!path) {
    if (paths.length > 0) setMessage('HWP/HWPX 파일만 열 수 있습니다');
    return;
  }
  if (!bridge.openDocumentByPath) return;

  try {
    setMessage('파일 로딩 중...');
    const loaded = await bridge.openDocumentByPath(path);
    if (loaded) eventBus.emit('desktop-document-loaded', loaded);
  } catch (error) {
    const errMsg = `파일 로드 실패: ${error}`;
    setMessage(errMsg);
    console.error('[desktop-events] 데스크톱 파일 로드 실패:', error);
  }
}
