import { PrismaClient } from "@prisma/client";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("initial seed on PostgreSQL", () => {
  const schema = `seed_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(databaseUrl || "postgresql://unused/unused");
  url.searchParams.set("schema", schema);
  let prisma: PrismaClient;
  const environment = () => {
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url.toString() };
    delete env.BOOTSTRAP_ADMIN_LOGIN;
    delete env.BOOTSTRAP_ADMIN_PASSWORD_HASH;
    delete env.BOOTSTRAP_USERS_JSON;
    return env;
  };
  const seed = (extra: Record<string, string> = {}) => spawnSync("./node_modules/.bin/tsx", ["prisma/seed.ts"], {
    cwd: process.cwd(), env: { ...environment(), ...extra }, encoding: "utf8",
  });
  beforeAll(async () => {
    execFileSync("./node_modules/.bin/prisma", ["migrate", "deploy"], { env: environment(), stdio: "pipe" });
    prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  }, 60000);
  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await prisma.$disconnect();
    }
  });
  it("fails before writing without valid credentials, seeds once, and never restores a disabled administrator", async () => {
    expect(seed().status).not.toBe(0);
    expect(seed({ BOOTSTRAP_ADMIN_LOGIN: "admin", BOOTSTRAP_ADMIN_PASSWORD_HASH: "bad" }).status).not.toBe(0);
    expect(await prisma.workshop.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
    const hash = `${"ab".repeat(16)}:${"cd".repeat(64)}`;
    const conflictingUser = JSON.stringify([{ userId: randomUUID(), workshopId: randomUUID(), login: "PilotAdmin", passwordHash: hash, displayName: "Duplicate", role: "EMPLOYEE" }]);
    expect(seed({ BOOTSTRAP_ADMIN_LOGIN: "PilotAdmin", BOOTSTRAP_ADMIN_PASSWORD_HASH: hash, BOOTSTRAP_USERS_JSON: conflictingUser }).status).not.toBe(0);
    expect(await prisma.workshop.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
    expect(seed({ BOOTSTRAP_ADMIN_LOGIN: "PilotAdmin", BOOTSTRAP_ADMIN_PASSWORD_HASH: hash }).status).toBe(0);
    const admin = await prisma.user.findUniqueOrThrow({ where: { login: "pilotadmin" } });
    expect(admin.passwordHash).toBe(hash);
    expect(seed({ BOOTSTRAP_ADMIN_LOGIN: "different", BOOTSTRAP_ADMIN_PASSWORD_HASH: `${"ef".repeat(16)}:${"ab".repeat(64)}` }).status).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash).toBe(hash);
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    expect(seed().status).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).isActive).toBe(false);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.membership.count()).toBe(1);
  }, 60000);
});
