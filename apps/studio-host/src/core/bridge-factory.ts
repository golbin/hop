import { WasmBridge } from '@/core/wasm-bridge';
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
    return new TauriBridge();
  }
  return new WasmBridge();
}
