import { describe, expect, it, vi, beforeEach } from 'vitest';

const { loadWebFontsMock } = vi.hoisted(() => ({
  loadWebFontsMock: vi.fn(),
}));

vi.mock('./font-loader', () => ({
  loadWebFonts: loadWebFontsMock,
}));

import { resolveCharShapeFontMods } from './font-application';

describe('resolveCharShapeFontMods', () => {
  beforeEach(() => {
    loadWebFontsMock.mockReset();
  });

  it('loads the selected font before converting fontName to fontId', async () => {
    const wasm = {
      findOrCreateFontId: vi.fn(() => 42),
    };
    const mods = {
      fontName: 'HY헤드라인M',
      italic: true,
    };

    const resolved = await resolveCharShapeFontMods(wasm, mods);

    expect(loadWebFontsMock).toHaveBeenCalledWith(['HY헤드라인M']);
    expect(wasm.findOrCreateFontId).toHaveBeenCalledWith('HY헤드라인M');
    expect(resolved).toEqual({
      italic: true,
      fontId: 42,
    });
    expect(mods).toEqual({
      fontName: 'HY헤드라인M',
      italic: true,
    });
  });

  it('leaves unrelated mods untouched when no font change exists', async () => {
    const wasm = {
      findOrCreateFontId: vi.fn(),
    };
    const mods = { bold: true };

    const resolved = await resolveCharShapeFontMods(wasm, mods);

    expect(loadWebFontsMock).not.toHaveBeenCalled();
    expect(wasm.findOrCreateFontId).not.toHaveBeenCalled();
    expect(resolved).toBe(mods);
  });
});
