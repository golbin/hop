import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveCharShapeFontModsMock, charDialogInstances, showMock } = vi.hoisted(() => ({
  resolveCharShapeFontModsMock: vi.fn(async (_: unknown, mods: unknown) => {
    const { fontName: _fontName, ...rest } = mods as { fontName?: string };
    return {
      ...rest,
      fontId: 19,
    };
  }),
  charDialogInstances: [] as Array<{ onApply: ((mods: unknown) => void) | null }>,
  showMock: vi.fn(),
}));

vi.mock('./dialog', () => ({
  ModalDialog: class {
    dialog = {
      querySelector: vi.fn(() => null),
    };

    constructor() {}

    show(): void {}

    hide(): void {}
  },
}));

vi.mock('@upstream/ui/char-shape-dialog', () => ({
  CharShapeDialog: class {
    onApply: ((mods: unknown) => void) | null = null;

    constructor() {
      charDialogInstances.push(this);
    }

    show = showMock;
  },
}));

vi.mock('@upstream/ui/para-shape-dialog', () => ({
  ParaShapeDialog: class {},
}));

vi.mock('@/core/font-application', () => ({
  resolveCharShapeFontMods: resolveCharShapeFontModsMock,
}));

import { StyleEditDialog } from './style-edit-dialog';

describe('StyleEditDialog', () => {
  beforeEach(() => {
    resolveCharShapeFontModsMock.mockClear();
    showMock.mockReset();
    charDialogInstances.length = 0;
  });

  it('stores normalized char mods after font loading in add mode', async () => {
    const dialog = new StyleEditDialog({} as never, {} as never, 'add') as unknown as {
      openCharDialog: () => void;
      charModsJson: string;
      pendingCharMods: Promise<void> | null;
    };

    dialog.openCharDialog();

    expect(showMock).toHaveBeenCalledWith({});
    const charDialog = charDialogInstances.at(-1);
    expect(charDialog).toBeDefined();

    charDialog?.onApply?.({ fontName: 'HY헤드라인M', italic: true });
    await dialog.pendingCharMods;

    expect(resolveCharShapeFontModsMock).toHaveBeenCalledWith(
      expect.any(Object),
      { fontName: 'HY헤드라인M', italic: true },
    );
    expect(JSON.parse(dialog.charModsJson)).toEqual({
      italic: true,
      fontId: 19,
    });
  });

  it('waits for pending char mods before saving the style', async () => {
    let resolvePending: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });
    const updateStyleShapes = vi.fn();
    const createStyle = vi.fn(() => 3);
    const dialog = new StyleEditDialog(
      { createStyle, updateStyleShapes } as never,
      {} as never,
      'add',
    ) as unknown as {
      nameInput: { value: string };
      enNameInput: { value: string };
      nextStyleSelect?: { value: string };
      charModsJson: string;
      paraModsJson: string;
      pendingCharMods: Promise<void> | null;
      onConfirm: () => Promise<void | boolean>;
    };
    dialog.nameInput = { value: '본문' };
    dialog.enNameInput = { value: '' };
    dialog.charModsJson = '{}';
    dialog.paraModsJson = '{}';
    dialog.pendingCharMods = pending.then(() => {
      dialog.charModsJson = JSON.stringify({ fontId: 19 });
    });

    const confirm = dialog.onConfirm();
    await Promise.resolve();

    expect(createStyle).not.toHaveBeenCalled();

    resolvePending();
    await confirm;

    expect(createStyle).toHaveBeenCalled();
    expect(updateStyleShapes).toHaveBeenCalledWith(3, '{"fontId":19}', '{}');
  });

  it('keeps the dialog open when the style name is blank', async () => {
    const dialog = new StyleEditDialog({} as never, {} as never, 'add') as unknown as {
      nameInput: { value: string };
      enNameInput: { value: string };
      pendingCharMods: Promise<void> | null;
      onConfirm: () => Promise<void | boolean>;
    };
    const originalAlert = globalThis.alert;
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);
    dialog.nameInput = { value: '   ' };
    dialog.enNameInput = { value: '' };
    dialog.pendingCharMods = null;

    await expect(dialog.onConfirm()).resolves.toBe(false);
    expect(alertMock).toHaveBeenCalledWith('스타일 이름을 입력하세요.');

    vi.stubGlobal('alert', originalAlert);
  });

  it('keeps the dialog open when style saving fails', async () => {
    const createStyle = vi.fn(() => {
      throw new Error('save failed');
    });
    const dialog = new StyleEditDialog(
      { createStyle } as never,
      {} as never,
      'add',
    ) as unknown as {
      nameInput: { value: string };
      enNameInput: { value: string };
      pendingCharMods: Promise<void> | null;
      onConfirm: () => Promise<void | boolean>;
    };
    dialog.nameInput = { value: '본문' };
    dialog.enNameInput = { value: '' };
    dialog.pendingCharMods = null;

    await expect(dialog.onConfirm()).resolves.toBe(false);
  });
});
