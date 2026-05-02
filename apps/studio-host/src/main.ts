import { createBridge, isTauriRuntime } from '@/core/bridge-factory';
import {
  applyDesktopChromePlatformState,
  installNonEditorContextMenuGuards,
} from '@/core/desktop-chrome';
import type { DocumentInfo } from '@/core/types';
import { EventBus } from '@/core/event-bus';
import { createDesktopDocument, setupDesktopEvents } from '@/core/desktop-events';
import { detectDesktopPlatform, hasPrimaryModifier, hydrateDesktopPlatform } from '@/core/platform';
import { CanvasView } from '@/view/canvas-view';
import { InputHandler } from '@/engine/input-handler';
import { Toolbar } from '@/ui/toolbar';
import { MenuBar } from '@/ui/menu-bar';
import { loadWebFonts } from '@/core/font-loader';
import { isSupportedDocumentPath } from '@/core/document-files';
import { CommandRegistry } from '@/command/registry';
import { CommandDispatcher } from '@/command/dispatcher';
import type { EditorContext, CommandServices } from '@/command/types';
import { fileCommands } from '@/command/commands/file';
import { editCommands } from '@/command/commands/edit';
import { viewCommands } from '@/command/commands/view';
import { formatCommands } from '@/command/commands/format';
import { insertCommands } from '@/command/commands/insert';
import { tableCommands } from '@/command/commands/table';
import { pageCommands } from '@/command/commands/page';
import { toolCommands } from '@/command/commands/tool';
import { ContextMenu } from '@/ui/context-menu';
import { CommandPalette } from '@/ui/command-palette';
import { showValidationModalIfNeeded } from '@/ui/validation-modal';
import { CellSelectionRenderer } from '@/engine/cell-selection-renderer';
import { TableObjectRenderer } from '@/engine/table-object-renderer';
import { TableResizeRenderer } from '@/engine/table-resize-renderer';
import { Ruler } from '@/view/ruler';
import { enhanceCustomSelects } from '@/ui/custom-select';
import { UpdateNotice, type UpdateNoticeActions } from '@/ui/update-notice';
import type { DesktopBridgeApi } from '@/core/tauri-bridge';

const wasm = createBridge();
const eventBus = new EventBus();
let desktopPlatform = detectDesktopPlatform();

type DirtyAwareBridge = {
  markDocumentDirty?(): void;
  hasUnsavedChanges?(): boolean;
};

// E2E 테스트용 전역 노출 (개발 모드 전용)
if (import.meta.env.DEV) {
  (window as any).__wasm = wasm;
  (window as any).__eventBus = eventBus;
}
let canvasView: CanvasView | null = null;
let inputHandler: InputHandler | null = null;
let toolbar: Toolbar | null = null;
let ruler: Ruler | null = null;


// ─── 커맨드 시스템 ─────────────────────────────
const registry = new CommandRegistry();

function getContext(): EditorContext {
  return {
    hasDocument: wasm.pageCount > 0,
    hasSelection: inputHandler?.hasSelection() ?? false,
    inTable: inputHandler?.isInTable() ?? false,
    inCellSelectionMode: inputHandler?.isInCellSelectionMode() ?? false,
    inTableObjectSelection: inputHandler?.isInTableObjectSelection() ?? false,
    inPictureObjectSelection: inputHandler?.isInPictureObjectSelection() ?? false,
    inField: inputHandler?.isInField() ?? false,
    isEditable: true,
    canUndo: inputHandler?.canUndo() ?? false,
    canRedo: inputHandler?.canRedo() ?? false,
    zoom: canvasView?.getViewportManager().getZoom() ?? 1.0,
    showControlCodes: wasm.getShowControlCodes(),
  };
}

const commandServices: CommandServices = {
  eventBus,
  wasm,
  getContext,
  getInputHandler: () => inputHandler,
  getViewportManager: () => canvasView?.getViewportManager() ?? null,
};

const dispatcher = new CommandDispatcher(registry, commandServices, eventBus);

// 모든 내장 커맨드 등록
registry.registerAll(fileCommands);
registry.registerAll(editCommands);
registry.registerAll(viewCommands);
registry.registerAll(formatCommands);
registry.registerAll(insertCommands);
registry.registerAll(tableCommands);
registry.registerAll(pageCommands);
registry.registerAll(toolCommands);

// 상태 바 요소
const sbMessage = () => document.getElementById('sb-message')!;
const sbPage = () => document.getElementById('sb-page')!;
const sbSection = () => document.getElementById('sb-section')!;
const sbZoomVal = () => document.getElementById('sb-zoom-val')!;
const ZOOM_STEP = 0.1;

