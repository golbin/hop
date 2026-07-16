import { describe, expect, it, vi } from 'vitest';
import { createPrintProbeTrigger } from './print-probe-trigger';

describe('createPrintProbeTrigger', () => {
  it('does nothing when the bridge has no probe capability', async () => {
    const dispatch = vi.fn(() => true);
    const trigger = createPrintProbeTrigger();

    expect(await trigger({}, dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does nothing when native probe mode is disabled', async () => {
    const dispatch = vi.fn(() => true);
    const trigger = createPrintProbeTrigger();

    expect(await trigger({ printGeometryProbeConfigured: async () => false }, dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches print exactly once when native probe mode is enabled', async () => {
    const configured = vi.fn(async () => true);
    const dispatch = vi.fn(() => true);
    const trigger = createPrintProbeTrigger();
    const bridge = { printGeometryProbeConfigured: configured };

    expect(await trigger(bridge, dispatch)).toBe(true);
    expect(await trigger(bridge, dispatch)).toBe(false);
    expect(configured).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('file:print');
  });
});
