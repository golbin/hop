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

function createPicker() {
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
  return { doc, container, button, picker, palette, onSelect };
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
});
