import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const payloadSchema = z.object({
  version: z.literal(2),
  sessionId: z.string().uuid(),
  userId: z.string().uuid(),
  workshopId: z.string().uuid(),
  scope: z.enum(["STAFF", "CUSTOMER"]).default("STAFF"),
  customerId: z.string().uuid().optional(),
  expiresAt: z.number().int().positive(),
});

export interface AccessTokenActor {
  sessionId: string;
  userId: string;
  workshopId: string;
  scope?: "STAFF" | "CUSTOMER";
  customerId?: string;
}

export const DEFAULT_ACCESS_TOKEN_TTL_MS = 15 * 60_000;

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function createAccessToken(
  actor: AccessTokenActor,
  secret: string,
  now = Date.now(),
  ttlMs = DEFAULT_ACCESS_TOKEN_TTL_MS,
): { token: string; expiresAt: number } {
  const expiresAt = now + ttlMs;
  const payload = Buffer.from(JSON.stringify({ version: 2, ...actor, expiresAt })).toString("base64url");
  return {
    token: `${payload}.${signature(payload, secret).toString("base64url")}`,
    expiresAt,
  };
}

export function verifyAccessToken(token: string, secret: string, now = Date.now()): AccessTokenActor | null {
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra) return null;

  try {
    const suppliedSignature = Buffer.from(encodedSignature, "base64url");
    const expectedSignature = signature(payload, secret);
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) return null;

    const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.expiresAt <= now) return null;
    if (parsed.data.scope === "CUSTOMER" && !parsed.data.customerId) return null;
    return {
      sessionId: parsed.data.sessionId,
      userId: parsed.data.userId,
      workshopId: parsed.data.workshopId,
      scope: parsed.data.scope,
      ...(parsed.data.customerId ? { customerId: parsed.data.customerId } : {}),
    };
  } catch {
    return null;
  }
}
