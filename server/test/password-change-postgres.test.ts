import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";
import { issueSession } from "../src/security/auth-session.js";
import { hashPassword, verifyPassword } from "../src/security/password.js";

// This suite never falls back to production DATABASE_URL.
describe.skipIf(!process.env.TEST_DATABASE_URL)("password change revokes other sessions atomically", () => {
  const workshopId = randomUUID(), secret = "synthetic-password-session-secret-2026";
  const users: string[] = [];
  let prisma: PrismaClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const config = { NODE_ENV: "test", LOG_LEVEL: "silent", HOST: "127.0.0.1", PORT: 8080,
    SMS_PROVIDER: "disabled", DATABASE_URL: "postgresql://unused", S3_REGION: "test", S3_BUCKET: "test",
    S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test", S3_FORCE_PATH_STYLE: true,
    WORKER_POLL_INTERVAL_MS: 1000, ACCESS_TOKEN_SECRET: secret } as Config;
  const appFor = (db: PrismaClient) => buildApp(config, { prisma: db, storage: {} as ObjectStorage });
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
    await prisma.workshop.create({ data: { id: workshopId, name: "Synthetic password security" } });
    app = await appFor(prisma);
  });
  afterAll(async () => {
    await app.close();
    await prisma.workshop.delete({ where: { id: workshopId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });
  async function account() {
    const id = randomUUID(); users.push(id);
    const login = `session-${id}`;
    await prisma.user.create({ data: { id, login, displayName: "Synthetic password account", passwordHash: await hashPassword("old12"),
      memberships: { create: { workshopId, role: "EMPLOYEE" } } } });
    const identity = { userId: id, workshopId, scope: "STAFF" as const };
    return { id, login, current: await issueSession(prisma, identity, secret), other: await issueSession(prisma, identity, secret) };
  }
  const headers = (token: string) => ({ authorization: `Bearer ${token}` });
  const status = async (token: string) => (await app.inject({ method: "GET", url: "/v1/session", headers: headers(token) })).statusCode;
  const change = (token: string, password = "new123", currentPassword = "old12", target = app) => target.inject({
    method: "POST", url: "/v1/auth/change-password", headers: headers(token), payload: { currentPassword, newPassword: password },
  });

  it("accepts six characters, retains the current session and revokes other access and refresh tokens", async () => {
    const user = await account(), unrelated = await account();
    // Existing five-character passwords can still log in until their owner changes them.
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { login: user.login, password: "old12" } });
    expect(login.statusCode).toBe(200);
    expect((await change(user.current.accessToken)).statusCode).toBe(204);
    expect(await status(user.current.accessToken)).toBe(200);
    expect(await status(user.other.accessToken)).toBe(401);
    expect(await status(login.json().accessToken)).toBe(401);
    expect(await status(unrelated.other.accessToken)).toBe(200);
    const refresh = (token: string) => app.inject({ method: "POST", url: "/public/v1/auth/refresh", payload: { refreshToken: token } });
    expect((await refresh(user.other.refreshToken)).statusCode).toBe(401);
    expect((await refresh(user.current.refreshToken)).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/auth/login", payload: { login: user.login, password: "old12" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/auth/login", payload: { login: user.login, password: "new123" } })).statusCode).toBe(200);
    expect(await prisma.auditEvent.count({ where: { entityId: user.id, action: "USER_PASSWORD_CHANGED" } })).toBe(1);
  });

  it("does not change the password or revoke sessions on an invalid old password or a five-character replacement", async () => {
    const user = await account();
    expect((await change(user.current.accessToken, "short")).statusCode).toBe(400);
    expect((await change(user.current.accessToken, "new123", "incorrect")).statusCode).toBe(401);
    expect(await status(user.other.accessToken)).toBe(200);
    expect(await verifyPassword("old12", (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash!)).toBe(true);
  });

  it("rolls back password and session revocation when the audit write fails", async () => {
    const user = await account();
    const failing = new Proxy(prisma, { get(target, key) {
      if (key === "$transaction") return (action: (tx: unknown) => Promise<unknown>) => target.$transaction(tx => action(new Proxy(tx, {
        get(transaction, property) {
          if (property === "auditEvent") return { create: async () => { throw new Error("Synthetic audit failure"); } };
          return Reflect.get(transaction, property);
        },
      })));
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const failingApp = await appFor(failing);
    try { expect((await change(user.current.accessToken, "new123", "old12", failingApp)).statusCode).toBe(500); }
    finally { await failingApp.close(); }
    expect(await status(user.other.accessToken)).toBe(200);
    expect(await verifyPassword("old12", (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash!)).toBe(true);
  });

  it("allows only one of two concurrent changes using the same old password", async () => {
    const user = await account();
    const responses = await Promise.all([change(user.current.accessToken, "newA12"), change(user.current.accessToken, "newB12")]);
    expect(responses.map(r => r.statusCode).sort()).toEqual([204, 401]);
    expect(await status(user.current.accessToken)).toBe(200);
    expect(await status(user.other.accessToken)).toBe(401);
    expect(await prisma.auditEvent.count({ where: { entityId: user.id, action: "USER_PASSWORD_CHANGED" } })).toBe(1);
  });
});
