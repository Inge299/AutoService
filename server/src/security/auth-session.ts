import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AuthScope, Prisma, PrismaClient } from "@prisma/client";
import { createAccessToken, type AccessTokenActor } from "./access-token.js";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export interface SessionIdentity {
  userId: string;
  workshopId: string;
  scope: AuthScope;
  customerId?: string;
}

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresAtEpochMs: number;
  refreshToken: string;
  refreshTokenExpiresAtEpochMs: number;
}

const DEFAULT_REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newRefreshToken(sessionId: string): string {
  return `${sessionId}.${randomBytes(32).toString("base64url")}`;
}

function parseSessionId(refreshToken: string): string | null {
  const [sessionId, secret, extra] = refreshToken.split(".");
  if (!sessionId || !secret || extra) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
    ? sessionId
    : null;
}

function accessActor(sessionId: string, identity: SessionIdentity): AccessTokenActor {
  return {
    sessionId,
    userId: identity.userId,
    workshopId: identity.workshopId,
    scope: identity.scope,
    ...(identity.customerId ? { customerId: identity.customerId } : {}),
  };
}

export async function issueSession(
  prisma: DatabaseClient,
  identity: SessionIdentity,
  accessTokenSecret: string,
  now = new Date(),
  refreshTtlMs = DEFAULT_REFRESH_TTL_MS,
  accessTtlMs?: number,
): Promise<SessionTokens> {
  const sessionId = randomUUID();
  const refreshToken = newRefreshToken(sessionId);
  const expiresAt = new Date(now.getTime() + refreshTtlMs);
  await prisma.authSession.create({
    data: {
      id: sessionId,
      ...identity,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      lastUsedAt: now,
    },
  });
  const access = createAccessToken(accessActor(sessionId, identity), accessTokenSecret, now.getTime(), accessTtlMs);
  return {
    accessToken: access.token,
    accessTokenExpiresAtEpochMs: access.expiresAt,
    refreshToken,
    refreshTokenExpiresAtEpochMs: expiresAt.getTime(),
  };
}

export async function rotateSession(
  prisma: PrismaClient,
  refreshToken: string,
  accessTokenSecret: string,
  now = new Date(),
  accessTtlMs?: number,
): Promise<SessionTokens | null> {
  const sessionId = parseSessionId(refreshToken);
  if (!sessionId) return null;
  const session = await prisma.authSession.findUnique({ where: { id: sessionId } });
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  if (session.refreshTokenHash !== hashRefreshToken(refreshToken)) return null;

  const rotatedToken = newRefreshToken(session.id);
  const changed = await prisma.authSession.updateMany({
    where: {
      id: session.id,
      refreshTokenHash: session.refreshTokenHash,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { refreshTokenHash: hashRefreshToken(rotatedToken), lastUsedAt: now },
  });
  if (changed.count !== 1) return null;

  const identity: SessionIdentity = {
    userId: session.userId,
    workshopId: session.workshopId,
    scope: session.scope,
    ...(session.customerId ? { customerId: session.customerId } : {}),
  };
  const access = createAccessToken(accessActor(session.id, identity), accessTokenSecret, now.getTime(), accessTtlMs);
  return {
    accessToken: access.token,
    accessTokenExpiresAtEpochMs: access.expiresAt,
    refreshToken: rotatedToken,
    refreshTokenExpiresAtEpochMs: session.expiresAt.getTime(),
  };
}

export async function revokeSession(prisma: PrismaClient, sessionId: string, now = new Date()): Promise<void> {
  await prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
}
