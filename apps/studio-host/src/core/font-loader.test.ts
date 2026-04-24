import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('font loader', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { FontFace?: unknown }).FontFace;
  });

  it('registers font-face CSS and loads critical fonts once', async () => {
    const fontFaces: Array<{ name: string; source: string }> = [];
    installFontEnvironment({
      onFontFace: (face) => fontFaces.push(face),
    });
    const { loadWebFonts } = await import('./font-loader');
    const progress = vi.fn();

    await loadWebFonts(undefined, progress);
    await loadWebFonts(undefined, progress);

    expect(progress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(progress).toHaveBeenNthCalledWith(2, 2, 2);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(fontFaces.some((face) => face.name === '함초롬바탕')).toBe(true);
    expect(fontFaces.some((face) => face.name === '함초롬돋움')).toBe(true);
  });

  it('skips fonts detected from the operating system', async () => {
    const fontFaces: Array<{ name: string; source: string }> = [];
    installFontEnvironment({
      check: (query) => query.includes('"Noto Sans KR"'),
      onFontFace: (face) => fontFaces.push(face),
    });
    const { getDetectedOSFonts, loadWebFonts } = await import('./font-loader');

    await loadWebFonts(['Noto Sans KR']);

    expect(getDetectedOSFonts().has('Noto Sans KR')).toBe(true);
    expect(fontFaces.some((face) => face.name === 'Noto Sans KR')).toBe(false);
    expect(fontFaces.some((face) => face.name === '함초롬돋움')).toBe(true);
  });

  it('deduplicates aliases that share the same font file', async () => {
    const fontFaces: Array<{ name: string; source: string }> = [];
    installFontEnvironment({
      onFontFace: (face) => fontFaces.push(face),
    });
    const { loadWebFonts } = await import('./font-loader');
    const progress = vi.fn();

    await loadWebFonts(['돋움', '굴림', '새굴림'], progress);

    const notoSansLoads = fontFaces.filter((face) => face.source.includes('NotoSansKR-Regular.woff2'));
    expect(progress).toHaveBeenCalledTimes(2);
    expect(notoSansLoads.some((face) => face.name === '돋움')).toBe(true);
    expect(notoSansLoads.some((face) => face.name === '굴림')).toBe(true);
    expect(notoSansLoads.some((face) => face.name === '새굴림')).toBe(true);
  });

  it('continues loading when a font face fails', async () => {
    const added: string[] = [];
    installFontEnvironment({
      failWhen: (name) => name === '함초롬바탕',
      onAdd: (name) => added.push(name),
    });
    const { loadWebFonts } = await import('./font-loader');

    await expect(loadWebFonts()).resolves.toBeUndefined();

    expect(added).toContain('함초롬돋움');
  });

  it('suppresses substitute faces for families discovered from the native catalog', async () => {
    const fontFaces: Array<{ name: string; source: string }> = [];
    const { appended } = installFontEnvironment({
      onFontFace: (face) => fontFaces.push(face),
    });
    vi.doMock('./local-fonts', () => ({
      detectLocalFontEntries: vi.fn().mockResolvedValue([
        { family: 'HY헤드라인M', postScriptName: 'HYHeadLineM', style: 'normal', sourceKind: 'file-backed' },
      ]),
      ensureLocalFontsAvailable: vi.fn().mockResolvedValue(new Set(['HY헤드라인M'])),
    }));
    const { getDetectedOSFonts, loadWebFonts } = await import('./font-loader');

    await loadWebFonts(['HY헤드라인M']);

    expect(getDetectedOSFonts().has('HY헤드라인M')).toBe(true);
    expect(fontFaces.some((face) => face.name === 'HY헤드라인M')).toBe(false);
    expect((appended[0] as { textContent?: string }).textContent).not.toContain('HY헤드라인M');
  });

  it('keeps substitute faces when file-backed fonts are discovered but not yet loadable', async () => {
    const fontFaces: Array<{ name: string; source: string }> = [];
    const { appended } = installFontEnvironment({
      onFontFace: (face) => fontFaces.push(face),
    });
    vi.doMock('./local-fonts', () => ({
      detectLocalFontEntries: vi.fn().mockResolvedValue([
        { family: 'HY헤드라인M', postScriptName: 'HYHeadLineM', style: 'normal', sourceKind: 'file-backed' },
      ]),
      ensureLocalFontsAvailable: vi.fn().mockResolvedValue(new Set<string>()),
    }));
    const { getDetectedOSFonts, loadWebFonts } = await import('./font-loader');

    await loadWebFonts(['HY헤드라인M']);

    expect(getDetectedOSFonts().has('HY헤드라인M')).toBe(false);
    expect(fontFaces.some((face) => face.name === 'HY헤드라인M')).toBe(true);
    expect((appended[0] as { textContent?: string }).textContent).toContain('HY헤드라인M');
  });
});

function installFontEnvironment({
  check = () => false,
  failWhen = () => false,
  onAdd = () => undefined,
  onFontFace = () => undefined,
}: {
  check?: (query: string) => boolean;
  failWhen?: (name: string) => boolean;
  onAdd?: (name: string) => void;
  onFontFace?: (face: { name: string; source: string }) => void;
} = {}) {
  const appended: unknown[] = [];
  const fonts = {
    check: vi.fn(check),
    add: vi.fn((face: { family: string }) => {
      onAdd(face.family);
    }),
  };
  (globalThis as { document?: unknown }).document = {
    fonts,
    head: {
      appendChild: vi.fn((node: unknown) => appended.push(node)),
    },
    createElement: vi.fn(() => ({ textContent: '' })),
  };
  (globalThis as { FontFace?: unknown }).FontFace = class {
    family: string;
    source: string;

    constructor(name: string, source: string) {
      this.family = name;
      this.source = source;
      onFontFace({ name, source });
    }

    async load() {
      if (failWhen(this.family)) throw new Error(`failed ${this.family}`);
      return this;
    }
  };
  return { appended, fonts };
}