async function initialize(): Promise<void> {
  const msg = sbMessage();
  try {
    const tauriRuntime = isTauriRuntime();
    desktopPlatform = await hydrateDesktopPlatform();
    applyDesktopChromePlatformState(document, desktopPlatform);
    msg.textContent = '웹폰트 로딩 중...';
    await loadWebFonts([]);  // CSS @font-face 등록 + CRITICAL 폰트만 로드
    msg.textContent = '문서 엔진 로딩 중...';
    await wasm.initialize();
    msg.textContent = 'HWP 파일을 선택해주세요.';

    const container = document.getElementById('scroll-container')!;
    canvasView = new CanvasView(container, wasm, eventBus);

    // 눈금자 초기화
    ruler = new Ruler(
      document.getElementById('h-ruler') as HTMLCanvasElement,
      document.getElementById('v-ruler') as HTMLCanvasElement,
      container,
      eventBus,
      wasm,
      canvasView.getVirtualScroll(),
      canvasView.getViewportManager(),
    );

    inputHandler = new InputHandler(
      container, wasm, eventBus,
      canvasView.getVirtualScroll(),
      canvasView.getViewportManager(),
    );

    toolbar = new Toolbar(document.getElementById('style-bar')!, wasm, eventBus, dispatcher);
    toolbar.setEnabled(false);

    // InputHandler에 커맨드 디스패처 및 컨텍스트 메뉴 주입
    inputHandler.setDispatcher(dispatcher);
    inputHandler.setContextMenu(new ContextMenu(dispatcher, registry));
    inputHandler.setCommandPalette(new CommandPalette(registry, dispatcher));
    inputHandler.setCellSelectionRenderer(
      new CellSelectionRenderer(container, canvasView.getVirtualScroll()),
    );
    inputHandler.setTableObjectRenderer(
      new TableObjectRenderer(container, canvasView.getVirtualScroll()),
    );
    inputHandler.setTableResizeRenderer(
      new TableResizeRenderer(container, canvasView.getVirtualScroll()),
    );
    inputHandler.setPictureObjectRenderer(
      new TableObjectRenderer(container, canvasView.getVirtualScroll(), true),
    );

    enhanceCustomSelects(document);

    new MenuBar(document.getElementById('menu-bar')!, eventBus, dispatcher);
    installNonEditorContextMenuGuards(document);

    // 툴바 내 data-cmd 버튼 클릭 → 커맨드 디스패치
    document.querySelectorAll('.tb-btn[data-cmd]').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const cmd = (btn as HTMLElement).dataset.cmd;
        if (cmd) dispatcher.dispatch(cmd, { anchorEl: btn as HTMLElement });
      });
    });

    // 스플릿 버튼 드롭다운 메뉴
    document.querySelectorAll('.tb-split').forEach(split => {
      const arrow = split.querySelector('.tb-split-arrow');
      if (arrow) {
        arrow.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // 다른 열린 메뉴 닫기
          document.querySelectorAll('.tb-split.open').forEach(s => {
            if (s !== split) s.classList.remove('open');
          });
          split.classList.toggle('open');
        });
      }
      split.querySelectorAll('.tb-split-item[data-cmd]').forEach(item => {
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          split.classList.remove('open');
          const cmd = (item as HTMLElement).dataset.cmd;
          if (cmd) dispatcher.dispatch(cmd, { anchorEl: item as HTMLElement });
        });
      });
    });
    // 외부 클릭 시 스플릿 메뉴 닫기
    document.addEventListener('mousedown', () => {
      document.querySelectorAll('.tb-split.open').forEach(s => s.classList.remove('open'));
    });

    setupFileInput();
    setupZoomControls();
    setupEventListeners();
    setupGlobalShortcuts();
    const updateNotice = tauriRuntime
      ? new UpdateNotice(updateNoticeActions(wasm))
      : null;
    void setupDesktopEvents({
      bridge: wasm,
      dispatcher,
      eventBus,
      setMessage: (message) => {
        sbMessage().textContent = message;
      },
      onUpdateState: (state) => {
        updateNotice?.setState(state);
      },
    }).catch((error) => {
      console.error('[main] desktop event setup failed:', error);
    });

    // E2E 테스트용 전역 노출 (개발 모드 전용)
    if (import.meta.env.DEV) {
      (window as any).__inputHandler = inputHandler;
      (window as any).__canvasView = canvasView;
    }
  } catch (error) {
    msg.textContent = `문서 엔진 초기화 실패: ${error}`;
    console.error('[main] 문서 엔진 초기화 실패:', error);
  }
}

