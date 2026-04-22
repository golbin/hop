type PageLayout = {
  getPageLeft(pageIndex: number): number;
  getPageWidth(pageIndex: number): number;
};

export function resolvePageLeft(
  pageLeft: number,
  scrollContentWidth: number,
  pageDisplayWidth: number,
): number {
  if (pageLeft >= 0) {
    return Math.round(pageLeft);
  }

  return Math.max(0, Math.round((scrollContentWidth - pageDisplayWidth) / 2));
}

export function resolveVirtualScrollPageLeft(
  layout: PageLayout,
  pageIndex: number,
  scrollContentWidth: number,
): number {
  return resolvePageLeft(
    layout.getPageLeft(pageIndex),
    scrollContentWidth,
    layout.getPageWidth(pageIndex),
  );
}
