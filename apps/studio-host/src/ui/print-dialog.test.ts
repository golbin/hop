import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageInfo } from '@/core/types';
import { isSafePrintSvgReference, openPrintDialog } from './print-dialog';

class FakeElement {
  id = '';
  className = '';
  textContent: string | null = '';
  hidden = false;
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  tagName: string;
  private attrs = new Map<string, string>();

  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  remove(): void {}

  querySelector(_selector: string): FakeElement | null {
    return null;
  }

  querySelectorAll(_selector: string): FakeElement[] {
    return [];
  }
}

class FakeDocument {
  head = new FakeElement('head');
  body = new FakeElement('body');

  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }

  getElementById(id: string): FakeElement | null {
    return findById(this.head, id) ?? findById(this.body, id) ?? null;
  }

  importNode(node: unknown, _deep: boolean): unknown {
    return node;
  }
}

function findById(root: FakeElement, id: string): FakeElement | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function makeFakeDOMParser(hasParseerror = false) {
  return class {
    parseFromString() {
      return {
        querySelector: (sel: string) => (hasParseerror && sel === 'parsererror' ? {} : null),
        documentElement: {
          tagName: hasParseerror ? 'html' : 'svg',
          querySelectorAll: () => [],
          attributes: [],
        },
      };
    }
  };
}

function pageInfo(overrides: Partial<PageInfo> = {}): PageInfo {
  return {
    pageIndex: 0,
    width: 595,
    height: 842,
    sectionIndex: 0,
    marginLeft: 0,
    marginRight: 0,
    marginTop: 0,
    marginBottom: 0,
    marginHeader: 0,
    marginFooter: 0,
    ...overrides,
  };
}

describe('isSafePrintSvgReference', () => {
  it('allows image data URIs emitted by rhwp SVG export', () => {
    expect(isSafePrintSvgReference('data:image/png;base64,AAAA')).toBe(true);
    expect(isSafePrintSvgReference('data:image/svg+xml;base64,PHN2Zy8+')).toBe(true);
  });

  it('rejects scriptable or remote references', () => {
    expect(isSafePrintSvgReference('javascript:alert(1)')).toBe(false);
    expect(isSafePrintSvgReference('https://example.com/image.png')).toBe(false);
  });
});

describe('openPrintDialog', () => {
  let fakeDocument: FakeDocument;
  let printMock: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    fakeDocument = new FakeDocument();
    printMock = vi.fn<() => void>();
    (globalThis as Record<string, unknown>).document = fakeDocument;
    (globalThis as Record<string, unknown>).window = {
      print: printMock,
      setTimeout: vi.fn(() => 0),
      clearTimeout: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).DOMParser = makeFakeDOMParser();
    (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: () => void) => {
      cb();
      return 0;
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).DOMParser;
    delete (globalThis as Record<string, unknown>).requestAnimationFrame;
  });

  it('returns immediately when page count is 0', async () => {
    const doc = {
      fileName: 'empty.hwp',
      pageCount: 0,
      getPageInfo: vi.fn(),
      renderPageSvg: vi.fn(),
    };

    await openPrintDialog(doc);

    expect(doc.getPageInfo).not.toHaveBeenCalled();
    expect(doc.renderPageSvg).not.toHaveBeenCalled();
    expect(printMock).not.toHaveBeenCalled();
  });

  it('calls onStatus with progress messages during preparation', async () => {
    const onStatus = vi.fn();
    const doc = {
      fileName: 'test.hwp',
      pageCount: 2,
      getPageInfo: vi.fn(() => pageInfo()),
      renderPageSvg: vi.fn(() => '<svg></svg>'),
    };

    await openPrintDialog(doc, { onStatus, print: printMock });

    expect(onStatus).toHaveBeenCalledWith('인쇄 준비 중... (1/2)');
    expect(onStatus).toHaveBeenCalledWith('인쇄 준비 중... (2/2)');
    expect(onStatus).toHaveBeenCalledWith('인쇄 대화상자를 여는 중...');
  });

  it('renders all pages via renderPageSvg', async () => {
    const doc = {
      fileName: 'test.hwp',
      pageCount: 3,
      getPageInfo: vi.fn(() => pageInfo()),
      renderPageSvg: vi.fn(() => '<svg></svg>'),
    };

    await openPrintDialog(doc, { print: printMock });

    expect(doc.renderPageSvg).toHaveBeenCalledTimes(3);
    expect(doc.renderPageSvg).toHaveBeenCalledWith(0);
    expect(doc.renderPageSvg).toHaveBeenCalledWith(1);
    expect(doc.renderPageSvg).toHaveBeenCalledWith(2);
  });

  it('rejects malformed SVG gracefully', async () => {
    (globalThis as Record<string, unknown>).DOMParser = makeFakeDOMParser(true);

    const doc = {
      fileName: 'bad.hwp',
      pageCount: 1,
      getPageInfo: vi.fn(() => pageInfo()),
      renderPageSvg: vi.fn(() => '<not-valid-svg>'),
    };

    await openPrintDialog(doc, { print: printMock });

    expect(doc.renderPageSvg).toHaveBeenCalledTimes(1);

    const printRoot = fakeDocument.body.children.find((c) => c.id === 'hop-print-root');
    expect(printRoot).toBeDefined();
    const pageDiv = printRoot!.children.find((c) => c.className === 'hop-print-page');
    expect(pageDiv).toBeDefined();
    expect(pageDiv!.children.length).toBe(0);

    expect(printMock).toHaveBeenCalled();

    const win = (globalThis as Record<string, unknown>).window as Record<string, ReturnType<typeof vi.fn>>;
    expect(win.addEventListener).toHaveBeenCalledWith('afterprint', expect.any(Function), { once: true });
  });
});
