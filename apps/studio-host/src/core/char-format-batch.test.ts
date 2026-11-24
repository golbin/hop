import { describe, expect, it } from 'vitest';
import type { WasmBridge } from '@/upstream/core';
import { batchCharFormat } from './char-format-batch';

function fakeBridge() {
  const log: string[] = [];
  const doc = { beginBatch: () => (log.push('begin'), ''), endBatch: () => (log.push('end'), '') };
  const bridge = {
    doc,
    applyCharFormat: () => log.push('apply'),
    getCharShapeRuns: () => (log.push('runs'), []),
    getPageInfo: () => log.push('layout'),
    runInBatch<T>(fn: () => T): T { log.push('rib'); return fn(); },
  };
  return { log, bridge: batchCharFormat(bridge as unknown as WasmBridge) as unknown as typeof bridge };
}

describe('batchCharFormat', () => {
  it('wraps consecutive char-format calls in one batch and closes before a layout read', () => {
    const { log, bridge } = fakeBridge();
    for (let i = 0; i < 3; i++) { bridge.applyCharFormat(); bridge.getCharShapeRuns(); }
    bridge.getPageInfo();
    expect(log).toEqual(['begin', 'apply', 'runs', 'apply', 'runs', 'apply', 'runs', 'end', 'layout']);
  });

  it('closes the batch on a microtask even without a later call', async () => {
    const { log, bridge } = fakeBridge();
    bridge.applyCharFormat();
    await Promise.resolve();
    expect(log).toEqual(['begin', 'apply', 'end']);
  });

  it('does not open a second batch inside runInBatch', () => {
    const { log, bridge } = fakeBridge();
    bridge.runInBatch(() => bridge.applyCharFormat());
    expect(log).toEqual(['rib', 'apply']);
  });
});
