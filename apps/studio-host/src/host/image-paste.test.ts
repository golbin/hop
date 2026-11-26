import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import init, { HwpDocument } from '../../vendor/rhwp-core/rhwp.js';
import { WasmBridge } from '@upstream/core/wasm-bridge';
import { EventBus } from '@upstream/core/event-bus';
import { SnapshotCommand } from '@upstream/engine/command';
import type { InputHandler } from '../upstream/editor';
import type { DocumentPosition } from '../upstream/core';
import { insertInlineClipboardImage, installImagePaste } from './image-paste';

const { readFileSync } = await vi.importActual<{ readFileSync: (path: URL) => Uint8Array }>('node:fs');
const image = {
  data: new Uint8Array(readFileSync(new URL('./fixtures/clipboard-image.png', import.meta.url))),
  width: 320, height: 160, extension: 'png',
};
const start = { sectionIndex: 0, paragraphIndex: 0, charOffset: 6 };

beforeAll(async () => {
  await init({ module_or_path: readFileSync(new URL('../../vendor/rhwp-core/rhwp_bg.wasm', import.meta.url)) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function documentBridge() {
  const wasm = new WasmBridge();
  wasm.createNewDocument();
  wasm.insertText(0, 0, 0, 'BEFOREAFTER');
  return wasm;
}

function documentText(wasm: WasmBridge): string {
  const reopened = new HwpDocument(wasm.exportHwp());
  try { return reopened.getTextFileText(); }
  finally { reopened.free(); }
}

describe('inline clipboard images with the shipped WASM', () => {
  it('places the image between the surrounding text and preserves it through HWP save/reopen', () => {
    const wasm = documentBridge();
    const position = insertInlineClipboardImage(wasm, start, image);
    expect(position).toEqual({ ...start, charOffset: 7 });
    const control = wasm.getPageControlLayout(0).controls.find(item => item.type === 'image')!;
    expect(control.x).toBeGreaterThan(0);
    expect(control.y).toBeGreaterThan(0);
    const reopened = new HwpDocument(wasm.exportHwp());
    try {
      expect(reopened.getTextFileText()).toContain('BEFOREAFTER');
      expect(JSON.parse(reopened.getPictureProperties(0, control.paraIdx!, control.controlIdx!)))
        .toMatchObject({ treatAsChar: true, width: 24000, height: 12000 });
      expect(reopened.renderPageSvg(0)).toContain('<image');
    } finally { reopened.free(); }
  });

  it('keeps an image inside the target table cell and fits its width without stretching', () => {
    const wasm = documentBridge();
    const table = wasm.createTable(0, 0, 6, 1, 2);
    const path = [{ controlIndex: table.controlIdx, cellIndex: 1, cellParaIndex: 0 }];
    const position = {
      sectionIndex: 0, paragraphIndex: 0, charOffset: 0,
      parentParaIndex: table.paraIdx, controlIndex: table.controlIdx,
      cellIndex: 1, cellParaIndex: 0, cellPath: path,
    };
    expect(insertInlineClipboardImage(wasm, position, { ...image, width: 3200, height: 1600 }))
      .toEqual({ ...position, charOffset: 1 });
    const properties = wasm.getCellPicturePropertiesByPath(0, table.paraIdx, path, 0);
    const cell = wasm.getCellProperties(0, table.paraIdx, table.controlIdx, 1);
    expect(properties.treatAsChar).toBe(true);
    expect(properties.width).toBeLessThanOrEqual(cell.width - cell.paddingLeft - cell.paddingRight);
    expect(properties.width / properties.height).toBeCloseTo(2, 2);
  });

  it('scales a tall image to the page while preserving the aspect ratio', () => {
    const wasm = documentBridge();
    insertInlineClipboardImage(wasm, start, { ...image, width: 320, height: 3200 });
    const control = wasm.getPageControlLayout(0).controls.find(item => item.type === 'image')!;
    const properties = wasm.getPictureProperties(0, control.paraIdx!, control.controlIdx!);
    const page = wasm.getPageDef(0);
    expect(properties.height).toBeLessThanOrEqual(
      page.height - page.marginTop - page.marginBottom - page.marginHeader - page.marginFooter,
    );
    expect(properties.width / properties.height).toBeCloseTo(0.1, 3);
  });
});

function pasteHarness() {
  const wasm = documentBridge();
  const eventBus = new EventBus();
  const target = new EventTarget();
  const container = { ownerDocument: { querySelector: () => target } } as unknown as HTMLElement;
  const onError = vi.fn();
  let position: DocumentPosition = { ...start };
  let selection: ReturnType<InputHandler['getSelection']> = null;
  const history: SnapshotCommand[] = [];
  const input = {
    isActive: () => true, isFormMode: () => false, isInSeparateCaretSpace: () => false,
    isInPictureObjectSelection: () => false, isInTableObjectSelection: () => false,
    getCursorPosition: () => position, getSelection: () => selection,
    executeOperation: vi.fn((descriptor: Parameters<InputHandler['executeOperation']>[0]) => {
      if (descriptor.kind !== 'snapshot') throw new Error('Expected a snapshot');
      const command = new SnapshotCommand(descriptor.operationType, position, position,
        descriptor.operation, descriptor.selectionBefore);
      position = command.execute(wasm);
      history.push(command);
      eventBus.emit('document-changed');
    }),
  };
  let decoded!: () => void;
  let rejectDecode!: (error: Error) => void;
  const decode = new Promise<void>((resolve, reject) => { decoded = resolve; rejectDecode = reject; });
  vi.stubGlobal('Image', class {
    src = ''; naturalWidth = 320; naturalHeight = 160;
    decode() { return decode; }
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:clipboard-image');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const dispose = installImagePaste(container, { input, wasm, eventBus, onError });
  const paste = (html = '', text = '') => {
    const event = new Event('paste', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => new File([image.data], 'image.png', { type: 'image/png' }) }],
      getData: (type: string) => type === 'text/html' ? html : text,
    } });
    target.dispatchEvent(event);
    return event;
  };
  return {
    wasm, input, eventBus, onError, history, paste, dispose, revoke, decoded, rejectDecode,
    move: (next: DocumentPosition) => { position = next; },
    select: (next: NonNullable<typeof selection>) => { selection = next; },
    position: () => position,
  };
}

describe('image paste event lifecycle', () => {
  it('captures the paste target before decoding even when the caret moves', async () => {
    const h = pasteHarness();
    expect(h.paste().defaultPrevented).toBe(true);
    h.move({ ...start, charOffset: 0 });
    h.decoded();
    await vi.waitFor(() => expect(h.history).toHaveLength(1));
    expect(h.position()).toEqual({ ...start, charOffset: 7 });
    expect(h.revoke).toHaveBeenCalledWith('blob:clipboard-image');
    expect(h.onError).not.toHaveBeenCalled();
  });

  it.each(['document-changed', 'document-mutated', 'document-swapped'])
  ('cancels pending images after %s', async event => {
    const h = pasteHarness();
    h.paste();
    h.eventBus.emit(event);
    h.decoded();
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledOnce());
    expect(h.input.executeOperation).not.toHaveBeenCalled();
  });

  it('replaces a selection with one undo/redo step', async () => {
    const h = pasteHarness();
    h.select({ start: { ...start, charOffset: 2 }, end: { ...start, charOffset: 6 } });
    h.paste(); h.decoded();
    await vi.waitFor(() => expect(h.history).toHaveLength(1));
    expect(documentText(h.wasm)).toContain('BEAFTER');
    h.history[0].undo(h.wasm);
    expect(documentText(h.wasm)).toContain('BEFOREAFTER');
    expect(h.wasm.getPageControlLayout(0).controls.some(c => c.type === 'image')).toBe(false);
    h.history[0].execute(h.wasm);
    expect(documentText(h.wasm)).toContain('BEAFTER');
    expect(h.wasm.getPageControlLayout(0).controls.some(c => c.type === 'image')).toBe(true);
  });

  it('does not paste into a replacement document before its UI event is emitted', async () => {
    const h = pasteHarness();
    h.paste();
    h.wasm.createNewDocument();
    h.decoded();
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledOnce());
    expect(h.input.executeOperation).not.toHaveBeenCalled();
  });

  it('rolls back selection deletion when insertion fails', async () => {
    const h = pasteHarness();
    h.select({ start: { ...start, charOffset: 2 }, end: { ...start, charOffset: 6 } });
    vi.spyOn(h.wasm, 'insertPicture').mockReturnValue({ ok: false, paraIdx: 0, controlIdx: 0 });
    h.paste(); h.decoded();
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledOnce());
    expect(documentText(h.wasm)).toContain('BEFOREAFTER');
    expect(h.history).toHaveLength(0);
  });

  it('releases the image URL and leaves the document unchanged after a decode failure', async () => {
    const h = pasteHarness();
    h.paste(); h.rejectDecode(new Error('Invalid image'));
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledOnce());
    expect(h.revoke).toHaveBeenCalled();
    expect(h.input.executeOperation).not.toHaveBeenCalled();
  });

  it('leaves internal clipboard images on the upstream path and removes listeners on disposal', () => {
    const h = pasteHarness();
    expect(h.paste('<!--rhwp-studio-clipboard:example-->').defaultPrevented).toBe(false);
    h.dispose();
    expect(h.paste().defaultPrevented).toBe(false);
  });
});
