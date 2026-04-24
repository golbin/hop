import { describe, expect, it, vi, beforeEach } from 'vitest';

const { showMock, resolveCharShapeFontModsMock, dialogInstances } = vi.hoisted(() => ({
  showMock: vi.fn(),
  resolveCharShapeFontModsMock: vi.fn(async (_: unknown, mods: unknown) => {
    const { fontName: _fontName, ...rest } = mods as { fontName?: string };
    return {
      ...rest,
      fontId: 77,
    };
  }),
  dialogInstances: [] as Array<{ onApply: ((mods: unknown) => void) | null }>,
}));

vi.mock('@upstream/command/commands/format', () => ({
  formatCommands: [
    {
      id: 'format:char-shape',
      label: '글자 모양',
      execute: vi.fn(),
    },
    {
      id: 'format:bold',
      label: '굵게',
      execute: vi.fn(),
    },
  ],
}));

vi.mock('@/ui/char-shape-dialog', () => ({
  CharShapeDialog: class {
    onApply: ((mods: unknown) => void) | null = null;
    onClose: (() => void) | null = null;

    constructor() {
      dialogInstances.push(this);
    }

    show = showMock;
  },
}));

vi.mock('@/core/font-application', () => ({
  resolveCharShapeFontMods: resolveCharShapeFontModsMock,
}));

import { formatCommands } from './format';

describe('format command overrides', () => {
  beforeEach(() => {
    showMock.mockReset();
    resolveCharShapeFontModsMock.mockClear();
    dialogInstances.length = 0;
  });

  it('routes char-shape apply through the shared font normalization helper', async () => {
    const applyCharPropsToRange = vi.fn();
    const focus = vi.fn();
    const getSelection = vi.fn(() => ({ start: { p: 1 }, end: { p: 2 } }));
    const getCharProperties = vi.fn(() => ({ fontFamilies: ['바탕'] }));
    const command = formatCommands.find((item) => item.id === 'format:char-shape');

    command?.execute({
      wasm: { findOrCreateFontId: vi.fn() },
      eventBus: {},
      getInputHandler: () => ({
        getCharProperties,
        getSelection,
        applyCharPropsToRange,
        focus,
      }),
    } as never);

    expect(showMock).toHaveBeenCalledWith({ fontFamilies: ['바탕'] });
    const dialog = dialogInstances.at(-1);
    expect(dialog).toBeDefined();

    dialog?.onApply?.({ fontName: 'HY헤드라인M', italic: true });
    await Promise.resolve();

    expect(resolveCharShapeFontModsMock).toHaveBeenCalledWith(
      expect.objectContaining({ findOrCreateFontId: expect.any(Function) }),
      { fontName: 'HY헤드라인M', italic: true },
    );
    expect(applyCharPropsToRange).toHaveBeenCalledWith(
      { p: 1 },
      { p: 2 },
      { italic: true, fontId: 77 },
    );
  });

  it('keeps unrelated upstream format commands intact', () => {
    expect(formatCommands.some((item) => item.id === 'format:bold')).toBe(true);
  });
});
