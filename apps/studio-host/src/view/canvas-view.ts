import { WasmBridge } from '@upstream/core/wasm-bridge';
import { EventBus } from '@upstream/core/event-bus';
import type { PageInfo } from '@upstream/core/types';
import { VirtualScroll } from '@upstream/view/virtual-scroll';
import { CanvasPool } from '@upstream/view/canvas-pool';
import { PageRenderer } from '@upstream/view/page-renderer';
import { ViewportManager } from '@upstream/view/viewport-manager';
import { CoordinateSystem } from '@upstream/view/coordinate-system';

export function resolveCanvasLeft(
  pageLeft: number,
  viewportWidth: number,
  pageDisplayWidth: number,
): number {
  if (pageLeft >= 0) {
    return Math.round(pageLeft);
  }

  return Math.max(0, Math.round((viewportWidth - pageDisplayWidth) / 2));
}

export class CanvasView {
  private virtualScroll: VirtualScroll;
  private canvasPool: CanvasPool;
  private pageRenderer: PageRenderer;
  private viewportManager: ViewportManager;
  private coordinateSystem: CoordinateSystem;

  private scrollContent: HTMLElement;
  private pages: PageInfo[] = [];
  private currentVisiblePages: number[] = [];
  private unsubscribers: (() => void)[] = [];

  constructor(
    private container: HTMLElement,
    private wasm: WasmBridge,
    private eventBus: EventBus,
  ) {
    this.virtualScroll = new VirtualScroll();
    this.canvasPool = new CanvasPool();
    this.pageRenderer = new PageRenderer(wasm);
    this.viewportManager = new ViewportManager(eventBus);
    this.coordinateSystem = new CoordinateSystem(this.virtualScroll);

    this.scrollContent = container.querySelector('#scroll-content')!;
    this.viewportManager.attachTo(container);

    this.unsubscribers.push(
      eventBus.on('viewport-scroll', () => this.updateVisiblePages()),
      eventBus.on('viewport-resize', () => this.onViewportResize()),
      eventBus.on('zoom-changed', (zoom) => this.onZoomChanged(zoom as number)),
      eventBus.on('document-changed', () => this.refreshPages()),
    );
  }

  loadDocument(): void {
    this.reset();

    const pageCount = this.wasm.pageCount;
    this.pages = [];
    for (let i = 0; i < pageCount; i++) {
      try {
        this.pages.push(this.wasm.getPageInfo(i));
      } catch (e) {
        console.error(`[CanvasView] 페이지 ${i} 정보 조회 실패:`, e);
      }
    }

    if (this.pages.length === 0) {
      console.error('[CanvasView] 로드된 페이지가 없습니다');
      return;
    }

    if (window.innerWidth < 1024 && this.pages.length > 0) {
      const containerWidth = this.container.clientWidth - 20;
      const pageWidth = this.pages[0].width;
      if (pageWidth > 0 && containerWidth > 0) {
        const fitZoom = containerWidth / pageWidth;
        this.viewportManager.setZoom(Math.max(0.1, Math.min(fitZoom, 4.0)));
      }
    }

    this.recalcLayout();

    this.container.scrollTop = 0;
    this.updateVisiblePages();

    console.log(
      `[CanvasView] ${this.pages.length}/${pageCount}페이지 로드, 총 높이: ${this.virtualScroll.getTotalHeight()}px`,
    );
  }

  private recalcLayout(): void {
    const zoom = this.viewportManager.getZoom();
    const { width: vpWidth } = this.viewportManager.getViewportSize();
    this.virtualScroll.setPageDimensions(this.pages, zoom, vpWidth);
    this.scrollContent.style.height = `${this.virtualScroll.getTotalHeight()}px`;
    this.scrollContent.style.width = `${this.virtualScroll.getTotalWidth()}px`;
    this.scrollContent.classList.toggle('grid-mode', this.virtualScroll.isGridMode());
  }

  private updateVisiblePages(): void {
    const scrollY = this.viewportManager.getScrollY();
    const { height: vpHeight } = this.viewportManager.getViewportSize();

    const prefetchPages = this.virtualScroll.getPrefetchPages(scrollY, vpHeight);
    const visiblePages = this.virtualScroll.getVisiblePages(scrollY, vpHeight);

    const prefetchSet = new Set(prefetchPages);
    for (const pageIdx of this.canvasPool.activePages) {
      if (!prefetchSet.has(pageIdx)) {
        this.pageRenderer.cancelReRender(pageIdx);
        this.canvasPool.release(pageIdx);
      }
    }

    for (const pageIdx of prefetchPages) {
      if (!this.canvasPool.has(pageIdx)) {
        this.renderPage(pageIdx);
      }
    }

    if (visiblePages.length > 0) {
      const vpCenter = scrollY + vpHeight / 2;
      const currentPage = this.virtualScroll.getPageAtY(vpCenter);
      this.eventBus.emit(
        'current-page-changed',
        currentPage,
        this.virtualScroll.pageCount,
      );
    }

    this.currentVisiblePages = visiblePages;
  }

