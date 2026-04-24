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

  it('hydrates desktop font families from the native catalog without filtering registered names', async () => {
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
    ]);

    const { detectLocalFonts, getLocalFonts } = await import('./local-fonts');

    await expect(detectLocalFonts()).resolves.toEqual(
      expect.arrayContaining(['HY헤드라인M', '새 폰트']),
    );
    expect(getLocalFonts()).toEqual(expect.arrayContaining(['HY헤드라인M', '새 폰트']));
    expect(invokeMock).toHaveBeenCalledWith('list_local_fonts');
  });

  it('loads requested file-backed fonts through the desktop bridge once per path', async () => {
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
            family: 'HY헤드라인M',
            postScriptName: 'HYHeadLineM',
            style: 'normal',
            weight: 400,
            sourceKind: 'file-backed',
            path: '/vendor/HYHeadLineM.ttf',
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
        expect(args?.path).toBe('/vendor/HYHeadLineM.ttf');
        return [0, 1, 2, 3];
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { ensureLocalFontsAvailable } = await import('./local-fonts');

    const availableFonts = await ensureLocalFontsAvailable(['HYHeadLine M', 'HY헤드라인M']);

    expect(Array.from(availableFonts)).toEqual(
      expect.arrayContaining(['HYHeadLine M', 'HY헤드라인M', '맑은 고딕']),
    );
    expect(availableFonts.size).toBe(3);
    expect(addedFamilies).toEqual(expect.arrayContaining(['HYHeadLine M', 'HY헤드라인M']));
    expect(invokeMock).toHaveBeenCalledWith('read_local_font', { path: '/vendor/HYHeadLineM.ttf' });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('returns an empty cached list before detection', async () => {
    const { getLocalFonts } = await import('./local-fonts');

    expect(getLocalFonts()).toEqual([]);
  });
});

function installBinaryFontEnvironment(addedFamilies: string[]) {
  (globalThis as { document?: unknown }).document = {
    fonts: {
      add: vi.fn((face: { family: string }) => {
        addedFamilies.push(face.family);
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
