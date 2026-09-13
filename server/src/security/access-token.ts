import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const payloadSchema = z.object({
  version: z.literal(1),
  userId: z.string().uuid(),
  workshopId: z.string().uuid(),
  expiresAt: z.number().int().positive(),
});

export interface AccessTokenActor {
  userId: string;
  workshopId: string;
}

const DEFAULT_TTL_MS = 12 * 60 * 60_000;

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function createAccessToken(
  actor: AccessTokenActor,
  secret: string,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
): { token: string; expiresAt: number } {
  const expiresAt = now + ttlMs;
  const payload = Buffer.from(JSON.stringify({ version: 1, ...actor, expiresAt })).toString("base64url");
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
    return { userId: parsed.data.userId, workshopId: parsed.data.workshopId };
  } catch {
    return null;
  }
}