  private renderPage(pageIdx: number): void {
    const canvas = this.canvasPool.acquire(pageIdx);
    const zoom = this.viewportManager.getZoom();
    const rawDpr = window.devicePixelRatio || 1;

    const pageInfo = this.pages[pageIdx];
    const MAX_CANVAS_PIXELS = 67108864;
    let dpr = rawDpr;
    if (pageInfo) {
      const physW = pageInfo.width * zoom * dpr;
      const physH = pageInfo.height * zoom * dpr;
      if (physW * physH > MAX_CANVAS_PIXELS) {
        dpr = Math.sqrt(MAX_CANVAS_PIXELS / (pageInfo.width * zoom * pageInfo.height * zoom));
        dpr = Math.max(1, Math.floor(dpr));
      }
    }
    const renderScale = zoom * dpr;

    canvas.style.top = `${this.virtualScroll.getPageOffset(pageIdx)}px`;

    try {
      this.pageRenderer.renderPage(pageIdx, canvas, renderScale);
    } catch (e) {
      console.error(`[CanvasView] 페이지 ${pageIdx} 렌더링 실패:`, e);
      this.canvasPool.release(pageIdx);
      return;
    }

    const pageDisplayWidth = canvas.width / dpr;
    const pageLeft = this.virtualScroll.getPageLeft(pageIdx);
    const { width: viewportWidth } = this.viewportManager.getViewportSize();

    canvas.style.left = `${resolveCanvasLeft(pageLeft, viewportWidth, pageDisplayWidth)}px`;
    canvas.style.transform = 'none';
    canvas.style.width = `${pageDisplayWidth}px`;
    canvas.style.height = `${canvas.height / dpr}px`;

    this.scrollContent.appendChild(canvas);
  }

  private onViewportResize(): void {
    if (this.pages.length === 0) {
      this.updateVisiblePages();
      return;
    }

    const wasGrid = this.virtualScroll.isGridMode();
    this.recalcLayout();
    const isGrid = this.virtualScroll.isGridMode();

    if (wasGrid || isGrid) {
      this.canvasPool.releaseAll();
      this.pageRenderer.cancelAll();
    }
    this.updateVisiblePages();
  }

  private onZoomChanged(zoom: number): void {
    if (this.pages.length === 0) return;

    const scrollY = this.viewportManager.getScrollY();
    const { height: vpHeight } = this.viewportManager.getViewportSize();
    const vpCenter = scrollY + vpHeight / 2;
    const focusPage = this.virtualScroll.getPageAtY(vpCenter);
    const oldOffset = this.virtualScroll.getPageOffset(focusPage);
    const relativeY = vpCenter - oldOffset;
    const oldHeight = this.virtualScroll.getPageHeight(focusPage);
    const ratio = oldHeight > 0 ? relativeY / oldHeight : 0;

    this.recalcLayout();

    const newOffset = this.virtualScroll.getPageOffset(focusPage);
    const newHeight = this.virtualScroll.getPageHeight(focusPage);
    const newCenter = newOffset + newHeight * ratio;
    this.viewportManager.setScrollTop(newCenter - vpHeight / 2);

    this.canvasPool.releaseAll();
    this.pageRenderer.cancelAll();
    this.updateVisiblePages();

    this.eventBus.emit('zoom-level-display', zoom);
  }

  refreshPages(): void {
    if (this.pages.length === 0) return;

    const pageCount = this.wasm.pageCount;
    this.pages = [];
    for (let i = 0; i < pageCount; i++) {
      try {
        this.pages.push(this.wasm.getPageInfo(i));
      } catch (e) {
        console.error(`[CanvasView] 페이지 ${i} 정보 조회 실패:`, e);
      }
    }

    this.recalcLayout();
    this.canvasPool.releaseAll();
    this.pageRenderer.cancelAll();
    this.updateVisiblePages();
  }

  private reset(): void {
    this.pageRenderer.cancelAll();
    this.canvasPool.releaseAll();
    this.currentVisiblePages = [];
    this.pages = [];
    this.scrollContent.innerHTML = '';
  }

  dispose(): void {
    this.reset();
    this.viewportManager.detach();
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  getVirtualScroll(): VirtualScroll {
    return this.virtualScroll;
  }

  getViewportManager(): ViewportManager {
    return this.viewportManager;
  }

  getCoordinateSystem(): CoordinateSystem {
    return this.coordinateSystem;
  }
}
