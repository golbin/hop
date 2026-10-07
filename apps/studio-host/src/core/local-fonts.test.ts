import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

describe('local fonts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { FontFace?: unknown }).FontFace;
  });

  it('keeps native document face lookup and bytes available to the upstream renderer', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    invokeMock.mockImplementation(async (command: string) => command === 'list_local_fonts' ? [{
      family: 'HY헤드라인M', postScriptName: 'HYHeadLineM', style: 'normal',
      sourceKind: 'file-backed', path: '/fonts/document.ttf',
    }] : [1, 2, 3, 4]);
    const fonts = await import('./local-fonts');
    await fonts.detectLocalFonts();
    const record = fonts.resolveRendererLocalFont('HYHeadLineM');
    expect(record?.family).toBe('HY헤드라인M');
    expect(fonts.getLocalFonts()).not.toContain('HY헤드라인M');
    const data = await fonts.loadRendererLocalFont(record!);
    expect([...new Uint8Array(data!.bytes)]).toEqual([1, 2, 3, 4]);
    expect(invokeMock).toHaveBeenCalledWith('read_local_font', { path: '/fonts/document.ttf' });
    expect(fonts.getLocalFontState()).toMatchObject({ probedFamilies: [], unresolvedFamilies: [] });
  });

  it('hydrates desktop font families from the native catalog while filtering blocked authoring names', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    invokeMock.mockResolvedValue([
      {
        family: 'HY헤드라인M',
        postScriptName: 'HYHeadLineM',
        style: 'normal',
        sourceKind: 'system-installed',
        path: '/System/Fonts/HYHeadLineM.ttf',
      },
      {
        family: '새 폰트',
        postScriptName: 'NewFont-Regular',
        style: 'normal',
        sourceKind: 'system-installed',
        path: '/System/Fonts/NewFont-Regular.ttf',
      },
      {
        family: '새 폰트',
        postScriptName: 'NewFont-Bold',
        style: 'normal',
        sourceKind: 'system-installed',
        path: '/System/Fonts/NewFont-Bold.ttf',
      },
    ]);

    const { detectLocalFonts, getLocalFonts } = await import('./local-fonts');

    await expect(detectLocalFonts()).resolves.toEqual(
      expect.arrayContaining(['새 폰트']),
    );
    expect(getLocalFonts()).toEqual(expect.arrayContaining(['새 폰트']));
    expect(getLocalFonts()).toEqual(['새 폰트']);
    expect(getLocalFonts()).not.toContain('HY헤드라인M');
    expect(invokeMock).toHaveBeenCalledWith('list_local_fonts');
  });

  it('loads requested safe file-backed fonts through the desktop bridge once per path', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    const addedFamilies: string[] = [];
    installBinaryFontEnvironment(addedFamilies);
    invokeMock.mockImplementation(async (command: string, args?: { path?: string }) => {
      if (command === 'list_local_fonts') {
        return [
          {
            family: 'HYHeadLine M',
            postScriptName: 'HYHeadLineM',
            style: 'normal',
            weight: 400,
            sourceKind: 'file-backed',
            path: '/vendor/HYHeadLineM.ttf',
          },
          {
            family: '새 파일폰트',
            postScriptName: 'NewFont',
            style: 'normal',
            weight: 400,
            sourceKind: 'file-backed',
            path: '/vendor/NewFont.ttf',
          },
          {
            family: '맑은 고딕',
            postScriptName: 'MalgunGothic',
            style: 'normal',
            sourceKind: 'system-installed',
          },
        ];
      }
      if (command === 'read_local_font') {
        expect(args?.path).toBe('/vendor/NewFont.ttf');
        return [0, 1, 2, 3];
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { ensureLocalFontsAvailable } = await import('./local-fonts');

    const availableFonts = await ensureLocalFontsAvailable(['HYHeadLine M', '새 파일폰트']);

    expect(Array.from(availableFonts)).toEqual(
      expect.arrayContaining(['새 파일폰트', '맑은 고딕']),
    );
    expect(availableFonts).not.toContain('HYHeadLine M');
    expect(availableFonts.size).toBe(2);
    expect(addedFamilies).toEqual(['새 파일폰트']);
    expect(invokeMock).toHaveBeenCalledWith('read_local_font', { path: '/vendor/NewFont.ttf' });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('returns an empty cached list before detection', async () => {
    const { getLocalFonts } = await import('./local-fonts');

    expect(getLocalFonts()).toEqual([]);
  });

  it('does not request browser local-font permission during background font hydration', async () => {
    const queryLocalFonts = vi.fn().mockResolvedValue([]);
    (globalThis as { window?: unknown }).window = {
      location: { protocol: 'https:' },
      queryLocalFonts,
    };

    const { detectLocalFontEntries, ensureLocalFontsAvailable } = await import('./local-fonts');

    await detectLocalFontEntries();
    await ensureLocalFontsAvailable(['Noto Sans KR']);

    expect(queryLocalFonts).not.toHaveBeenCalled();
  });

  it('prefers a regular desktop face when a family has multiple styles', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    invokeMock.mockResolvedValue([
      {
        family: '가족 폰트',
        postScriptName: 'Family-Bold',
        style: 'Bold',
        sourceKind: 'file-backed',
        path: '/fonts/family-bold.ttf',
      },
      {
        family: '가족 폰트',
        postScriptName: 'Family-Regular',
        style: 'Regular',
        sourceKind: 'file-backed',
        path: '/fonts/family-regular.ttf',
      },
    ]);

    const { detectLocalFonts, resolveLocalFont } = await import('./local-fonts');
    await detectLocalFonts({ includeRegistered: true });

    expect(resolveLocalFont('가족 폰트')?.postscriptName).toBe('Family-Regular');
    expect(resolveLocalFont('Family-Bold')?.style).toBe('Bold');
  });

  it('loads the exact desktop face selected by PostScript name', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    invokeMock.mockImplementation(async (command: string, args?: { path?: string }) => {
      if (command === 'list_local_fonts') {
        return [{
          family: '가족 폰트',
          postScriptName: 'Family-Bold',
          style: 'Bold',
          sourceKind: 'file-backed',
          path: '/fonts/family-bold.ttf',
        }];
      }
      if (command === 'read_local_font') {
        expect(args?.path).toBe('/fonts/family-bold.ttf');
        return [1, 2, 3];
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { detectLocalFonts, loadLocalFontBytesFor } = await import('./local-fonts');
    await detectLocalFonts({ includeRegistered: true });
    const bytesByFace = await loadLocalFontBytesFor(['Family-Bold']);

    expect([...bytesByFace.keys()]).toEqual(['family-bold']);
    expect([...new Uint8Array(bytesByFace.get('family-bold')!)]).toEqual([1, 2, 3]);
  });

  it('removes previously registered file-backed faces after a forced catalog refresh', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    const addedFamilies: string[] = [];
    const deletedFamilies: string[] = [];
    installBinaryFontEnvironment(addedFamilies, deletedFamilies);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_local_fonts') {
        return [{
          family: '새 파일폰트',
          postScriptName: 'NewFont',
          style: 'normal',
          sourceKind: 'file-backed',
          path: '/vendor/NewFont.ttf',
        }];
      }
      if (command === 'read_local_font') return [0, 1, 2, 3];
      throw new Error(`unexpected command: ${command}`);
    });

    const { detectLocalFonts, ensureLocalFontsAvailable } = await import('./local-fonts');
    await detectLocalFonts();
    await ensureLocalFontsAvailable(['새 파일폰트']);
    await detectLocalFonts({ force: true });

    expect(addedFamilies).toEqual(['새 파일폰트']);
    expect(deletedFamilies).toEqual(['새 파일폰트']);
  });

  it('coalesces concurrent registration of the same file-backed face', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    const addedFamilies: string[] = [];
    installBinaryFontEnvironment(addedFamilies);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_local_fonts') {
        return [{
          family: '동시 폰트',
          postScriptName: 'ConcurrentFont',
          style: 'normal',
          sourceKind: 'file-backed',
          path: '/vendor/ConcurrentFont.ttf',
        }];
      }
      if (command === 'read_local_font') return [0, 1, 2, 3];
      throw new Error(`unexpected command: ${command}`);
    });

    const { detectLocalFonts, ensureLocalFontsAvailable } = await import('./local-fonts');
    await detectLocalFonts();
    await Promise.all([
      ensureLocalFontsAvailable(['동시 폰트']),
      ensureLocalFontsAvailable(['동시 폰트']),
    ]);

    expect(addedFamilies).toEqual(['동시 폰트']);
    expect(invokeMock.mock.calls.filter(([command]) => command === 'read_local_font')).toHaveLength(1);
  });
});

function installBinaryFontEnvironment(addedFamilies: string[], deletedFamilies: string[] = []) {
  (globalThis as { document?: unknown }).document = {
    fonts: {
      add: vi.fn((face: { family: string }) => {
        addedFamilies.push(face.family);
      }),
      delete: vi.fn((face: { family: string }) => {
        deletedFamilies.push(face.family);
        return true;
      }),
    },
  };
  (globalThis as { FontFace?: unknown }).FontFace = class {
    family: string;

    constructor(name: string) {
      this.family = name;
    }

    async load() {
      return this;
    }
  };
}