function updateNoticeActions(bridge: unknown): UpdateNoticeActions {
  const desktop = bridge as Partial<
    Pick<DesktopBridgeApi, 'startUpdateInstall' | 'restartToApplyUpdate'>
  >;

  return {
    startUpdateInstall: desktop.startUpdateInstall
      ? () => desktop.startUpdateInstall!()
      : undefined,
    restartToApplyUpdate: desktop.restartToApplyUpdate
      ? () => desktop.restartToApplyUpdate!()
      : undefined,
  };
}

/**
 * 전역 단축키 핸들러 — InputHandler.active 여부와 무관하게 동작해야 하는 단축키.
 * 예: 문서 미로드 상태에서도 Alt+N(새 문서), Ctrl+O(열기) 등.
 */
function setupGlobalShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    // input/textarea 등 편집 가능 요소 내부에서는 무시
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable
    ) {
      return;
    }
    // InputHandler가 활성 상태이면 자체 처리에 맡김
    if (inputHandler?.isActive()) return;

    const primaryModifier = hasPrimaryModifier(e, desktopPlatform);

    // Alt+N / Alt+ㅜ → 새 문서 (문서 미로드 상태에서도 동작)
    if (e.altKey && !primaryModifier && !e.shiftKey) {
      if (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ') {
        e.preventDefault();
        dispatcher.dispatch('file:new-doc');
        return;
      }
    }

    if (primaryModifier && !e.altKey) {
      let commandId: string | null = null;
      const key = e.key.toLowerCase();
      if (e.shiftKey && key === 'n') commandId = 'file:new-window';
      else if (!e.shiftKey && key === 'o') commandId = 'file:open';
      else if (!e.shiftKey && key === 's') commandId = 'file:save';
      else if (e.shiftKey && key === 's') commandId = 'file:save-as';
      else if (!e.shiftKey && key === 'e') commandId = 'file:export-pdf';
      else if (!e.shiftKey && key === 'p') commandId = 'file:print';

      if (commandId) {
        e.preventDefault();
        dispatcher.dispatch(commandId);
      }
    }
  }, false);
}

function setupFileInput(): void {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;

  fileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!isSupportedDocumentPath(file.name)) {
      alert('HWP/HWPX 파일만 지원합니다.');
      return;
    }
    await loadFile(file);
  });

  // 문서 전체에서 브라우저 기본 드롭 동작 방지 (파일 열기/다운로드 방지)
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // 드래그 앤 드롭 지원 (scroll-container 영역)
  const container = document.getElementById('scroll-container')!;
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (isTauriRuntime()) return;
    container.classList.add('drag-over');
  });
  container.addEventListener('dragleave', () => {
    container.classList.remove('drag-over');
  });
  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    container.classList.remove('drag-over');
    if (isTauriRuntime()) return;
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    if (!isSupportedDocumentPath(file.name)) {
      alert('HWP/HWPX 파일만 지원합니다.');
      return;
    }
    await loadFile(file);
  });
}

function setupZoomControls(): void {
  if (!canvasView) return;
  const vm = canvasView.getViewportManager();
  const applyIncrementalZoom = (direction: 1 | -1) => {
    vm.setZoom(vm.getZoom() + ZOOM_STEP * direction);
  };

  if (isTauriRuntime() && desktopPlatform === 'windows') {
    document.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;

        // On Windows WebView2, enabling pinch zoom support can also reopen page zoom.
        // Capture and reroute modified wheel gestures to document zoom before the
        // embedded browser consumes them as native page scaling.
        e.preventDefault();
        e.stopPropagation();

        if (wasm.pageCount === 0) return;
        applyIncrementalZoom(e.deltaY < 0 ? 1 : -1);
      },
      { capture: true, passive: false },
    );
  }

  document.getElementById('sb-zoom-in')!.addEventListener('click', () => {
    applyIncrementalZoom(1);
  });
  document.getElementById('sb-zoom-out')!.addEventListener('click', () => {
    applyIncrementalZoom(-1);
  });

  // 폭 맞춤: 용지 폭에 맞게 줌 조절
  document.getElementById('sb-zoom-fit-width')!.addEventListener('click', () => {
    if (wasm.pageCount === 0) return;
    const container = document.getElementById('scroll-container')!;
    const containerWidth = container.clientWidth - 40; // 좌우 여백 제외
    const pageInfo = wasm.getPageInfo(0);
    // pageInfo.width는 이미 px 단위 (96dpi 기준)
    const zoom = containerWidth / pageInfo.width;
    vm.setZoom(Math.max(0.1, Math.min(zoom, 4.0)));
  });

  // 쪽 맞춤: 한 페이지 전체가 보이도록 줌 조절
  document.getElementById('sb-zoom-fit')!.addEventListener('click', () => {
    if (wasm.pageCount === 0) return;
    const container = document.getElementById('scroll-container')!;
    const containerWidth = container.clientWidth - 40;
    const containerHeight = container.clientHeight - 40;
    const pageInfo = wasm.getPageInfo(0);
    // pageInfo.width/height는 이미 px 단위 (96dpi 기준)
    const zoomW = containerWidth / pageInfo.width;
    const zoomH = containerHeight / pageInfo.height;
    vm.setZoom(Math.max(0.1, Math.min(zoomW, zoomH, 4.0)));
  });

  // 모바일: 줌 값 클릭 → 100% 토글
  document.getElementById('sb-zoom-val')!.addEventListener('click', () => {
    const currentZoom = vm.getZoom();
    if (Math.abs(currentZoom - 1.0) < 0.05) {
      // 현재 100% → 쪽 맞춤으로 전환
      document.getElementById('sb-zoom-fit')!.click();
    } else {
      // 현재 쪽 맞춤/기타 → 100%로 전환
      vm.setZoom(1.0);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      applyIncrementalZoom(1);
    } else if (e.key === '-') {
      e.preventDefault();
      applyIncrementalZoom(-1);
    } else if (e.key === '0') {
      e.preventDefault();
      vm.setZoom(1.0);
    }
  });
}

