import { describe, expect, it, vi, beforeEach } from 'vitest';

const { loadWebFontsMock } = vi.hoisted(() => ({
  loadWebFontsMock: vi.fn(),
}));

vi.mock('@/core/font-loader', () => ({
  loadWebFonts: loadWebFontsMock,
}));

vi.mock('@/core/user-settings', () => ({
  userSettings: {
    getAllFontSets: () => [],
  },
}));

vi.mock('@/core/local-fonts', () => ({
  getLocalFonts: () => [],
}));

vi.mock('./custom-select', () => ({
  getCustomSelectRoot: () => null,
  syncCustomSelect: () => undefined,
}));

import { Toolbar } from './toolbar';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function createDeferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createToolbarHarness() {
  const emit = vi.fn();
  const wasm = {
    findOrCreateFontId: vi.fn((name: string) => (name === 'Newest' ? 202 : 101)),
    findOrCreateFontIdForLang: vi.fn((lang: number) => lang + 1000),
  };

  const toolbar = {
    eventBus: { emit },
    fontLang: { value: 'all' },
    wasm,
    lastFontFamilies: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    fontApplyRequestId: 0,
    beginFontApplyRequest: (Toolbar.prototype as unknown as Record<string, () => number>).beginFontApplyRequest,
    isLatestFontApplyRequest: (
      Toolbar.prototype as unknown as Record<string, (requestId: number) => boolean>
    ).isLatestFontApplyRequest,
  };

  return { toolbar, emit, wasm };
}

describe('Toolbar font application sequencing', () => {
  beforeEach(() => {
    loadWebFontsMock.mockReset();
  });

  it('ignores stale single-font selections when a newer selection finishes first', async () => {
    const first = createDeferred();
    const second = createDeferred();
    loadWebFontsMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { toolbar, emit, wasm } = createToolbarHarness();
    const applyFontSelection = (
      Toolbar.prototype as unknown as Record<string, (this: object, name: string) => Promise<void>>
    ).applyFontSelection;

    const firstRun = applyFontSelection.call(toolbar, 'Older');
    const secondRun = applyFontSelection.call(toolbar, 'Newest');

    second.resolve();
    await secondRun;
    first.resolve();
    await firstRun;

    expect(loadWebFontsMock).toHaveBeenNthCalledWith(1, ['Older']);
    expect(loadWebFontsMock).toHaveBeenNthCalledWith(2, ['Newest']);
    expect(wasm.findOrCreateFontId).toHaveBeenCalledTimes(1);
    expect(wasm.findOrCreateFontId).toHaveBeenCalledWith('Newest');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('format-char', { fontId: 202 });
  });

  it('prevents an older font-set apply from overwriting a newer single-font selection', async () => {
    const first = createDeferred();
    const second = createDeferred();
    loadWebFontsMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { toolbar, emit, wasm } = createToolbarHarness();
    const applyFontSelection = (
      Toolbar.prototype as unknown as Record<string, (this: object, name: string) => Promise<void>>
    ).applyFontSelection;
    const applyFontSet = (
      Toolbar.prototype as unknown as Record<string, (this: object, fontSet: Record<string, string>) => Promise<void>>
    ).applyFontSet;

    const olderFontSet = {
      name: 'Older Set',
      korean: 'A',
      english: 'B',
      chinese: 'C',
      japanese: 'D',
      other: 'E',
      symbol: 'F',
      user: 'G',
    };

    const firstRun = applyFontSet.call(toolbar, olderFontSet);
    const secondRun = applyFontSelection.call(toolbar, 'Newest');

    second.resolve();
    await secondRun;
    first.resolve();
    await firstRun;

    expect(loadWebFontsMock).toHaveBeenNthCalledWith(1, ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(loadWebFontsMock).toHaveBeenNthCalledWith(2, ['Newest']);
    expect(wasm.findOrCreateFontId).toHaveBeenCalledTimes(1);
    expect(wasm.findOrCreateFontId).toHaveBeenCalledWith('Newest');
    expect(wasm.findOrCreateFontIdForLang).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('format-char', { fontId: 202 });
  });
});
