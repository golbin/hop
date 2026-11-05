import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupTextColorPicker } from './text-color-picker';

class Element extends EventTarget {
  children: Element[] = [];
  style = { background: '' };
  attrs = new Map<string, string>();
  hidden = false;
  value = '#000000';
  id = '';
  className = '';
  type = '';
  title = '';
  textContent = '';
  focus = vi.fn();
  click = vi.fn(() => this.dispatchEvent(new Event('click')));

  constructor(readonly tagName = 'div') { super(); }
  appendChild(child: Element) { this.children.push(child); }
  replaceChildren(...children: Element[]) { this.children = children; this.textContent = ''; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  contains(target: Element | null): boolean {
    return this === target || this.children.some((child) => child.contains(target));
  }
  querySelector(selector: string): Element | undefined {
    for (const child of this.children) {
      if (selector === `#${child.id}` || selector === child.tagName) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
  }
}

function createPicker(storage = new Map<string, string>()) {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  });
  const doc = Object.assign(new Element(), { createElement: (tag: string) => new Element(tag) });
  vi.stubGlobal('document', doc);
  const container = new Element();
  const button = new Element('button');
  button.id = 'btn-text-color';
  const picker = new Element('input');
  picker.id = 'text-color-picker';
  [button, picker].forEach((element) => container.appendChild(element));
  const onSelect = vi.fn();
  setupTextColorPicker(container as unknown as HTMLElement, onSelect);
  const palette = container.querySelector('#text-color-palette')!;
  const recentRow = palette.querySelector('#recent-text-colors')!.children[1];
  return { doc, container, button, picker, palette, recentRow, onSelect, storage };
}

afterEach(() => vi.unstubAllGlobals());

describe('text color palette', () => {
  it('opens an in-app palette without invoking the native picker and preserves the selection', () => {
    const { container, button, picker, palette } = createPicker();
    const down = new Event('mousedown', { cancelable: true });
    container.dispatchEvent(down);
    button.click();
    expect(down.defaultPrevented).toBe(true);
    expect(palette.hidden).toBe(false);
    expect(button.attrs.get('aria-expanded')).toBe('true');
    expect(picker.click).not.toHaveBeenCalled();
    button.click();
    expect(palette.hidden).toBe(true);
  });

  it('applies a swatch once, updates the custom picker, and closes', () => {
    const { button, picker, palette, onSelect } = createPicker();
    button.click();
    const red = palette.children[1].children[0];
    red.click();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('#ff0000');
    expect(picker.value).toBe('#ff0000');
    expect(palette.hidden).toBe(true);
    expect(button.attrs.get('aria-expanded')).toBe('false');
  });

  it('preserves custom color selection', () => {
    const { button, picker, palette, onSelect } = createPicker();
    button.click();
    palette.children.at(-1)!.children[0].click();
    expect(picker.click).toHaveBeenCalledOnce();
    picker.value = '#123456';
    picker.dispatchEvent(new Event('input'));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('#123456');
    expect(palette.hidden).toBe(true);
  });

  it('supports keyboard opening and Escape, and closes on an outside click', () => {
    const { doc, container, button, palette, onSelect } = createPicker();
    button.click();
    const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    container.dispatchEvent(escape);
    expect(palette.hidden).toBe(true);
    expect(button.focus).toHaveBeenCalledOnce();
    const arrow = Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowDown' });
    Object.defineProperty(arrow, 'target', { value: button });
    container.dispatchEvent(arrow);
    expect(palette.hidden).toBe(false);
    expect(palette.children[0].children[0].focus).toHaveBeenCalledOnce();
    doc.dispatchEvent(new Event('mousedown'));
    expect(palette.hidden).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('remembers custom colors, restores them on reopening, and reuses a recent swatch', () => {
    const { picker, recentRow, storage } = createPicker();
    expect(recentRow.textContent).toBe('아직 없음');
    picker.value = '#123456';
    picker.dispatchEvent(new Event('input'));
    expect(recentRow.children[0].attrs.get('aria-label')).toBe('#123456');
    const reopened = createPicker(storage);
    reopened.button.click();
    reopened.recentRow.children[0].click();
    expect(reopened.onSelect).toHaveBeenCalledExactlyOnceWith('#123456');
    expect(reopened.palette.hidden).toBe(true);
  });

  it('keeps seven unique colors with the most recently reused color first', () => {
    const { picker, recentRow, storage } = createPicker();
    for (let index = 1; index <= 8; index++) {
      picker.value = `#00000${index}`;
      picker.dispatchEvent(new Event('input'));
    }
    recentRow.children[2].click();
    expect(JSON.parse(storage.get('hop.recent-text-colors')!)).toEqual([
      '#000006', '#000008', '#000007', '#000005', '#000004', '#000003', '#000002',
    ]);
    expect(recentRow.children).toHaveLength(7);
  });

  it('ignores invalid stored entries and normalizes duplicate colors', () => {
    const { recentRow } = createPicker(new Map([
      ['hop.recent-text-colors', JSON.stringify(['#ABCDEF', null, 42, 'red', '#abcdef', '#123456'])],
    ]));
    expect(recentRow.children.map((swatch) => swatch.attrs.get('aria-label')))
      .toEqual(['#abcdef', '#123456']);
    expect(createPicker(new Map([['hop.recent-text-colors', '{broken']])).recentRow.children).toHaveLength(0);
  });

  it('keeps color selection and in-memory history working when storage is unavailable', () => {
    const { picker, button, recentRow, onSelect } = createPicker();
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    picker.value = '#123456';
    picker.dispatchEvent(new Event('input'));
    button.click();
    expect(recentRow.children[0].attrs.get('aria-label')).toBe('#123456');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('#123456');
  });
});