let totalSections = 1;

function setupEventListeners(): void {
  eventBus.on('document-changed', () => {
    const bridge = wasm as DirtyAwareBridge;
    const wasDirty = bridge.hasUnsavedChanges?.() ?? false;
    bridge.markDocumentDirty?.();
    if (!wasDirty && bridge.hasUnsavedChanges?.()) {
      sbMessage().textContent = '수정됨';
    }
  });

  eventBus.on('current-page-changed', (page, _total) => {
    const pageIdx = page as number;
    sbPage().textContent = `${pageIdx + 1} / ${_total} 쪽`;

    // 구역 정보: 현재 페이지의 sectionIndex로 갱신
    if (wasm.pageCount > 0) {
      try {
        const pageInfo = wasm.getPageInfo(pageIdx);
        sbSection().textContent = `구역: ${pageInfo.sectionIndex + 1} / ${totalSections}`;
      } catch { /* 무시 */ }
    }
  });

  eventBus.on('zoom-level-display', (zoom) => {
    sbZoomVal().textContent = `${Math.round((zoom as number) * 100)}%`;
  });

  // 삽입/수정 모드 토글
  eventBus.on('insert-mode-changed', (insertMode) => {
    document.getElementById('sb-mode')!.textContent = (insertMode as boolean) ? '삽입' : '수정';
  });

  // 필드 정보 표시
  const sbField = document.getElementById('sb-field');
  eventBus.on('field-info-changed', (info) => {
    if (!sbField) return;
    const fi = info as { fieldId: number; fieldType: string; guideName?: string } | null;
    if (fi) {
      const label = fi.guideName || `#${fi.fieldId}`;
      sbField.textContent = `[누름틀] ${label}`;
      sbField.style.display = '';
    } else {
      sbField.textContent = '';
      sbField.style.display = 'none';
    }
  });

  // 개체 선택 시 회전/대칭 버튼 그룹 표시/숨김
  const rotateGroup = document.querySelector('.tb-rotate-group') as HTMLElement | null;
  if (rotateGroup) {
    eventBus.on('picture-object-selection-changed', (selected) => {
      rotateGroup.style.display = (selected as boolean) ? '' : 'none';
    });
  }

  // 머리말/꼬리말 편집 모드 시 도구상자 전환 + 본문 dimming
  const hfGroup = document.querySelector('.tb-headerfooter-group') as HTMLElement | null;
  const hfLabel = hfGroup?.querySelector('.tb-hf-label') as HTMLElement | null;
  const defaultTbGroups = document.querySelectorAll('#icon-toolbar > .tb-group:not(.tb-headerfooter-group):not(.tb-rotate-group), #icon-toolbar > .tb-sep');
  const scrollContainer = document.getElementById('scroll-container');
  const styleBar = document.getElementById('style-bar');

  eventBus.on('headerFooterModeChanged', (mode) => {
    const isActive = (mode as string) !== 'none';
    // 도구상자 전환
    if (hfGroup) {
      hfGroup.style.display = isActive ? '' : 'none';
    }
    if (hfLabel) {
      hfLabel.textContent = (mode as string) === 'header' ? '머리말' : (mode as string) === 'footer' ? '꼬리말' : '';
    }
    defaultTbGroups.forEach((el) => {
      (el as HTMLElement).style.display = isActive ? 'none' : '';
    });
    // 서식 도구 모음은 머리말/꼬리말 편집 시에도 유지 (문단/글자 모양 설정 필요)
    // 본문 dimming
    if (scrollContainer) {
      if (isActive) {
        scrollContainer.classList.add('hf-editing');
      } else {
        scrollContainer.classList.remove('hf-editing');
      }
    }
  });
}

