import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupColorPicker } from './color-picker';

class Element extends EventTarget {
  children: Element[] = [];
  style = { background: '' };
  attrs = new Map<string, string>();
  hidden = false;
  value = '#000000';
  id = '';
  className = '';
  type = '';
  disabled = false;
  parentElement: Element | null = null;
  classList = {
    add: (name: string) => { this.className += ` ${name}`; },
    toggle: (name: string, enabled: boolean) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    },
  };
  title = '';
  textContent = '';
  focus = vi.fn();
  click = vi.fn(() => this.dispatchEvent(new Event('click')));

  constructor(readonly tagName = 'div') { super(); }
  appendChild(child: Element) { child.parentElement = this; this.children.push(child); }
  append(...children: Element[]) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children: Element[]) { this.children = children; this.textContent = ''; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  contains(target: Element | null): boolean {
    return this === target || this.children.some((child) => child.contains(target));
  }
  querySelector(selector: string): Element | undefined {
    for (const child of this.children) {
      if (selector === `#${child.id}` || selector === child.tagName || child.className.split(' ').some(name => selector === `.${name}`)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
  }
}

function createDocument() {
  return Object.assign(new Element(), { createElement: (tag: string) => new Element(tag) });
}

function createPicker(
  storage = new Map<string, string>(),
  options: { remember: boolean; clear: boolean; documentVersion?: () => number } = { remember: true, clear: false },
  doc = createDocument(),
) {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  });
  vi.stubGlobal('document', doc);
  const container = new Element();
  const button = new Element('button');
  button.id = 'btn-text-color';
  const picker = new Element('input');
  [button, picker].forEach(element => container.appendChild(element));
  const onSelect = vi.fn();
  setupColorPicker(container as unknown as HTMLElement, onSelect, options);
  const palette = container.querySelector('#btn-text-color-palette')!;
  const recentRow = palette.querySelector('.hop-recent-colors')?.children[1];
  return { doc, container, button, picker, palette, recentRow, onSelect, storage };
}

function chooseCustom(control: ReturnType<typeof createPicker>, color: string) {
  control.button.click();
  control.palette.children.at(-1)!.children[0].click();
  control.picker.value = color;
  control.picker.dispatchEvent(new Event('change'));
}

afterEach(() => vi.unstubAllGlobals());

