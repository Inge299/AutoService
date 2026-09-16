import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";
import { hashPassword } from "../src/security/password.js";

const config: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 8080,
  LOG_LEVEL: "silent",
  SMS_PROVIDER: "disabled",
  DATABASE_URL: "postgresql://unused",
  S3_REGION: "ru-central1",
  S3_BUCKET: "test-bucket",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  S3_FORCE_PATH_STYLE: true,
  WORKER_POLL_INTERVAL_MS: 100,
};

const workshopId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const headers = { "x-workshop-id": workshopId, "x-user-id": userId };

function basePrisma(role: "ADMIN" | "EMPLOYEE" = "ADMIN") {
  return {
    membership: {
      findUnique: vi.fn().mockResolvedValue({ role, isActive: true, user: { isActive: true } }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("database authentication and administration", () => {
  it("authenticates an active database user", async () => {
    const passwordHash = await hashPassword("strong-password");
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: userId,
          displayName: "Администратор",
          isActive: true,
          passwordHash,
          memberships: [{ workshopId, role: "ADMIN" }],
        }),
      },
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: "Admin", password: "strong-password" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      userId,
      workshopId,
      displayName: "Администратор",
      role: "ADMIN",
    });
    await app.close();
  });

  it("limits failed password attempts per login without blocking another login", async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { login: "first-user", password: "wrong-password" },
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: "first-user", password: "wrong-password" },
    });
    expect(limited.statusCode).toBe(429);

    const otherLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: "second-user", password: "wrong-password" },
    });
    expect(otherLogin.statusCode).toBe(401);
    await app.close();
  });

  it("issues a signed token and accepts it without internal headers", async () => {
    const passwordHash = await hashPassword("strong-password");
    const membership = { role: "EMPLOYEE", isActive: true, user: { isActive: true } };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: userId,
          displayName: "Мастер",
          isActive: true,
          passwordHash,
          memberships: [{ workshopId, role: "EMPLOYEE" }],
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: userId, login: "master", displayName: "Мастер" }),
      },
      membership: { findUnique: vi.fn().mockResolvedValue(membership) },
      authSession: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          userId,
          workshopId,
          scope: "STAFF",
          customerId: null,
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
      },
    } as unknown as PrismaClient;
    const protectedConfig = {
      ...config,
      INTERNAL_API_KEY: "a".repeat(32),
      ACCESS_TOKEN_SECRET: "b".repeat(32),
    };
    const app = await buildApp(protectedConfig, { prisma, storage: {} as ObjectStorage });

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { login: "master", password: "strong-password" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().accessToken).toEqual(expect.any(String));
    expect(prisma.authSession.create).toHaveBeenCalledOnce();
    const sessionData = vi.mocked(prisma.authSession.create).mock.calls[0]?.[0].data;
    expect(sessionData).toMatchObject({ userId, workshopId, scope: "STAFF" });
    expect(sessionData).not.toHaveProperty("displayName");
    expect(sessionData).not.toHaveProperty("role");

    const session = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { authorization: `Bearer ${login.json().accessToken}` },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ id: userId, workshopId, role: "EMPLOYEE" });
    await app.close();
  });

  it("rejects a disabled membership even with valid actor headers", async () => {
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: "EMPLOYEE", isActive: false, user: { isActive: true } }) },
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({ method: "GET", url: "/v1/session", headers });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "access_revoked" });
    await app.close();
  });

  it("allows only administrators to list workshop users", async () => {
    const prisma = basePrisma("EMPLOYEE") as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({ method: "GET", url: "/v1/admin/users", headers });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "admin_required" });
    await app.close();
  });

  it("returns users scoped to the administrator workshop", async () => {
    const findMany = vi.fn().mockResolvedValue([{ role: "ADMIN", isActive: true, createdAt: new Date(), user: {
      id: userId, login: "admin", displayName: "Администратор", phone: null, isActive: true,
    } }]);
    const prisma = {
      ...basePrisma(),
      membership: { ...basePrisma().membership, findMany },
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({ method: "GET", url: "/v1/admin/users", headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({ login: "admin", role: "ADMIN", isActive: true, isCurrent: true });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workshopId } }));
    await app.close();
  });
});
