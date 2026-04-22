import type { CellBbox } from '@/core/types';
import { VirtualScroll } from '@/view/virtual-scroll';
import { resolveVirtualScrollPageLeft } from '../view/page-left';

/** F5 셀 블록 선택 영역을 하이라이트 오버레이로 렌더링한다 */
export class CellSelectionRenderer {
  private layer: HTMLDivElement;
  private highlights: HTMLDivElement[] = [];

  constructor(
    private container: HTMLElement,
    private virtualScroll: VirtualScroll,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'cell-selection-layer';
    this.layer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:6;';
    const scrollContent = container.querySelector('#scroll-content');
    if (scrollContent) {
      scrollContent.appendChild(this.layer);
    }
  }

  /** 선택 범위 내 셀들을 하이라이트한다 */
  render(
    cellBboxes: CellBbox[],
    range: { startRow: number; startCol: number; endRow: number; endCol: number },
    zoom: number,
    excluded?: Set<string>,
  ): void {
    this.clear();
    this.ensureAttached();

    const scrollContent = this.container.querySelector('#scroll-content');
    const contentWidth = scrollContent?.clientWidth ?? 0;

    for (const cell of cellBboxes) {
      // 셀이 선택 범위에 포함되는지 확인 (병합 셀 고려)
      const cellEndRow = cell.row + cell.rowSpan - 1;
      const cellEndCol = cell.col + cell.colSpan - 1;
      const overlaps =
        cell.row <= range.endRow && cellEndRow >= range.startRow &&
        cell.col <= range.endCol && cellEndCol >= range.startCol;
      if (!overlaps) continue;

      // Ctrl+클릭으로 제외된 셀인지 확인
      if (excluded && excluded.has(`${cell.row},${cell.col}`)) continue;

      const div = document.createElement('div');
      const pageOffset = this.virtualScroll.getPageOffset(cell.pageIndex);
      const pageLeft = resolveVirtualScrollPageLeft(
        this.virtualScroll,
        cell.pageIndex,
        contentWidth,
      );

      div.className = 'cell-selection-highlight';
      div.style.cssText =
        `position:absolute;` +
        `left:${pageLeft + cell.x * zoom}px;` +
        `top:${pageOffset + cell.y * zoom}px;` +
        `width:${cell.w * zoom}px;` +
        `height:${cell.h * zoom}px;`;
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

  /** 레이어가 DOM에 없으면 재부착한다 */
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
