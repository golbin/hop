import * as implementation from '@upstream/core/local-fonts';

export type {
  DetectLocalFontsOptions,
  GetLocalFontsOptions,
  LocalFontDetectionSource,
  LocalFontRecord,
  LocalFontSnapshot,
  LocalFontState,
  LocalFontStorageKind,
  LocalFontStyleRequest,
} from '@upstream/core/local-fonts';
export type { HostFontData } from '@upstream/core/host-font-provider';
export const upstreamLocalFonts = implementation;
