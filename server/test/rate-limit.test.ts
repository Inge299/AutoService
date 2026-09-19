import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "../src/infrastructure/rate-limit.js";

describe("FixedWindowRateLimiter", () => {
  it("limits a key and starts a new window after expiry", () => {
    const limiter = new FixedWindowRateLimiter();
    expect(limiter.take("public-read:203.0.113.1", 2, 60_000, 1_000).allowed).toBe(true);
    expect(limiter.take("public-read:203.0.113.1", 2, 60_000, 1_001).allowed).toBe(true);
    expect(limiter.take("public-read:203.0.113.1", 2, 60_000, 1_002)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(limiter.take("public-read:203.0.113.1", 2, 60_000, 61_000).allowed).toBe(true);
  });

  it("keeps independent client addresses separate", () => {
    const limiter = new FixedWindowRateLimiter();
    limiter.take("public-mutation:203.0.113.1", 1, 60_000, 1_000);
    expect(limiter.take("public-mutation:203.0.113.2", 1, 60_000, 1_001).allowed).toBe(true);
  });
});
