import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./custom-select', () => ({
  enhanceCustomSelects: vi.fn(),
}));

import { ModalDialog, MODAL_DIALOG_CLOSED_EVENT } from './dialog';

class FakeElement {
  className = '';
  textContent: string | null = '';
  id = '';
  disabled = false;
  isConnected = true;
  children: FakeElement[] = [];
  style: Record<string, string> = {};
  parentNode: FakeElement | null = null;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Array<(event: unknown) => void>>();
  private classes = new Set<string>();

  get classList() {
    const self = this;
    return {
      add(cls: string) { self.classes.add(cls); },
      remove(cls: string) { self.classes.delete(cls); },
      contains(cls: string) {
        return self.classes.has(cls) || self.className.split(/\s+/).includes(cls);
      },
    };
  }

  click(): void {
    this.listeners.get('click')?.forEach((fn) => fn({}));
  }

  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }

  appendChild(child: FakeElement): FakeElement {
    if (child.parentNode) {
      const idx = child.parentNode.children.indexOf(child);
      if (idx >= 0) child.parentNode.children.splice(idx, 1);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: (event: unknown) => void, capture?: boolean) {
    const key = capture ? `${type}:capture` : type;
    const list = this.listeners.get(key) ?? [];
    list.push(listener);
    this.listeners.set(key, list);
  }

  removeEventListener(type: string, listener: (event: unknown) => void, capture?: boolean) {
    const key = capture ? `${type}:capture` : type;
    const list = this.listeners.get(key) ?? [];
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  }

  dispatchCapture(type: string, event: unknown) {
    this.listeners.get(`${type}:capture`)?.forEach((fn) => fn(event));
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.allDescendants()) {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (child.classList.contains(cls) || child.className.split(/\s+/).includes(cls)) {
          return child;
        }
      }
    }
    return null;
  }

  remove(): void {
    this.isConnected = false;
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx >= 0) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
  }

  focus(): void {}

  private allDescendants(): FakeElement[] {
    const result: FakeElement[] = [];
    for (const child of this.children) {
      result.push(child);
      result.push(...child.allDescendants());
    }
    return result;
  }
}

class FakeDocument {
  body = new FakeElement();
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  createElement(_tag: string): FakeElement {
    return new FakeElement();
  }

  querySelector(selector: string): FakeElement | null {
    return this.body.querySelector(selector);
  }

  dispatchEvent(event: Event): boolean {
    this.listeners.get(event.type)?.forEach((fn) => fn(event));
    return true;
  }

  addEventListener(type: string, listener: (event: unknown) => void, capture?: boolean) {
    const key = capture ? `${type}:capture` : type;
    const list = this.listeners.get(key) ?? [];
    list.push(listener);
    this.listeners.set(key, list);
  }

  removeEventListener(type: string, listener: (event: unknown) => void, capture?: boolean) {
    const key = capture ? `${type}:capture` : type;
    const list = this.listeners.get(key) ?? [];
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  }

  dispatchCapture(type: string, event: unknown) {
    this.listeners.get(`${type}:capture`)?.forEach((fn) => fn(event));
  }
}

class TestDialog extends ModalDialog {
  confirmResult: void | boolean | Promise<void | boolean> = undefined;
  bodyElement = new FakeElement();

  constructor(title = 'Test', width = 400) {
    super(title, width);
  }

  protected createBody(): HTMLElement {
    this.bodyElement.classList.add('test-body');
    return this.bodyElement as unknown as HTMLElement;
  }

  protected onConfirm(): void | boolean | Promise<void | boolean> {
    return this.confirmResult;
  }
}

class FakeHTMLInputElement {}
class FakeHTMLTextAreaElement {}

