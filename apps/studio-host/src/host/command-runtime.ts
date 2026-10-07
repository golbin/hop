import type { CanvasView } from '@/upstream/view';
import type { InputHandler } from '@/upstream/editor';
import {
  CommandDispatcher,
  CommandRegistry,
  formatCommands,
  insertCommands,
  pageCommands,
  tableCommands,
  toolCommands,
  viewCommands,
} from '@/upstream/commands';
import type { CommandDef, CommandServices, EditorContext, EditorEditMode } from '@/upstream/commands';
import type { DocumentDirtyState, EventBus, WasmBridge } from '@/upstream/core';
import { editCommands } from '@/command/commands/edit';
import { fileCommands } from '@/command/commands/file';
import { assertUniqueCommandIds } from '../command/replace-upstream-commands';

interface CommandRuntimeDependencies {
  wasm: WasmBridge;
  eventBus: EventBus;
  documentState: DocumentDirtyState;
  getInputHandler: () => InputHandler | null;
  getCanvasView: () => CanvasView | null;
  setStatusMessage: (message: string) => void;
}

export interface CommandRuntime {
  registry: CommandRegistry;
  dispatcher: CommandDispatcher;
  services: CommandServices;
  getEditMode: () => EditorEditMode;
}

/**
 * HOP command contributions replace selected upstream groups while the editor
 * host remains unaware of individual command modules.
 */
const commandContributions: readonly CommandDef[][] = [
  fileCommands,
  editCommands,
  viewCommands,
  formatCommands,
  insertCommands,
  tableCommands,
  pageCommands,
  toolCommands,
];

assertUniqueCommandIds(commandContributions);

export function createCommandRuntime(dependencies: CommandRuntimeDependencies): CommandRuntime {
  const { wasm, eventBus, documentState, getInputHandler, getCanvasView, setStatusMessage } = dependencies;
  const registry = new CommandRegistry();
  let editMode: EditorEditMode = 'normal';

  const getContext = (): EditorContext => {
    const inputHandler = getInputHandler();
    const hasDocument = wasm.pageCount > 0;
    const canEditFormField = inputHandler?.canEditCurrentFormField() ?? false;
    const isFormMode = editMode === 'form';
    return {
      hasDocument,
      hasSelection: inputHandler?.hasSelection() ?? false,
      hasCopiedFormat: inputHandler?.hasCopiedFormat() ?? false,
      inTable: inputHandler?.isInTable() ?? false,
      inCellSelectionMode: inputHandler?.isInCellSelectionMode() ?? false,
      hasMultiCellSelection: inputHandler?.hasMultiCellSelection() ?? false,
      hasTableTransposeClipboard: wasm.hasTableTransposeClipboard(),
      inTableObjectSelection: inputHandler?.isInTableObjectSelection() ?? false,
      inPictureObjectSelection: inputHandler?.isInPictureObjectSelection() ?? false,
      inField: inputHandler?.isInField() ?? false,
      isEditable: !isFormMode || canEditFormField,
      editMode,
      isFormMode,
      canEditFormField,
      canUndo: inputHandler?.canUndo() ?? false,
      canRedo: inputHandler?.canRedo() ?? false,
      zoom: getCanvasView()?.getViewportManager().getZoom() ?? 1.0,
      showControlCodes: wasm.getShowControlCodes(),
      showParagraphMarks: wasm.getShowParagraphMarks(),
      isDirty: documentState.isDirty(),
      sourceFormat: hasDocument ? (wasm.getSourceFormat() as 'hwp' | 'hwpx' | 'hml') : undefined,
    };
  };

  const setEditMode = (mode: EditorEditMode): void => {
    editMode = mode;
    getInputHandler()?.setEditMode(mode);
    document.documentElement.dataset.editMode = mode;
    document.querySelectorAll('[data-cmd="view:form-mode"]').forEach((element) => {
      element.classList.toggle('active', mode === 'form');
    });
    setStatusMessage(mode === 'form' ? '양식 모드' : '기본 편집 모드');
    eventBus.emit('edit-mode-changed', mode);
    eventBus.emit('command-state-changed');
  };

  const services: CommandServices = {
    eventBus,
    wasm,
    documentState,
    getContext,
    getInputHandler,
    getViewportManager: () => getCanvasView()?.getViewportManager() ?? null,
    gotoPage: (globalPage) => getCanvasView()?.gotoPage(globalPage) ?? false,
    refreshDocumentStatus: () => {
      setStatusMessage(`${wasm.fileName} — ${wasm.pageCount}페이지`);
    },
    setEditMode,
  };
  const dispatcher = new CommandDispatcher(registry, services, eventBus);
  for (const commands of commandContributions) registry.registerAll(commands);

  return { registry, dispatcher, services, getEditMode: () => editMode };
}
