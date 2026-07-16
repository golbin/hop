interface ProbeBridge {
  printGeometryProbeConfigured?(): Promise<boolean>;
}

export function createPrintProbeTrigger(): (
  bridge: unknown,
  dispatch: (commandId: string) => boolean,
) => Promise<boolean> {
  let dispatched = false;

  return async (bridge, dispatch) => {
    if (dispatched) return false;
    const candidate = bridge as ProbeBridge;
    if (!candidate.printGeometryProbeConfigured) return false;
    if (!await candidate.printGeometryProbeConfigured()) return false;
    dispatched = dispatch('file:print');
    return dispatched;
  };
}
