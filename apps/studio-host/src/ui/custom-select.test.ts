import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enhanceCustomSelects, getCustomSelectRoot, syncCustomSelect } from './custom-select';

class FakeElement {
  tagName: string;
  private _className = '';
  textContent: string | null = '';
  id = '';
  type = '';
  tabIndex = 0;
  disabled = false;
  value = '';
  hidden = false;
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Array<(event: unknown) => void>>();
  private classes = new Set<string>();
  private observer: { callback: MutationCallback } | null = null;

  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  get className(): string {
    return this._className;
  }

  set className(value: string) {
    this._className = value;
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  get classList() {
    const self = this;
    return {
      add(cls: string) {
        self.classes.add(cls);
        self._className = Array.from(self.classes).join(' ');
      },
      remove(cls: string) {
        self.classes.delete(cls);
        self._className = Array.from(self.classes).join(' ');
      },
      contains(cls: string) {
        return self.classes.has(cls);
      },
      toggle(cls: string, force?: boolean) {
        if (force === undefined) {
          if (self.classes.has(cls)) self.classes.delete(cls);
          else self.classes.add(cls);
        } else if (force) {
          self.classes.add(cls);
        } else {
          self.classes.delete(cls);
        }
        self._className = Array.from(self.classes).join(' ');
      },
    };
  }

  get selectedOptions(): FakeElement[] {
    return this.children.filter((c) => (c as unknown as { selected: boolean }).selected);
  }

  get options(): FakeElement[] {
    return this.children.filter((c) => c.tagName === 'OPTION');
  }

  get selectedIndex(): number {
    const opts = this.options;
    return opts.findIndex((o) => (o as unknown as { selected: boolean }).selected);
  }

  set selectedIndex(index: number) {
    const opts = this.options;
    opts.forEach((o, i) => {
      (o as unknown as { selected: boolean }).selected = i === index;
    });
  }

  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }

  addEventListener(type: string, listener: (event: unknown) => void, _capture?: boolean) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void, _capture?: boolean) {
    const listeners = this.listeners.get(type) ?? [];
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  }

  dispatchEvent(event: { type: string }) {
    this.listeners.get(event.type)?.forEach((fn) => fn(event));
  }

  append(...children: FakeElement[]) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }

  appendChild(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  before(newNode: FakeElement) {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx >= 0) {
        newNode.parentNode = this.parentNode;
        this.parentNode.children.splice(idx, 0, newNode);
      }
    }
  }

  contains(node: unknown): boolean {
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.allDescendants()) {
      if (matchesSelector(child, selector)) return child;
    }
    return null;
  }

  querySelectorAll<T = FakeElement>(selector: string): T[] {
    return this.allDescendants().filter((c) => matchesSelector(c, selector)) as T[];
  }

  focus() {}

  private allDescendants(): FakeElement[] {
    const result: FakeElement[] = [];
    for (const child of this.children) {
      result.push(child);
      result.push(...child.allDescendants());
    }
    return result;
  }
}

class FakeOption extends FakeElement {
  selected = false;

  constructor() {
    super('option');
  }
}

class FakeOptGroup extends FakeElement {
  label = '';

  constructor() {
    super('optgroup');
  }
}

function matchesSelector(el: FakeElement, selector: string): boolean {
  const parts = selector.split(',').map((s) => s.trim());
  return parts.some((part) => {
    const dotIdx = part.indexOf('.');
    if (dotIdx > 0) {
      const tag = part.slice(0, dotIdx).toUpperCase();
      const cls = part.slice(dotIdx + 1);
      return el.tagName === tag && el.classList.contains(cls);
    }
    if (part.startsWith('.')) return el.classList.contains(part.slice(1));
    if (part.startsWith('#')) return el.id === part.slice(1);
    return el.tagName === part.toUpperCase();
  });
}

function createFakeSelect(className: string, options: string[] = []): FakeElement {
  const select = new FakeElement('select');
  select.className = className;
  (select as unknown as { multiple: boolean }).multiple = false;
  (select as unknown as { size: number }).size = 1;
  for (const text of options) {
    const opt = new FakeOption();
    opt.textContent = text;
    opt.value = text;
    select.appendChild(opt);
  }
  if (options.length > 0) {
    (select.children[0] as FakeOption).selected = true;
    select.value = options[0];
  }
  return select;
}

