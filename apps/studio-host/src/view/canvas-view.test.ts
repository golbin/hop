import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@upstream/core/event-bus';

const renderPageMock = vi.hoisted(() => vi.fn());
const renderPageParentMock = vi.hoisted(() => vi.fn());
const viewportState = vi.hoisted(() => ({ width: 1041, height: 900 }));
const scrollContentState = vi.hoisted(() => ({ width: 1041 }));

vi.mock('@upstream/view/virtual-scroll', () => ({
  VirtualScroll: class MockVirtualScroll {
    private viewportWidth = viewportState.width;

    setPageDimensions(): void {
      this.viewportWidth = viewportState.width;
    }

    getTotalHeight(): number {
      return 1510;
    }

    getTotalWidth(): number {
      return this.viewportWidth;
    }

    isGridMode(): boolean {
      return false;
    }

    getPrefetchPages(): number[] {
      return [0];
    }

    getVisiblePages(): number[] {
      return [0];
    }

    getPageAtY(): number {
      return 0;
    }

    getPageOffset(): number {
      return 10;
    }

    getPageHeight(): number {
      return 1400;
    }

    getPageWidth(): number {
      return 1000;
    }

    getPageLeft(): number {
      return -1;
    }

    get pageCount(): number {
      return 1;
    }
  },
}));

vi.mock('@upstream/view/canvas-pool', () => ({
  CanvasPool: class MockCanvasPool {
    private inUse = new Map<number, HTMLCanvasElement>();

    acquire(pageIdx: number): HTMLCanvasElement {
      const canvas = this.inUse.get(pageIdx) ?? createMockCanvas();
      this.inUse.set(pageIdx, canvas);
      return canvas;
    }

    release(pageIdx: number): void {
      const canvas = this.inUse.get(pageIdx);
      canvas?.remove();
      this.inUse.delete(pageIdx);
    }

    releaseAll(): void {
      for (const pageIdx of this.inUse.keys()) {
        this.release(pageIdx);
      }
    }

    has(pageIdx: number): boolean {
      return this.inUse.has(pageIdx);
    }

    getCanvas(pageIdx: number): HTMLCanvasElement | undefined {
      return this.inUse.get(pageIdx);
    }

    get activePages(): number[] {
      return Array.from(this.inUse.keys());
    }
  },
}));

vi.mock('@upstream/view/page-renderer', () => ({
  PageRenderer: class MockPageRenderer {
    renderPage(pageIdx: number, canvas: HTMLCanvasElement, scale: number): void {
      renderPageMock(pageIdx, scale);
      renderPageParentMock(Boolean(canvas.parentElement), canvas.style.left);
      canvas.width = Math.round(1000 * scale);
      canvas.height = Math.round(1400 * scale);
      const parent = canvas.parentElement as unknown as MockNode | null;
      const overlay = createMockNode();
      overlay.dataset = { rhwpOverlay: `front-${pageIdx}` };
      parent?.appendChild(overlay);
    }

    renderPageFlow(pageIdx: number, canvas: HTMLCanvasElement, scale: number): void {
      renderPageMock(pageIdx, scale);
      canvas.width = Math.round(1000 * scale);
      canvas.height = Math.round(1400 * scale);
    }

    cancelReRender(): void {}

    cancelAll(): void {}
  },
}));

vi.mock('@upstream/view/viewport-manager', () => ({
  ViewportManager: class MockViewportManager {
    attachTo(): void {}

    detach(): void {}

    getZoom(): number {
      return 1;
    }

    getViewportSize(): { width: number; height: number } {
      return { width: viewportState.width, height: viewportState.height };
    }

    getScrollY(): number {
      return 0;
    }

    setZoom(): void {}

    setScrollTop(): void {}
  },
}));

vi.mock('@upstream/view/coordinate-system', () => ({
  CoordinateSystem: class MockCoordinateSystem {},
}));

import {
  CanvasView,
} from './canvas-view';
import {
  applyCanvasDisplayLayout,
  inferCanvasDevicePixelRatio,
} from './canvas-layout';

type MockNode = {
  id?: string;
  style: Record<string, string>;
  children: MockNode[];
  parentElement: MockNode | null;
  dataset?: Record<string, string>;
  clientWidth: number;
  scrollTop: number;
  innerHTML: string;
  classList: { toggle: (name: string, value: boolean) => void };
  appendChild: (child: MockNode) => MockNode;
  removeChild: (child: MockNode) => void;
  replaceChildren: (...children: MockNode[]) => void;
  remove: () => void;
  querySelector: (selector: string) => MockNode | null;
  querySelectorAll: (selector: string) => MockNode[];
};

function createMockNode(id?: string): MockNode {
  const node: MockNode = {
    id,
    style: {},
    children: [],
    parentElement: null,
    clientWidth: 0,
    scrollTop: 0,
    innerHTML: '',
    classList: { toggle: () => undefined },
    appendChild(child) {
      child.parentElement = node;
      node.children.push(child);
      return child;
    },
    removeChild(child) {
      node.children = node.children.filter((candidate) => candidate !== child);
      child.parentElement = null;
    },
    replaceChildren(...children) {
      for (const child of node.children) {
        child.parentElement = null;
      }
      node.children = [];
      node.innerHTML = '';
      for (const child of children) {
        node.appendChild(child);
      }
    },
    remove() {
      node.parentElement?.removeChild(node);
    },
    querySelector(selector) {
      if (selector === '#scroll-content') {
        return node.children.find((child) => child.id === 'scroll-content') ?? null;
      }
      if (selector === 'canvas') {
        return node.children.find((child) => 'width' in child) ?? null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-rhwp-overlay]') {
        return node.children.filter((child) => child.dataset?.rhwpOverlay);
      }
      const overlayIds = Array.from(selector.matchAll(/data-rhwp-overlay="([^"]+)"/g))
        .map((match) => match[1]);
      if (overlayIds.length > 0) {
        return node.children.filter((child) => {
          const id = child.dataset?.rhwpOverlay;
          return Boolean(id && overlayIds.includes(id));
        });
      }
      return [];
    },
  };

  return node;
}

function createMockCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    style: {},
    parentElement: null,
    remove() {
      const parent = this.parentElement as unknown as MockNode | null;
      parent?.removeChild(this as unknown as MockNode);
    },
  } as HTMLCanvasElement;
}

describe('applyCanvasDisplayLayout', () => {
  it('centers and sizes an already-rendered canvas in single-column mode', () => {
    const canvas = createMockCanvas();
    canvas.width = 2000;
    canvas.height = 2800;

    const layout = {
      getPageOffset: () => 10,
      getPageLeft: () => -1,
      getPageWidth: () => 1000,
    };

    applyCanvasDisplayLayout(canvas, layout, 0, 1200, 2);

    expect(canvas.style.top).toBe('10px');
    expect(canvas.style.left).toBe('100px');
    expect(canvas.style.width).toBe('1000px');
    expect(canvas.style.height).toBe('1400px');
    expect(canvas.style.transform).toBe('none');
  });
});

describe('inferCanvasDevicePixelRatio', () => {
  it('uses rendered canvas width when it matches the page width scale', () => {
    const canvas = createMockCanvas();
    canvas.width = 1500;

    const layout = {
      getPageOffset: () => 0,
      getPageLeft: () => 0,
      getPageWidth: () => 1000,
    };

    expect(inferCanvasDevicePixelRatio(canvas, layout, 0, 2)).toBe(1.5);
  });
});

describe('CanvasView viewport resize behavior', () => {
  beforeEach(() => {
    renderPageMock.mockReset();
    renderPageParentMock.mockReset();
    viewportState.width = 1041;
    viewportState.height = 900;
    scrollContentState.width = 1041;
    (globalThis as { window?: unknown }).window = {
      innerWidth: 1400,
      devicePixelRatio: 2,
    };
  });

  it('repositions active canvases on single-column resize without rerendering them', () => {
    const container = createMockNode();
    const scrollContent = createMockNode('scroll-content');
    container.clientWidth = 1041;
    scrollContent.clientWidth = scrollContentState.width;
    Object.defineProperty(scrollContent, 'clientWidth', {
      configurable: true,
      get: () => scrollContentState.width,
    });
    container.appendChild(scrollContent);

    const wasm = {
      pageCount: 1,
      getPageInfo: () => ({
        pageIndex: 0,
        width: 1000,
        height: 1400,
        sectionIndex: 0,
        marginLeft: 0,
        marginRight: 0,
        marginTop: 0,
        marginBottom: 0,
        marginHeader: 0,
        marginFooter: 0,
      }),
    };

    const eventBus = new EventBus();
    const view = new CanvasView(container as unknown as HTMLElement, wasm as never, eventBus);

    view.loadDocument();

    const canvas = scrollContent.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.style.left).toBe('21px');
    expect(renderPageMock).toHaveBeenCalledTimes(1);
    expect(renderPageParentMock).toHaveBeenCalledWith(true, '21px');
    const overlay = scrollContent.querySelectorAll('[data-rhwp-overlay]')[0];
    expect(overlay?.style.left).toBe('21px');

    viewportState.width = 1200;
    scrollContentState.width = 1200;
    eventBus.emit('viewport-resize', 1200, 900);

    expect(scrollContent.querySelector('canvas')).toBe(canvas);
    expect(canvas?.style.left).toBe('100px');
    expect(renderPageMock).toHaveBeenCalledTimes(1);
    expect(canvas?.style.width).toBe('1000px');
    expect(overlay?.style.left).toBe('100px');

    view.dispose();

    expect(scrollContent.querySelectorAll('[data-rhwp-overlay]')).toHaveLength(0);
  });

  it('refreshes pages when upstream view state changes', () => {
    const container = createMockNode();
    const scrollContent = createMockNode('scroll-content');
    container.clientWidth = 1041;
    scrollContent.clientWidth = scrollContentState.width;
    container.appendChild(scrollContent);

    const wasm = {
      pageCount: 1,
      getPageInfo: () => ({
        pageIndex: 0,
        width: 1000,
        height: 1400,
        sectionIndex: 0,
        marginLeft: 0,
        marginRight: 0,
        marginTop: 0,
        marginBottom: 0,
        marginHeader: 0,
        marginFooter: 0,
      }),
    };

    const eventBus = new EventBus();
    const view = new CanvasView(container as unknown as HTMLElement, wasm as never, eventBus);

    view.loadDocument();
    expect(renderPageMock).toHaveBeenCalledTimes(1);

    eventBus.emit('document-view-changed');

    expect(renderPageMock).toHaveBeenCalledTimes(2);
    expect(scrollContent.querySelectorAll('[data-rhwp-overlay]')).toHaveLength(1);

    view.dispose();
  });
});
