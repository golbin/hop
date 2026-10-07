import { afterEach, describe, expect, it, vi } from 'vitest';

const { registeredGroups } = vi.hoisted(() => ({ registeredGroups: [] as unknown[][] }));

vi.mock('@/upstream/commands', () => ({
  CommandRegistry: class {
    registerAll(commands: unknown[]) {
      registeredGroups.push(commands);
    }
  },
  CommandDispatcher: class {},
  formatCommands: [],
  insertCommands: [],
  pageCommands: [],
  tableCommands: [],
  toolCommands: [],
  viewCommands: [],
}));
vi.mock('@/command/commands/edit', () => ({ editCommands: [] }));
vi.mock('@/command/commands/file', () => ({ fileCommands: [] }));

import { createCommandRuntime } from './command-runtime';

describe('createCommandRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    registeredGroups.length = 0;
  });

  it('exposes the complete upstream editor context through HOP dependencies', () => {
    installDocument();
    const inputHandler = inputHandlerStub();
    const runtime = createCommandRuntime(dependencies(inputHandler) as never);

    expect(runtime.services.getContext()).toMatchObject({
      hasDocument: true,
      hasSelection: true,
      hasCopiedFormat: true,
      inTable: true,
      inCellSelectionMode: true,
      hasMultiCellSelection: true,
      hasTableTransposeClipboard: true,
      showParagraphMarks: true,
      sourceFormat: 'hwpx',
      editMode: 'normal',
      isEditable: true,
    });
    expect(runtime.services.gotoPage(4)).toBe(true);
    expect(registeredGroups).toHaveLength(8);
  });

  it('synchronizes form mode with the input handler, DOM, status, and events', () => {
    const formButton = { classList: { toggle: vi.fn() } };
    const documentStub = installDocument([formButton]);
    const inputHandler = inputHandlerStub({ canEditCurrentFormField: () => false });
    const deps = dependencies(inputHandler);
    const runtime = createCommandRuntime(deps as never);

    runtime.services.setEditMode('form');

    expect(inputHandler.setEditMode).toHaveBeenCalledWith('form');
    expect(documentStub.documentElement.dataset.editMode).toBe('form');
    expect(formButton.classList.toggle).toHaveBeenCalledWith('active', true);
    expect(deps.setStatusMessage).toHaveBeenCalledWith('양식 모드');
    expect(deps.eventBus.emit).toHaveBeenCalledWith('edit-mode-changed', 'form');
    expect(runtime.services.getContext()).toMatchObject({
      editMode: 'form',
      isFormMode: true,
      isEditable: false,
    });
  });

  it('refreshes status from the current document name after Save As', () => {
    installDocument();
    const deps = dependencies(inputHandlerStub());
    const runtime = createCommandRuntime(deps as never);
    deps.wasm.fileName = '다른 이름.hwpx';
    runtime.services.refreshDocumentStatus();
    expect(deps.setStatusMessage).toHaveBeenCalledWith('다른 이름.hwpx — 2페이지');
  });
});

function installDocument(elements: unknown[] = []) {
  const documentStub = {
    documentElement: { dataset: {} as Record<string, string> },
    querySelectorAll: vi.fn(() => elements),
  };
  vi.stubGlobal('document', documentStub);
  return documentStub;
}

function inputHandlerStub(overrides: Record<string, unknown> = {}) {
  return {
    canEditCurrentFormField: vi.fn(() => true),
    hasSelection: vi.fn(() => true),
    hasCopiedFormat: vi.fn(() => true),
    isInTable: vi.fn(() => true),
    isInCellSelectionMode: vi.fn(() => true),
    hasMultiCellSelection: vi.fn(() => true),
    isInTableObjectSelection: vi.fn(() => false),
    isInPictureObjectSelection: vi.fn(() => false),
    isInField: vi.fn(() => false),
    canUndo: vi.fn(() => true),
    canRedo: vi.fn(() => false),
    setEditMode: vi.fn(),
    ...overrides,
  };
}

function dependencies(inputHandler: ReturnType<typeof inputHandlerStub>) {
  return {
    wasm: {
      fileName: '문서.hwp',
      pageCount: 2,
      hasTableTransposeClipboard: vi.fn(() => true),
      getShowControlCodes: vi.fn(() => false),
      getShowParagraphMarks: vi.fn(() => true),
      getSourceFormat: vi.fn(() => 'hwpx'),
    },
    eventBus: { emit: vi.fn() },
    documentState: { isDirty: vi.fn(() => true) },
    getInputHandler: () => inputHandler,
    getCanvasView: () => ({
      getViewportManager: () => ({ getZoom: () => 1.25 }),
      gotoPage: vi.fn(() => true),
    }),
    setStatusMessage: vi.fn(),
  };
}