class FakeDocument {
  body = new FakeElement('body');
  head = new FakeElement('head');
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }

  addEventListener(type: string, listener: (event: unknown) => void, _capture?: boolean) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener() {}

  querySelectorAll<T = FakeElement>(selector: string): T[] {
    return this.body.querySelectorAll<T>(selector);
  }
}

class FakeMutationObserver {
  observe() {}
  disconnect() {}
}

describe('custom-select', () => {
  let fakeDocument: FakeDocument;

  beforeEach(() => {
    fakeDocument = new FakeDocument();
    (globalThis as Record<string, unknown>).document = fakeDocument;
    (globalThis as Record<string, unknown>).MutationObserver = FakeMutationObserver;
    (globalThis as Record<string, unknown>).HTMLOptGroupElement = FakeOptGroup;
    (globalThis as Record<string, unknown>).HTMLOptionElement = FakeOption;
    (globalThis as Record<string, unknown>).Event = class { type: string; bubbles: boolean; constructor(type: string, opts?: { bubbles?: boolean }) { this.type = type; this.bubbles = opts?.bubbles ?? false; } };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).MutationObserver;
    delete (globalThis as Record<string, unknown>).HTMLOptGroupElement;
    delete (globalThis as Record<string, unknown>).HTMLOptionElement;
    delete (globalThis as Record<string, unknown>).Event;
  });

  it('getCustomSelectRoot returns null for an unenhanced select', () => {
    const select = createFakeSelect('sb-combo');
    expect(getCustomSelectRoot(select as unknown as HTMLSelectElement)).toBeNull();
  });

  it('syncCustomSelect is a no-op for an unenhanced select', () => {
    const select = createFakeSelect('sb-combo');
    expect(() => syncCustomSelect(select as unknown as HTMLSelectElement)).not.toThrow();
  });

  it('skips selects that do not match supported class selectors', () => {
    const container = new FakeElement('div');
    const select = createFakeSelect('unsupported-class', ['A', 'B']);
    container.appendChild(select);

    enhanceCustomSelects(container as unknown as ParentNode);

    expect(getCustomSelectRoot(select as unknown as HTMLSelectElement)).toBeNull();
  });

  it('skips select elements with multiple attribute', () => {
    const container = new FakeElement('div');
    const select = createFakeSelect('sb-combo', ['A', 'B']);
    (select as unknown as { multiple: boolean }).multiple = true;
    container.appendChild(select);

    enhanceCustomSelects(container as unknown as ParentNode);

    expect(getCustomSelectRoot(select as unknown as HTMLSelectElement)).toBeNull();
  });

  it('skips select elements with size > 1', () => {
    const container = new FakeElement('div');
    const select = createFakeSelect('sb-combo', ['A', 'B']);
    (select as unknown as { size: number }).size = 5;
    container.appendChild(select);

    enhanceCustomSelects(container as unknown as ParentNode);

    expect(getCustomSelectRoot(select as unknown as HTMLSelectElement)).toBeNull();
  });

  it('skips select elements with data-native-select="true"', () => {
    const container = new FakeElement('div');
    const select = createFakeSelect('sb-combo', ['A', 'B']);
    select.dataset.nativeSelect = 'true';
    container.appendChild(select);

    enhanceCustomSelects(container as unknown as ParentNode);

    expect(getCustomSelectRoot(select as unknown as HTMLSelectElement)).toBeNull();
  });

  it('enhances a matching select and creates option rows with correct display', () => {
    const container = new FakeElement('div');
    const select = createFakeSelect('sb-combo', ['Option A', 'Option B']);
    container.appendChild(select);

    enhanceCustomSelects(container as unknown as ParentNode);

    const root = getCustomSelectRoot(select as unknown as HTMLSelectElement);
    expect(root).not.toBeNull();

    const rootEl = root as unknown as FakeElement;
    const menuRows = rootEl.querySelectorAll('.custom-select-option');
    expect(menuRows.length).toBe(2);
    expect((menuRows[0] as FakeElement).textContent).toBe('Option A');
    expect((menuRows[1] as FakeElement).textContent).toBe('Option B');

    const valueSpan = rootEl.querySelector('.custom-select-value');
    expect(valueSpan).not.toBeNull();
    expect((valueSpan as FakeElement).textContent).toBe('Option A');

    expect((menuRows[0] as FakeElement).classList.contains('selected')).toBe(true);
    expect((menuRows[1] as FakeElement).classList.contains('selected')).toBe(false);
  });

  it('does not enhance the same select twice (idempotent DOM)', () => {
    const container = new FakeElement('div');
    const select = createFakeSelect('dialog-select', ['A', 'B']);
    container.appendChild(select);

    enhanceCustomSelects(container as unknown as ParentNode);
    const root1 = getCustomSelectRoot(select as unknown as HTMLSelectElement);
    const rowsBefore = (root1 as unknown as FakeElement).querySelectorAll('.custom-select-option');

    enhanceCustomSelects(container as unknown as ParentNode);
    const root2 = getCustomSelectRoot(select as unknown as HTMLSelectElement);
    const rowsAfter = (root2 as unknown as FakeElement).querySelectorAll('.custom-select-option');

    expect(root1).toBe(root2);
    expect(rowsAfter.length).toBe(rowsBefore.length);
    expect(rowsAfter.length).toBe(2);
  });

  it('activates a trigger and commits an option through click without a mouse event', () => {
    const container = new FakeElement('div');
    const select = createFakeSelect('sb-combo', ['First', 'Second']);
    container.appendChild(select);
    const changed = vi.fn();
    select.addEventListener('change', changed);
    enhanceCustomSelects(container as unknown as ParentNode);
    const root = getCustomSelectRoot(select as unknown as HTMLSelectElement) as unknown as FakeElement;
    const trigger = root.querySelector('.custom-select-trigger')!;
    const panel = root.querySelector('.custom-select-menu')!;
    expect(root.tabIndex).toBe(-1);
    expect(select.tabIndex).toBe(-1);
    trigger.dispatchEvent({ type: 'click' });
    expect(panel.hidden).toBe(false);
    root.querySelectorAll<FakeElement>('.custom-select-option')[1].dispatchEvent({ type: 'click' });
    expect(select.value).toBe('Second');
    expect(changed).toHaveBeenCalledOnce();
    expect(panel.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes an open menu when its select is disabled', () => {
    const container = new FakeElement('div');
    const select = createFakeSelect('sb-combo', ['A', 'B']);
    container.appendChild(select);
    enhanceCustomSelects(container as unknown as ParentNode);
    const root = getCustomSelectRoot(select as unknown as HTMLSelectElement) as unknown as FakeElement;
    root.querySelector('.custom-select-trigger')!.dispatchEvent({ type: 'click' });
    select.disabled = true;
    syncCustomSelect(select as unknown as HTMLSelectElement);
    expect(root.querySelector('.custom-select-menu')!.hidden).toBe(true);
  });

  it('syncCustomSelect updates display text and selected class', () => {
    const container = new FakeElement('div');
    const select = createFakeSelect('sb-combo', ['First', 'Second']);
    container.appendChild(select);

    enhanceCustomSelects(container as unknown as ParentNode);

    (select.children[0] as FakeOption).selected = false;
    (select.children[1] as FakeOption).selected = true;
    select.value = 'Second';
    syncCustomSelect(select as unknown as HTMLSelectElement);

    const root = getCustomSelectRoot(select as unknown as HTMLSelectElement);
    const rootEl = root as unknown as FakeElement;

    const valueSpan = rootEl.querySelector('.custom-select-value');
    expect((valueSpan as FakeElement).textContent).toBe('Second');

    const menuRows = rootEl.querySelectorAll('.custom-select-option');
    expect((menuRows[0] as FakeElement).classList.contains('selected')).toBe(false);
    expect((menuRows[1] as FakeElement).classList.contains('selected')).toBe(true);
  });
});