describe('ModalDialog', () => {
  let fakeDocument: FakeDocument;

  beforeEach(() => {
    fakeDocument = new FakeDocument();
    (globalThis as Record<string, unknown>).document = fakeDocument;
    (globalThis as Record<string, unknown>).HTMLInputElement = FakeHTMLInputElement;
    (globalThis as Record<string, unknown>).HTMLTextAreaElement = FakeHTMLTextAreaElement;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).HTMLInputElement;
    delete (globalThis as Record<string, unknown>).HTMLTextAreaElement;
  });

  it('appends overlay to document body on show', () => {
    const dialog = new TestDialog('My Title', 300);
    dialog.show();

    expect(fakeDocument.body.children.length).toBe(1);
    const overlay = fakeDocument.body.children[0];
    expect(overlay.className).toBe('modal-overlay');
  });

  it('creates dialog with correct title', () => {
    const dialog = new TestDialog('문서 설정', 500);
    dialog.show();

    const overlay = fakeDocument.body.children[0];
    const wrap = overlay.children[0];
    expect(wrap.className).toBe('dialog-wrap');
    expect(wrap.style.width).toBe('500px');

    const titleBar = wrap.children[0];
    expect(titleBar.className).toBe('dialog-title');
    expect(titleBar.textContent).toContain('문서 설정');
  });

  it('creates close button, body, and footer', () => {
    const dialog = new TestDialog();
    dialog.show();

    const overlay = fakeDocument.body.children[0];
    const wrap = overlay.children[0];

    expect(wrap.children.length).toBe(3);

    const titleBar = wrap.children[0];
    const closeBtn = titleBar.children[0];
    expect(closeBtn.className).toBe('dialog-close');
    expect(closeBtn.textContent).toBe('×');

    const body = wrap.children[1];
    expect(body.classList.contains('dialog-body')).toBe(true);

    const footer = wrap.children[2];
    expect(footer.className).toBe('dialog-footer');
    expect(footer.children.length).toBe(2);

    const confirmBtn = footer.children[0];
    expect(confirmBtn.textContent).toBe('확인');
    expect(confirmBtn.classList.contains('dialog-btn-primary')).toBe(true);

    const cancelBtn = footer.children[1];
    expect(cancelBtn.textContent).toBe('취소');
  });

  it('removes overlay on hide', () => {
    const dialog = new TestDialog();
    dialog.show();

    const overlay = fakeDocument.body.children[0];
    expect(overlay.isConnected).toBe(true);

    dialog.hide();
    expect(overlay.isConnected).toBe(false);
  });

  it('requests editor focus only after the last nested dialog closes', () => {
    const closed = vi.fn();
    fakeDocument.addEventListener(MODAL_DIALOG_CLOSED_EVENT, closed);
    const parent = new TestDialog();
    const child = new TestDialog();
    parent.show();
    child.show();
    child.hide();
    expect(closed).not.toHaveBeenCalled();
    parent.hide();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('Escape key triggers hide', () => {
    const dialog = new TestDialog();
    dialog.show();

    const overlay = fakeDocument.body.children[0];
    const event = {
      key: 'Escape',
      target: null,
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    };

    fakeDocument.dispatchCapture('keydown', event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(overlay.isConnected).toBe(false);
  });

  it('Enter key on non-input triggers confirm and closes dialog', async () => {
    const dialog = new TestDialog();
    dialog.show();

    const overlay = fakeDocument.body.children[0];
    const event = {
      key: 'Enter',
      target: { tagName: 'DIV' },
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    };

    fakeDocument.dispatchCapture('keydown', event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    await Promise.resolve();
    expect(overlay.isConnected).toBe(false);
  });

  it('does not build DOM twice on repeated show calls', () => {
    const dialog = new TestDialog();
    dialog.show();
    const overlay = fakeDocument.body.children[0];

    dialog.hide();
    dialog.show();

    expect(fakeDocument.body.children.length).toBe(1);
    expect(fakeDocument.body.children[0]).toBe(overlay);
  });

  it('stops propagation for all keyboard events while open', () => {
    const dialog = new TestDialog();
    dialog.show();

    const event = {
      key: 'a',
      target: { tagName: 'DIV' },
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    };

    fakeDocument.dispatchCapture('keydown', event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('allows typing in input elements', () => {
    const dialog = new TestDialog();
    dialog.show();

    const fakeInput = new FakeHTMLInputElement();
    const event = {
      key: 'a',
      target: fakeInput,
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    };

    fakeDocument.dispatchCapture('keydown', event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