/** 문서 초기화 공통 시퀀스 (loadFile, createNewDocument 양쪽에서 사용) */
async function initializeDocument(docInfo: DocumentInfo, displayName: string): Promise<void> {
  const msg = sbMessage();
  try {
    if (docInfo.fontsUsed?.length) {
      await loadWebFonts(docInfo.fontsUsed, (loaded, total) => {
        msg.textContent = `폰트 로딩 중... (${loaded}/${total})`;
      });
    }
    msg.textContent = displayName;
    totalSections = docInfo.sectionCount ?? 1;
    sbSection().textContent = `구역: 1 / ${totalSections}`;
    inputHandler?.deactivate();
    canvasView?.loadDocument();
    toolbar?.setEnabled(true);
    toolbar?.initStyleDropdown();
    inputHandler?.activateWithCaretPosition();

    try {
      const report = wasm.getValidationWarnings();
      console.log(`[validation] ${report.count} warnings`, report.summary);
      if (report.count > 0) {
        const choice = await showValidationModalIfNeeded(report);
        console.log(`[validation] user choice: ${choice}`);
        if (choice === 'auto-fix') {
          const reflowedCount = wasm.reflowLinesegs();
          console.log(`[validation] reflowed ${reflowedCount} paragraphs`);
          canvasView?.loadDocument();
          msg.textContent = `${displayName} (비표준 lineseg ${reflowedCount}건 자동 보정됨)`;
        }
      }
    } catch (error) {
      console.warn('[validation] 감지/보정 실패 (치명적이지 않음):', error);
    }
  } catch (error) {
    console.error('[initDoc] 오류:', error);
    if (window.innerWidth < 768) alert(`초기화 오류: ${error}`);
  }
}

async function loadFile(file: File): Promise<void> {
  const msg = sbMessage();
  try {
    msg.textContent = '파일 로딩 중...';
    const startTime = performance.now();
    const data = new Uint8Array(await file.arrayBuffer());
    const docInfo = wasm.loadDocument(data, file.name);
    const elapsed = performance.now() - startTime;
    await initializeDocument(docInfo, `${file.name} — ${docInfo.pageCount}페이지 (${elapsed.toFixed(1)}ms)`);
  } catch (error) {
    const errMsg = `파일 로드 실패: ${error}`;
    msg.textContent = errMsg;
    console.error('[main] 파일 로드 실패:', error);
    // 모바일에서 상태 메시지가 숨겨질 수 있으므로 alert으로도 표시
    if (window.innerWidth < 768) alert(errMsg);
  }
}

async function createNewDocument(): Promise<void> {
  const msg = sbMessage();
  try {
    msg.textContent = '새 문서 생성 중...';
    const payload = await createDesktopDocument(wasm);
    if (payload) {
      await initializeDocument(payload.docInfo, payload.message);
      return;
    }
    const docInfo = wasm.createNewDocument();
    await initializeDocument(docInfo, `새 문서.hwp — ${docInfo.pageCount}페이지`);
  } catch (error) {
    msg.textContent = `새 문서 생성 실패: ${error}`;
    console.error('[main] 새 문서 생성 실패:', error);
  }
}

// 커맨드에서 새 문서 생성 호출
eventBus.on('create-new-document', () => { createNewDocument(); });
eventBus.on('desktop-document-loaded', (payload) => {
  const p = payload as { docInfo: DocumentInfo; message: string };
  initializeDocument(p.docInfo, p.message);
});
eventBus.on('desktop-document-saved', () => {
  // TauriBridge가 title/dirty 상태를 이미 갱신한다. 상태바만 현재 동작에 맞춘다.
  sbMessage().textContent = '저장 완료';
});
eventBus.on('desktop-status', (message) => {
  sbMessage().textContent = String(message);
});

// 수식 더블클릭 → 수식 편집 대화상자
eventBus.on('equation-edit-request', () => {
  dispatcher.dispatch('insert:equation-edit');
});

initialize();
