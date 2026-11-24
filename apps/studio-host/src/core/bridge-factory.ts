import { WasmBridge } from '@/upstream/core';
import { batchCharFormat } from './char-format-batch';
import { TauriBridge } from './tauri-bridge';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined'
    && (
      '__TAURI_INTERNALS__' in window
      || window.location?.protocol === 'tauri:'
    );
}

export function createBridge(): WasmBridge {
  if (isTauriRuntime()) {
    return batchCharFormat(new TauriBridge());
  }
  return new WasmBridge();
}