describe('color controls', () => {
  it('opens without invoking the native picker and preserves editor selection', () => {
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

  it('applies a swatch once and closes', () => {
    const { button, picker, palette, onSelect } = createPicker();
    button.click();
    palette.children[1].children[0].click();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('#ff0000');
    expect(picker.value).toBe('#ff0000');
    expect(palette.hidden).toBe(true);
    expect(button.attrs.get('aria-expanded')).toBe('false');
  });

  it('commits a native color once after an outside click closes the palette', () => {
    const { doc, button, picker, palette, onSelect } = createPicker();
    button.click();
    palette.children.at(-1)!.children[0].click();
    expect(picker.click).toHaveBeenCalledOnce();
    picker.value = '#123456';
    picker.dispatchEvent(new Event('input'));
    expect(onSelect).not.toHaveBeenCalled();
    doc.dispatchEvent(new Event('mousedown'));
    expect(palette.hidden).toBe(true);
    picker.dispatchEvent(new Event('change'));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('#123456');
    picker.dispatchEvent(new Event('change'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('applies later native changes while GTK keeps its chooser open', () => {
    const control = createPicker();
    chooseCustom(control, '#33cc66');
    control.picker.value = '#cc3333';
    control.picker.dispatchEvent(new Event('change'));
    control.picker.dispatchEvent(new Event('change'));
    expect(control.onSelect.mock.calls).toEqual([['#33cc66'], ['#cc3333']]);
    expect(control.recentRow?.children.map(child => child.attrs.get('aria-label')))
      .toEqual(['#cc3333', '#33cc66']);
  });

  it('does not edit when a native chooser closes without changing its color', () => {
    const { button, picker, palette, onSelect } = createPicker();
    button.click();
    palette.children.at(-1)!.children[0].click();
    picker.dispatchEvent(new Event('change'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([false, true])('ignores stale native results (previous commit: %s)', (committed) => {
    let version = 0;
    const control = createPicker(new Map(), {
      remember: true, clear: false, documentVersion: () => version,
    });
    control.button.click();
    control.palette.children.at(-1)!.children[0].click();
    if (committed) {
      control.picker.value = '#33cc66';
      control.picker.dispatchEvent(new Event('change'));
    }
    version += 1;
    control.picker.value = '#123456';
    control.picker.dispatchEvent(new Event('change'));
    expect(control.onSelect.mock.calls).toEqual(committed ? [['#33cc66']] : []);
    expect(control.recentRow?.children.map(child => child.attrs.get('aria-label')))
      .toEqual(committed ? ['#33cc66'] : []);
  });

  it('supports keyboard opening and Escape while editor focus is retained', () => {
    const { doc, button, palette } = createPicker();
    button.click();
    const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    doc.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(palette.hidden).toBe(true);
    expect(button.focus).toHaveBeenCalledOnce();
    const arrow = Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowDown' });
    button.dispatchEvent(arrow);
    expect(palette.hidden).toBe(false);
    expect(palette.children[0].children[0].focus).toHaveBeenCalledOnce();
  });

  it('switches popups without keeping an old popup open or stealing Escape', () => {
    const first = createPicker();
    const second = createPicker(first.storage, { remember: false, clear: true }, first.doc);
    first.button.click();
    second.button.click();
    expect(first.palette.hidden).toBe(true);
    expect(second.palette.hidden).toBe(false);
    first.doc.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(second.palette.hidden).toBe(true);
    expect(second.button.focus).toHaveBeenCalledOnce();
    expect(first.button.focus).not.toHaveBeenCalled();
  });

  it('dismisses on an outside mouse click or focus moving into a dialog', () => {
    const { doc, button, palette } = createPicker();
    for (const event of ['mousedown', 'focusin']) {
      button.click();
      doc.dispatchEvent(new Event(event));
      expect(palette.hidden).toBe(true);
    }
  });

  it('remembers seven unique colors, restores them, and reuses a recent swatch', () => {
    const first = createPicker();
    for (let index = 1; index <= 8; index++) chooseCustom(first, `#00000${index}`);
    first.recentRow!.children[2].click();
    const expected = ['#000006', '#000008', '#000007', '#000005', '#000004', '#000003', '#000002'];
    expect(JSON.parse(first.storage.get('hop.recent-text-colors')!)).toEqual(expected);
    const reopened = createPicker(first.storage);
    expect(reopened.recentRow!.children.map(swatch => swatch.attrs.get('aria-label'))).toEqual(expected);
    reopened.recentRow!.children[0].click();
    expect(reopened.onSelect).toHaveBeenCalledExactlyOnceWith('#000006');
  });

  it('ignores invalid stored colors and normalizes duplicate colors', () => {
    const { recentRow } = createPicker(new Map([
      ['hop.recent-text-colors', JSON.stringify(['#ABCDEF', null, 42, 'red', '#abcdef', '#123456'])],
    ]));
    expect(recentRow!.children.map(swatch => swatch.attrs.get('aria-label')))
      .toEqual(['#abcdef', '#123456']);
    expect(createPicker(new Map([['hop.recent-text-colors', '{broken']])).recentRow!.children).toHaveLength(0);
  });

  it('preserves in-memory recency when storage writes fail but reads succeed', () => {
    const control = createPicker(new Map([['hop.recent-text-colors', '["#000000"]']]));
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('quota'); });
    chooseCustom(control, '#123456');
    chooseCustom(control, '#abcdef');
    expect(control.recentRow!.children.map(swatch => swatch.attrs.get('aria-label')))
      .toEqual(['#abcdef', '#123456', '#000000']);
  });

  it('merges another window’s choices before saving', () => {
    const control = createPicker();
    control.storage.set('hop.recent-text-colors', '["#abcdef"]');
    chooseCustom(control, '#123456');
    expect(JSON.parse(control.storage.get('hop.recent-text-colors')!)).toEqual(['#123456', '#abcdef']);
  });

  it('supports highlight clearing without text-color history', () => {
    const { palette, onSelect } = createPicker(new Map(), { remember: false, clear: true });
    palette.children.at(-1)!.children[0].click();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('#ffffff');
    expect(palette.querySelector('.hop-recent-colors')).toBeUndefined();
  });

  it('does not open a disabled control', () => {
    const { button, palette } = createPicker();
    button.disabled = true;
    button.click();
    expect(palette.hidden).toBe(true);
  });
});
