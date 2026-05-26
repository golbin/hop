import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upstreamCancelReRenderMock = vi.hoisted(() => vi.fn());
const upstreamCancelAllMock = vi.hoisted(() => vi.fn());

type MockNode = {
  style: Record<string, string>;
  dataset: Record<string, string>;
  children: MockNode[];
  parentElement: MockNode | null;
  appendChild: (child: MockNode) => MockNode;
  removeChild: (child: MockNode) => void;
  remove: () => void;
};

function createMockNode(): MockNode {
  const node: MockNode = {
    style: {},
    dataset: {},
    children: [],
    parentElement: null,
    appendChild(child) {
      child.parentElement = node;
      node.children.push(child);
      return child;
    },
    removeChild(child) {
      node.children = node.children.filter((candidate) => candidate !== child);
      child.parentElement = null;
    },
    remove() {
      node.parentElement?.removeChild(node);
    },
  };
  return node;
}

vi.mock('@upstream/view/page-renderer', () => ({
  PageRenderer: class MockPageRenderer {
    private timers = new Map<number, ReturnType<typeof setTimeout>[]>();

    constructor(private wasm: {
      renderPageToCanvasFiltered: (
        pageIdx: number,
        canvas: HTMLCanvasElement,
        scale: number,
        layerKind: string,
      ) => void;
      renderPageToCanvas: (
        pageIdx: number,
        canvas: HTMLCanvasElement,
        scale: number,
      ) => void;
    }) {}

    renderPage(pageIdx: number, canvas: HTMLCanvasElement, scale: number): void {
      this.renderFlow(pageIdx, canvas, scale);
      if (canvas.parentElement) {
        const overlay = createMockNode();
        overlay.dataset.rhwpOverlay = `front-${pageIdx}`;
        canvas.parentElement.appendChild(overlay as unknown as Node);
      }
      this.scheduleFullReRender(pageIdx, canvas, scale);
    }

    renderPageFlow(pageIdx: number, canvas: HTMLCanvasElement, scale: number): void {
      this.renderFlow(pageIdx, canvas, scale);
      this.scheduleFullReRender(pageIdx, canvas, scale);
    }

    cancelReRender(pageIdx: number): void {
      upstreamCancelReRenderMock(pageIdx);
      const timers = this.timers.get(pageIdx);
      if (timers) {
        for (const timer of timers) clearTimeout(timer);
        this.timers.delete(pageIdx);
      }
    }

    cancelAll(): void {
      upstreamCancelAllMock();
      for (const timers of this.timers.values()) {
        for (const timer of timers) clearTimeout(timer);
      }
      this.timers.clear();
    }

    private renderFlow(pageIdx: number, canvas: HTMLCanvasElement, scale: number): void {
      this.wasm.renderPageToCanvasFiltered(pageIdx, canvas, scale, 'flow');
      canvas.width = Math.round(1000 * scale);
      canvas.height = Math.round(1400 * scale);
    }

    private scheduleFullReRender(
      pageIdx: number,
      canvas: HTMLCanvasElement,
      scale: number,
    ): void {
      const timer = setTimeout(() => {
        if (canvas.parentElement) {
          this.wasm.renderPageToCanvas(pageIdx, canvas, scale);
        }
      }, 200);
      this.timers.set(pageIdx, [timer]);
    }
  },
}));

import { HopPageRenderer } from './hop-page-renderer';

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

describe('HopPageRenderer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    upstreamCancelReRenderMock.mockReset();
    upstreamCancelAllMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps initial and delayed renders on the filtered flow layer', () => {
    const wasm = {
      renderPageToCanvasFiltered: vi.fn(),
      renderPageToCanvas: vi.fn(),
    };
    const parent = createMockNode();
    const canvas = createMockCanvas();
    parent.appendChild(canvas as unknown as MockNode);

    const renderer = new HopPageRenderer(wasm as never);
    renderer.renderPage(0, canvas, 2, 2, 1);

    expect(parent.children[1].dataset.rhwpOverlay).toBe('front-0');
    expect(wasm.renderPageToCanvasFiltered).toHaveBeenCalledTimes(1);
    expect(wasm.renderPageToCanvasFiltered).toHaveBeenLastCalledWith(0, canvas, 2, 'flow');
    expect(upstreamCancelReRenderMock).toHaveBeenCalledWith(0);

    vi.advanceTimersByTime(200);
    expect(wasm.renderPageToCanvasFiltered).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(400);
    expect(wasm.renderPageToCanvasFiltered).toHaveBeenCalledTimes(3);
    expect(wasm.renderPageToCanvas).not.toHaveBeenCalled();
  });

  it('cancels pending delayed flow renders when the page is released', () => {
    const wasm = {
      renderPageToCanvasFiltered: vi.fn(),
      renderPageToCanvas: vi.fn(),
    };
    const parent = createMockNode();
    const canvas = createMockCanvas();
    parent.appendChild(canvas as unknown as MockNode);

    const renderer = new HopPageRenderer(wasm as never);
    renderer.renderPage(0, canvas, 2, 2, 1);
    renderer.cancelReRender(0);

    vi.advanceTimersByTime(600);

    expect(wasm.renderPageToCanvasFiltered).toHaveBeenCalledTimes(1);
    expect(wasm.renderPageToCanvas).not.toHaveBeenCalled();
    expect(upstreamCancelReRenderMock).toHaveBeenCalledWith(0);
  });
});
