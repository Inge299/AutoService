import { describe, expect, it } from "vitest";
import { runWorkerLoop } from "../src/infrastructure/worker-loop.js";

describe("worker supervision", () => {
  it("backs off after failures in the job cycle and resumes polling after recovery", async () => {
    let stopped = false;
    let cycles = 0;
    const waits: number[] = [];
    const failures: number[] = [];
    await runWorkerLoop({
      stopping: () => stopped,
      pollIntervalMs: 250,
      runOnce: async () => {
        cycles++;
        if (cycles <= 3 || cycles === 5) throw new Error("database unavailable");
        if (cycles === 6) stopped = true;
        return false;
      },
      wait: async ms => { waits.push(ms); },
      reportFailure: (_error, retryMs) => { failures.push(retryMs); },
    });
    expect(failures).toEqual([1_000, 2_000, 4_000, 1_000]);
    expect(waits).toEqual([1_000, 2_000, 4_000, 250, 1_000]);
  });

  it("caps retries and stops without waiting after shutdown", async () => {
    let stopped = false;
    const failures: number[] = [];
    await runWorkerLoop({
      stopping: () => stopped,
      pollIntervalMs: 250,
      runOnce: async () => { if (failures.length === 9) stopped = true; throw new Error("unavailable"); },
      wait: async () => {},
      reportFailure: (_error, retryMs) => { failures.push(retryMs); },
    });
    expect(failures).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000, 60_000]);
  });
});
