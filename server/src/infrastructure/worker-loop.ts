/** Supervises the complete claim/process/ack cycle, including database failures. */
export async function runWorkerLoop(options: {
  stopping: () => boolean;
  runOnce: () => Promise<boolean>;
  wait: (milliseconds: number) => Promise<void>;
  pollIntervalMs: number;
  reportFailure: (error: unknown, retryMs: number) => void;
}): Promise<void> {
  let failures = 0;
  while (!options.stopping()) {
    try {
      const claimed = await options.runOnce();
      failures = 0;
      if (!claimed && !options.stopping()) await options.wait(options.pollIntervalMs);
    } catch (error) {
      failures += 1;
      const retryMs = Math.min(60_000, 1_000 * 2 ** Math.min(failures - 1, 6));
      options.reportFailure(error, retryMs);
      if (!options.stopping()) await options.wait(retryMs);
    }
  }
}
