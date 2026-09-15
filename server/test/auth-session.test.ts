import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { verifyAccessToken } from "../src/security/access-token.js";
import { issueSession, rotateSession } from "../src/security/auth-session.js";

const userId = "22222222-2222-4222-8222-222222222222";
const workshopId = "11111111-1111-4111-8111-111111111111";
const secret = "s".repeat(32);

describe("persistent authentication sessions", () => {
  it("stores only a refresh-token hash and binds the access token to the session", async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = { authSession: { create } } as unknown as PrismaClient;
    const now = new Date("2026-09-15T00:00:00.000Z");

    const tokens = await issueSession(prisma, { userId, workshopId, scope: "STAFF" }, secret, now);

    expect(tokens.refreshToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/i);
    const saved = create.mock.calls[0]?.[0].data;
    expect(saved.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.refreshTokenHash).not.toContain(tokens.refreshToken);
    expect(verifyAccessToken(tokens.accessToken, secret, now.getTime())).toMatchObject({
      sessionId: saved.id,
      userId,
      workshopId,
      scope: "STAFF",
    });
  });

  it("rotates a refresh token atomically and rejects its reuse", async () => {
    const created: { data?: Record<string, unknown> } = {};
    const issuingPrisma = {
      authSession: { create: vi.fn(async ({ data }) => { created.data = data; return data; }) },
    } as unknown as PrismaClient;
    const now = new Date("2026-09-15T00:00:00.000Z");
    const issued = await issueSession(issuingPrisma, { userId, workshopId, scope: "STAFF" }, secret, now);
    const row = created.data!;
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = {
      authSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: row.id,
          userId,
          workshopId,
          customerId: null,
          scope: "STAFF",
          refreshTokenHash: row.refreshTokenHash,
          expiresAt: row.expiresAt,
          revokedAt: null,
        }),
        updateMany,
      },
    } as unknown as PrismaClient;

    const rotated = await rotateSession(prisma, issued.refreshToken, secret, new Date(now.getTime() + 1_000));
    const reused = await rotateSession(prisma, issued.refreshToken, secret, new Date(now.getTime() + 2_000));

    expect(rotated?.refreshToken).not.toBe(issued.refreshToken);
    expect(reused).toBeNull();
  });
});
