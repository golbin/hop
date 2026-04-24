import type { CharProperties } from '@/core/types';
import type { WasmBridge } from '@/core/wasm-bridge';
import { loadWebFonts } from './font-loader';

type FontIdBridge = Pick<WasmBridge, 'findOrCreateFontId'>;

export async function resolveCharShapeFontMods(
  wasm: FontIdBridge,
  mods: Partial<CharProperties>,
): Promise<Partial<CharProperties>> {
  const fontName = mods.fontName;
  if (!fontName) {
    return mods;
  }

  await Promise.resolve(loadWebFonts([fontName])).catch(() => undefined);

  const normalizedMods = { ...mods };
  const fontId = wasm.findOrCreateFontId(fontName);
  if (fontId >= 0) {
    normalizedMods.fontId = fontId;
  }
  delete normalizedMods.fontName;
  return normalizedMods;
}
