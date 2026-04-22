import { describe, expect, it } from 'vitest';

import { resolvePageLeft, resolveVirtualScrollPageLeft } from './page-left';

describe('resolvePageLeft', () => {
  it('snaps explicit page offsets to integer pixels', () => {
    expect(resolvePageLeft(120.6, 0, 0)).toBe(121);
    expect(resolvePageLeft(120.4, 0, 0)).toBe(120);
  });

  it('centers single-column pages in scroll-content coordinates', () => {
    expect(resolvePageLeft(-1, 1041, 1000)).toBe(21);
    expect(resolvePageLeft(-1, 1040, 999.2)).toBe(20);
  });
});

describe('resolveVirtualScrollPageLeft', () => {
  it('uses explicit grid coordinates when virtual-scroll provides them', () => {
    const layout = {
      getPageLeft: () => 87.6,
      getPageWidth: () => 1000,
    };

    expect(resolveVirtualScrollPageLeft(layout, 0, 1200)).toBe(88);
  });
});
