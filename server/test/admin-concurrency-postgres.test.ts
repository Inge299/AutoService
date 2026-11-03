import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../src/http/errors.js";
import { adminUserRoutes } from "../src/http/routes/admin-users.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("administrator concurrency", () => {
  const workshopId = randomUUID(), first = randomUUID(), second = randomUUID();
  let prisma: PrismaClient;
  const app = Fastify();
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
    await prisma.workshop.create({ data: { id: workshopId, name: "Synthetic admin concurrency" } });
    for (const id of [first, second]) await prisma.user.create({ data: { id, displayName: "Synthetic admin", memberships: { create: { workshopId, role: "ADMIN" } } } });
    registerErrorHandler(app);
    app.addHook("preHandler", async request => { request.actor = { workshopId, userId: String(request.headers["x-test-actor"]), role: "ADMIN" }; });
    await app.register(adminUserRoutes(prisma));
  });
  afterAll(async () => {
    await app.close();
    await prisma.workshop.delete({ where: { id: workshopId } });
    await prisma.user.deleteMany({ where: { id: { in: [first, second] } } });
    await prisma.$disconnect();
  });
  it.each(["state", "role"])("keeps an active admin during concurrent %s changes", async kind => {
    for (let iteration = 0; iteration < 5; iteration++) {
      await prisma.membership.updateMany({ where: { workshopId }, data: { isActive: true, role: "ADMIN" } });
      const payload = kind === "state" ? { isActive: false } : { role: "EMPLOYEE" };
      const call = (actor: string, target: string) => app.inject({ method: "PATCH", url: `/v1/admin/users/${target}/${kind}`, headers: { "x-test-actor": actor }, payload });
      const results = await Promise.all([call(first, second), call(second, first)]);
      expect(results.map(result => result.statusCode).sort()).toEqual([200, 403]);
      expect(await prisma.membership.count({ where: { workshopId, isActive: true, role: "ADMIN", user: { isActive: true } } })).toBe(1);
    }
  });
});
