import type { DocumentPosition, EventBus, WasmBridge } from '../upstream/core';
import { DeleteSelectionCommand, type InputHandler } from '../upstream/editor';

interface ClipboardImage {
  data: Uint8Array;
  width: number;
  height: number;
  extension: string;
}

type Selection = ReturnType<InputHandler['getSelection']>;
type PasteInput = Pick<InputHandler,
  'isActive' | 'isFormMode' | 'isInSeparateCaretSpace' | 'isInPictureObjectSelection'
  | 'isInTableObjectSelection' | 'getCursorPosition' | 'getSelection' | 'executeOperation'>;

function canPasteImage(input: PasteInput): boolean {
  return input.isActive() && !input.isFormMode() && !input.isInSeparateCaretSpace()
    && !input.isInPictureObjectSelection() && !input.isInTableObjectSelection();
}

async function readImage(file: File): Promise<ClipboardImage> {
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    image.src = url;
    const [buffer] = await Promise.all([file.arrayBuffer(), image.decode()]);
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error('Invalid image dimensions');
    return {
      data: new Uint8Array(buffer),
      width: image.naturalWidth,
      height: image.naturalHeight,
      extension: (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg'),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cellPath(position: DocumentPosition) {
  if (position.parentParaIndex === undefined) return [];
  return position.cellPath?.length ? position.cellPath : [{
    controlIndex: position.controlIndex!,
    cellIndex: position.cellIndex!,
    cellParaIndex: position.cellParaIndex ?? position.paragraphIndex,
  }];
}

export function insertInlineClipboardImage(
  wasm: WasmBridge,
  position: DocumentPosition,
  image: ClipboardImage,
): DocumentPosition {
  const path = cellPath(position);
  const inCell = path.length > 0;
  const parent = position.parentParaIndex ?? position.paragraphIndex;
  const page = wasm.getPageDef(position.sectionIndex);
  let maxWidth = page.width - page.marginLeft - page.marginRight - page.marginGutter;
  const maxHeight = page.height - page.marginTop - page.marginBottom - page.marginHeader - page.marginFooter;
  if (inCell && !position.isTextBox) {
    const cell = wasm.getCellPropertiesByPath(
      position.sectionIndex, parent, JSON.stringify(path), path.at(-1)!.cellIndex,
    );
    maxWidth = Math.min(maxWidth, cell.width - cell.paddingLeft - cell.paddingRight);
  }
  if (!(maxWidth > 0 && maxHeight > 0)) throw new Error('No space for the image');
  const scale = Math.min(1, maxWidth / (image.width * 75), maxHeight / (image.height * 75));
  const insert = inCell ? wasm.insertPictureInCell.bind(wasm) : wasm.insertPicture.bind(wasm);
  const result = insert(
    position.sectionIndex, parent, position.charOffset, inCell ? JSON.stringify(path) : '',
    image.data, Math.max(1, Math.round(image.width * 75 * scale)),
    Math.max(1, Math.round(image.height * 75 * scale)), image.width, image.height, image.extension,
  );
  if (!result.ok) throw new Error('Image insertion failed');
  const properties = inCell
    ? wasm.setCellPicturePropertiesByPath(position.sectionIndex, parent, path, result.controlIdx, { treatAsChar: true })
    : wasm.setPictureProperties(position.sectionIndex, result.paraIdx, result.controlIdx, { treatAsChar: true });
  if (!properties.ok) throw new Error('Inline image placement failed');
  const offset = result.logicalOffset ?? position.charOffset + 1;
  return inCell
    ? { ...position, charOffset: offset }
    : { ...position, paragraphIndex: result.paraIdx, charOffset: offset };
}

function replaceSelection(wasm: WasmBridge, selection: NonNullable<Selection>): DocumentPosition {
  const deletion = new DeleteSelectionCommand(selection.start, selection.end);
  try {
    return deletion.execute(wasm);
  } finally {
    // The enclosing snapshot owns undo; release the temporary deletion's resources.
    deletion.discard(wasm);
  }
}

/** Own only external image-file pastes; leave rich/internal clipboard handling upstream. */
export function installImagePaste(
  container: HTMLElement,
  options: { input: PasteInput; wasm: WasmBridge; eventBus: EventBus; onError: () => void },
): () => void {
  const { input, wasm, eventBus, onError } = options;
  const editorInput = container.ownerDocument.querySelector<HTMLElement>('[aria-label="문서 편집 입력"]');
  if (!editorInput) throw new Error('Editor clipboard input is missing');
  let revision = 0;
  let pending = false;
  const invalidate = () => { revision++; };
  const unsubscribe = ['document-changed', 'document-mutated', 'document-swapped']
    .map(event => eventBus.on(event, invalidate));
  const onPaste = (event: ClipboardEvent) => {
    if (!canPasteImage(input)) return;
    const clipboard = event.clipboardData;
    if (!clipboard || /<!--\s*rhwp-studio-clipboard:/.test(clipboard.getData('text/html'))
      || (wasm.clipboardHasControl() && clipboard.getData('text/plain') === wasm.getClipboardText())) return;
    const file = Array.from(clipboard.items)
      .find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    if (!file) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pending) { onError(); return; }
    const position = structuredClone(input.getCursorPosition());
    const selection = structuredClone(input.getSelection());
    const capturedRevision = revision;
    const generation = wasm.documentGeneration;
    pending = true;
    void readImage(file).then(image => {
      // Cursor movement is safe; edits or document replacement invalidate the saved target.
      if (capturedRevision !== revision || generation !== wasm.documentGeneration
        || !canPasteImage(input)) { onError(); return; }
      let applied = false;
      input.executeOperation({
        kind: 'snapshot', operationType: 'pasteImage',
        selectionBefore: selection ? { ...selection, blockPhase: null } : null,
        operation: bridge => {
          const next = insertInlineClipboardImage(
            bridge, selection ? replaceSelection(bridge, selection) : position, image,
          );
          applied = true;
          return next;
        },
      });
      if (!applied) onError();
    }).catch(onError).finally(() => { pending = false; });
  };
  editorInput.addEventListener('paste', onPaste, true);
  return () => {
    invalidate();
    unsubscribe.forEach(off => off());
    editorInput.removeEventListener('paste', onPaste, true);
  };
}
