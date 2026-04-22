import type { SelectionRect } from '@/core/types';
import { VirtualScroll } from '@/view/virtual-scroll';
import { resolveVirtualScrollPageLeft } from '../view/page-left';

/** 선택 영역을 파란색 반투명 사각형으로 렌더링한다 */
export class SelectionRenderer {
  private layer: HTMLDivElement;
  private highlights: HTMLDivElement[] = [];

  constructor(
    private container: HTMLElement,
    private virtualScroll: VirtualScroll,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'selection-layer';
    this.layer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    const scrollContent = container.querySelector('#scroll-content');
    if (scrollContent) {
      scrollContent.appendChild(this.layer);
    }
  }

  /** 선택 사각형을 렌더링한다 */
  render(rects: SelectionRect[], zoom: number): void {
    this.clear();
    this.ensureAttached();

    const scrollContent = this.container.querySelector('#scroll-content');
    const contentWidth = scrollContent?.clientWidth ?? 0;

    for (const rect of rects) {
      const div = document.createElement('div');
      const pageOffset = this.virtualScroll.getPageOffset(rect.pageIndex);
      const pageLeft = resolveVirtualScrollPageLeft(
        this.virtualScroll,
        rect.pageIndex,
        contentWidth,
      );

      div.style.cssText =
        `position:absolute;background:rgba(51,144,255,0.35);pointer-events:none;` +
        `left:${pageLeft + rect.x * zoom}px;` +
        `top:${pageOffset + rect.y * zoom}px;` +
        `width:${rect.width * zoom}px;` +
        `height:${rect.height * zoom}px;`;
      this.layer.appendChild(div);
      this.highlights.push(div);
    }
  }

  /** 모든 하이라이트를 제거한다 */
  clear(): void {
    for (const div of this.highlights) {
      div.remove();
    }
    this.highlights = [];
  }

  /** 레이어가 DOM에 없으면 재부착한다 (loadDocument 후 innerHTML 초기화 대응) */
  private ensureAttached(): void {
    if (this.layer.parentElement) return;
    const scrollContent = this.container.querySelector('#scroll-content');
    if (scrollContent) {
      scrollContent.appendChild(this.layer);
    }
  }

  dispose(): void {
    this.clear();
    this.layer.remove();
  }
}
