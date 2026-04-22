import { describe, expect, it } from 'vitest';

import { resolveCanvasLeft } from './canvas-view';

describe('resolveCanvasLeft', () => {
  it('snaps explicit page offsets to integer pixels', () => {
    expect(resolveCanvasLeft(120.6, 0, 0)).toBe(121);
    expect(resolveCanvasLeft(120.4, 0, 0)).toBe(120);
  });

  it('centers single-column canvases without fractional offsets', () => {
    expect(resolveCanvasLeft(-1, 1441, 1000)).toBe(221);
    expect(resolveCanvasLeft(-1, 1440, 999.2)).toBe(220);
  });
});
