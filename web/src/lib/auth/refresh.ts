import "server-only";

import { createHash } from "node:crypto";
import type { BackendTokens } from "@/lib/auth/session";
import { refreshAuthTokens } from "@/lib/api/autoservice-api";

const inFlight = new Map<string, Promise<BackendTokens>>();

export function refreshAuthTokensSingleFlight(refreshToken: string): Promise<BackendTokens> {
  const key = createHash("sha256").update(refreshToken).digest("hex");
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = refreshAuthTokens(refreshToken);
  inFlight.set(key, request);
  void request.then(
    () => setTimeout(() => inFlight.delete(key), 5_000),
    () => setTimeout(() => inFlight.delete(key), 5_000),
  );
  return request;
}
