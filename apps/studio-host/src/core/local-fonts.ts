interface BrowserFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

export interface LocalFontEntry {
  family: string;
  postScriptName: string;
  style: string;
  weight?: number;
  sourceKind: 'system-installed' | 'file-backed';
  path?: string | null;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<BrowserFontData[]>;
  }
}

let cachedFontEntries: LocalFontEntry[] | null = null;
const loadedFileBackedEntryKeys = new Set<string>();
const desktopFontBinaryCache = new Map<string, Promise<Uint8Array>>();

export function isLocalFontSupported(): boolean {
  return isDesktopTauriRuntime()
    || (typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function');
}

export async function detectLocalFontEntries(): Promise<LocalFontEntry[]> {
  if (cachedFontEntries) {
    return cachedFontEntries;
  }

  const entries = isDesktopTauriRuntime()
    ? await detectDesktopFontEntries()
    : await detectBrowserFontEntries();

  cachedFontEntries = normalizeFontEntries(entries);
  return cachedFontEntries;
}

export async function detectLocalFonts(): Promise<string[]> {
  const entries = await detectLocalFontEntries();
  return uniqueFamilies(entries);
}

export function getLocalFonts(): string[] {
  return uniqueFamilies(cachedFontEntries ?? []);
}

export async function ensureLocalFontsAvailable(targetFamilies?: Iterable<string>): Promise<Set<string>> {
  const entries = await detectLocalFontEntries();
  const available = new Set(
    entries
      .filter((entry) => entry.sourceKind === 'system-installed')
      .map((entry) => entry.family),
  );
  const requestedFamilies = resolveRequestedFamilies(entries, targetFamilies);

  if (!isDesktopTauriRuntime() || !supportsBinaryFontLoading()) {
    return available;
  }

  const fileBackedEntries = entries.filter((entry) =>
    entry.sourceKind === 'file-backed'
    && Boolean(entry.path)
    && requestedFamilies.has(entry.family),
  );
  const entriesByPath = groupEntriesByPath(fileBackedEntries);

  for (const [path, pathEntries] of entriesByPath) {
    let fontBytes: Uint8Array;
    try {
      fontBytes = await readDesktopFontBytes(path);
    } catch {
      continue;
    }

    for (const entry of pathEntries) {
      const entryKey = fileBackedEntryKey(entry);
      if (loadedFileBackedEntryKeys.has(entryKey)) {
        available.add(entry.family);
        continue;
      }

      try {
        await registerDesktopFontFace(entry, fontBytes);
        loadedFileBackedEntryKeys.add(entryKey);
        available.add(entry.family);
      } catch {
        // File-backed fonts are best-effort; substitute fallback remains available.
      }
    }
  }

  return available;
}

async function detectDesktopFontEntries(): Promise<LocalFontEntry[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LocalFontEntry[]>('list_local_fonts');
}

async function detectBrowserFontEntries(): Promise<LocalFontEntry[]> {
  if (typeof window === 'undefined' || typeof window.queryLocalFonts !== 'function') {
    return [];
  }

  const fontDataList = await window.queryLocalFonts();
  return fontDataList.map((font) => ({
    family: font.family,
    postScriptName: font.postscriptName,
    style: font.style || 'normal',
    sourceKind: 'system-installed',
  }));
}

async function readDesktopFontBytes(path: string): Promise<Uint8Array> {
  let pending = desktopFontBinaryCache.get(path);
  if (!pending) {
    pending = (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const bytes = await invoke<number[]>('read_local_font', { path });
      return new Uint8Array(bytes);
    })();
    desktopFontBinaryCache.set(path, pending);
  }

  try {
    return await pending;
  } catch (error) {
    desktopFontBinaryCache.delete(path);
    throw error;
  }
}

async function registerDesktopFontFace(entry: LocalFontEntry, fontBytes: Uint8Array): Promise<void> {
  const source = fontBytes.slice();
  const descriptors: FontFaceDescriptors = {
    style: entry.style || 'normal',
  };
  if (entry.weight) {
    descriptors.weight = String(entry.weight);
  }

  const face = new FontFace(entry.family, source, descriptors);
  document.fonts.add(await face.load());
}

function normalizeFontEntries(entries: LocalFontEntry[]): LocalFontEntry[] {
  const seen = new Set<string>();
  const normalized: LocalFontEntry[] = [];

  for (const entry of entries) {
    const family = entry.family.trim();
    if (!family) continue;

    const postScriptName = entry.postScriptName?.trim() || family;
    const style = entry.style?.trim() || 'normal';
    const sourceKind = entry.sourceKind ?? 'system-installed';
    const path = entry.path ?? null;
    const key = [family, postScriptName, style, sourceKind, path ?? ''].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      family,
      postScriptName,
      style,
      weight: entry.weight,
      sourceKind,
      path,
    });
  }

  normalized.sort((left, right) =>
    left.family.localeCompare(right.family, 'ko')
    || left.style.localeCompare(right.style, 'en')
    || left.postScriptName.localeCompare(right.postScriptName, 'en'),
  );
  return normalized;
}

function resolveRequestedFamilies(
  entries: LocalFontEntry[],
  targetFamilies?: Iterable<string>,
): Set<string> {
  if (!targetFamilies) {
    return new Set(entries.map((entry) => entry.family));
  }

  return new Set(
    Array.from(targetFamilies)
      .map((family) => family.trim())
      .filter(Boolean),
  );
}

function groupEntriesByPath(entries: LocalFontEntry[]): Map<string, LocalFontEntry[]> {
  const grouped = new Map<string, LocalFontEntry[]>();
  for (const entry of entries) {
    const path = entry.path;
    if (!path) continue;
    const pathEntries = grouped.get(path) ?? [];
    pathEntries.push(entry);
    grouped.set(path, pathEntries);
  }
  return grouped;
}

function fileBackedEntryKey(entry: LocalFontEntry): string {
  return [
    entry.family,
    entry.postScriptName,
    entry.style,
    entry.weight ?? '',
    entry.path ?? '',
  ].join('\u0000');
}

function uniqueFamilies(entries: LocalFontEntry[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.family))).sort((a, b) =>
    a.localeCompare(b, 'ko'),
  );
}

function supportsBinaryFontLoading(): boolean {
  return typeof document !== 'undefined'
    && !!document.fonts
    && typeof FontFace === 'function';
}

function isDesktopTauriRuntime(): boolean {
  return typeof window !== 'undefined'
    && (
      '__TAURI_INTERNALS__' in window
      || window.location?.protocol === 'tauri:'
    );
}
