import { upstreamLocalFonts } from '@/upstream/local-fonts';
import type {
  DetectLocalFontsOptions,
  GetLocalFontsOptions,
  LocalFontRecord,
  LocalFontSnapshot,
  LocalFontState,
  LocalFontStyleRequest,
  HostFontData,
} from '@/upstream/local-fonts';
import {
  clearStoredDesktopFonts,
  detectDesktopFontEntries,
  detectDesktopFonts,
  ensureDesktopFontsAvailable,
  getDesktopFontRecords,
  getDesktopFonts,
  getDesktopFontState,
  getDetectedDesktopFonts,
  isDesktopTauriRuntime,
  loadDesktopFontBytes,
  loadDesktopFontBytesFor,
  loadStoredDesktopFonts,
  resetDesktopFonts,
  resolveDesktopFont,
} from './desktop-local-fonts';
import type { LocalFontEntry } from './desktop-local-fonts';
import { isAuthoringBlockedFontFamily } from './font-authoring-policy';

export type {
  DetectLocalFontsOptions,
  GetLocalFontsOptions,
  LocalFontDetectionSource,
  LocalFontRecord,
  LocalFontSnapshot,
  LocalFontState,
  LocalFontStorageKind,
} from '@/upstream/local-fonts';
export type { LocalFontEntry } from './desktop-local-fonts';

export const hasHostFontProvider = upstreamLocalFonts.hasHostFontProvider;
export const getHostFontState = upstreamLocalFonts.getHostFontState;

export function resolveRendererLocalFont(name: string, style?: LocalFontStyleRequest): LocalFontRecord | null {
  return isDesktopTauriRuntime() && !hasHostFontProvider()
    ? resolveDesktopFont(name)
    : upstreamLocalFonts.resolveRendererLocalFont(name, style);
}

export async function loadRendererLocalFont(record: LocalFontRecord): Promise<HostFontData | null> {
  if (record.hostReference || !isDesktopTauriRuntime()) {
    return upstreamLocalFonts.loadRendererLocalFont(record);
  }
  const bytes = await loadDesktopFontBytes(record.postscriptName || record.fullName);
  return bytes ? { bytes, faceIndex: 0 } : null;
}

export function isLocalFontAccessSupported(): boolean {
  return isDesktopTauriRuntime() || upstreamLocalFonts.isLocalFontAccessSupported();
}

export function isFontPresenceProbeSupported(): boolean {
  return upstreamLocalFonts.isFontPresenceProbeSupported();
}

export function getLocalFontDetectionMethod(): 'local-font-access' | 'font-presence-probe' | null {
  return isDesktopTauriRuntime() ? 'local-font-access' : upstreamLocalFonts.getLocalFontDetectionMethod();
}

export function isLocalFontSupported(): boolean {
  return isDesktopTauriRuntime() || upstreamLocalFonts.isLocalFontSupported();
}

export function loadStoredLocalFonts(): Promise<LocalFontSnapshot | null> {
  return isDesktopTauriRuntime()
    ? loadStoredDesktopFonts()
    : upstreamLocalFonts.loadStoredLocalFonts();
}

export async function clearStoredLocalFonts(): Promise<void> {
  if (isDesktopTauriRuntime()) clearStoredDesktopFonts();
  else await upstreamLocalFonts.clearStoredLocalFonts();
}

/** Returns only already-authorized browser records; it never opens a permission prompt. */
export async function detectLocalFontEntries(force = false): Promise<LocalFontEntry[]> {
  if (isDesktopTauriRuntime()) return detectDesktopFontEntries(force);
  return upstreamLocalFonts.getLocalFontRecords({ includeRegistered: true }).map(recordToEntry);
}

export function detectLocalFonts(options: DetectLocalFontsOptions = {}): Promise<string[]> {
  return isDesktopTauriRuntime()
    ? detectDesktopFonts(options)
    : upstreamLocalFonts.detectLocalFonts(options);
}

export function getLocalFontRecords(options: GetLocalFontsOptions = {}): LocalFontRecord[] {
  return isDesktopTauriRuntime()
    ? getDesktopFontRecords(options)
    : upstreamLocalFonts.getLocalFontRecords(options);
}

export function getLocalFonts(options: GetLocalFontsOptions = {}): string[] {
  return isDesktopTauriRuntime() ? getDesktopFonts(options) : upstreamLocalFonts.getLocalFonts(options);
}

export function getDetectedLocalFonts(): string[] {
  return isDesktopTauriRuntime() ? getDetectedDesktopFonts() : upstreamLocalFonts.getDetectedLocalFonts();
}

export function resolveLocalFont(fontName: string): LocalFontRecord | null {
  return isDesktopTauriRuntime() ? resolveDesktopFont(fontName) : upstreamLocalFonts.resolveLocalFont(fontName);
}

export function localFontFaceKey(
  record: Pick<LocalFontRecord, 'family' | 'fullName' | 'postscriptName'>,
): string {
  return upstreamLocalFonts.localFontFaceKey(record);
}

export function loadLocalFontBytesFor(fontNames: readonly string[]): Promise<Map<string, ArrayBuffer>> {
  return isDesktopTauriRuntime()
    ? loadDesktopFontBytesFor(fontNames)
    : upstreamLocalFonts.loadLocalFontBytesFor(fontNames);
}

export function loadLocalFontBytes(fontName: string): Promise<ArrayBuffer | null> {
  return isDesktopTauriRuntime()
    ? loadDesktopFontBytes(fontName)
    : upstreamLocalFonts.loadLocalFontBytes(fontName);
}

export function getLocalFontState(): LocalFontState {
  return isDesktopTauriRuntime() ? getDesktopFontState() : upstreamLocalFonts.getLocalFontState();
}

export function resetLocalFontsForTests(): void {
  upstreamLocalFonts.resetLocalFontsForTests();
  resetDesktopFonts();
}

export async function ensureLocalFontsAvailable(targetFamilies?: Iterable<string>): Promise<Set<string>> {
  if (isDesktopTauriRuntime()) return ensureDesktopFontsAvailable(targetFamilies);
  const requested = targetFamilies ? new Set(targetFamilies) : null;
  return new Set(upstreamLocalFonts.getLocalFontRecords({ includeRegistered: true })
    .map((record) => record.family)
    .filter((family) => !requested || requested.has(family))
    .filter((family) => !isAuthoringBlockedFontFamily(family)));
}

function recordToEntry(record: LocalFontRecord): LocalFontEntry {
  return {
    family: record.family,
    postScriptName: record.postscriptName || record.family,
    style: record.style || 'normal',
    sourceKind: 'system-installed',
  };
}
