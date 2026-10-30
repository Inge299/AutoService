import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../src/http/errors.js";
import { reportRoutes } from "../src/http/routes/reports.js";
import { findingRoutes } from "../src/http/routes/findings.js";
import { visitRoutes } from "../src/http/routes/visits.js";
import { deliverReminder } from "../src/infrastructure/send-reminder.js";

// Never fall back to the production DATABASE_URL.
describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgreSQL report revision integrity", () => {
  let prisma: PrismaClient;
  const workshopId = randomUUID(), userId = randomUUID();
  const app = Fastify();
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
    await prisma.workshop.create({ data: { id: workshopId, name: "Synthetic report revision test" } });
    await prisma.user.create({ data: { id: userId, displayName: "Synthetic test actor" } });
    registerErrorHandler(app);
    app.addHook("preHandler", async request => { request.actor = { workshopId, userId, role: "EMPLOYEE" }; });
    await app.register(reportRoutes(prisma)); await app.register(findingRoutes(prisma)); await app.register(visitRoutes(prisma));
  });
  afterAll(async () => {
    await app.close();
    await prisma.reportVersion.deleteMany({ where: { workshopId } });
    await prisma.workshop.delete({ where: { id: workshopId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function visit() {
    const id = randomUUID();
    return prisma.visit.create({ data: { id, workshopId, customerName: "Synthetic", customerPhone: "+79990000000",
      vehicleLabel: "Synthetic", licensePlate: "Т001ТТ77", complaint: "Test", status: "IN_REPAIR", createdAt: new Date(), updatedAt: new Date() } });
  }
  const draft = (id: string, nextVisitAt: string | null) => app.inject({ method: "PUT", url: `/v1/visits/${id}/report`,
    payload: { completedWork: "Synthetic completed work", recommendations: "Synthetic future work", nextVisitAt } });
  const publish = (id: string, payload = { operationId: randomUUID(), token: randomUUID().replaceAll("-", "") }) =>
    app.inject({ method: "POST", url: `/v1/visits/${id}/report/publish`, payload });

  it("revokes inside the transaction, kills queued work, and schedules only the replacement", async () => {
    const v = await visit();
    expect((await draft(v.id, "2099-01-10T09:00:00Z")).statusCode).toBe(200);
    const payload = { operationId: randomUUID(), token: randomUUID().replaceAll("-", "") };
    expect((await publish(v.id, payload)).statusCode).toBe(201);
    expect((await publish(v.id, payload)).statusCode).toBe(200);
    const old = await prisma.reminder.findFirstOrThrow({ where: { visitId: v.id } });
    // A previously claimed/retried job must not survive revocation either.
    await prisma.backgroundJob.updateMany({ where: { reminderId: old.id }, data: { state: "RUNNING", lockedUntil: new Date(Date.now() + 60_000) } });
    expect((await app.inject({ method: "DELETE", url: `/v1/visits/${v.id}/report-link` })).statusCode).toBe(204);
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: old.id } })).state).toBe("CANCELLED");
    const oldJob = await prisma.backgroundJob.findFirstOrThrow({ where: { reminderId: old.id } });
    expect(oldJob.state).toBe("DEAD"); expect(oldJob.lockedUntil).toBeNull();
    expect((await prisma.report.findUniqueOrThrow({ where: { visitId: v.id } })).status).toBe("DRAFT");
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("IN_REPAIR");
    expect((await prisma.reportLink.findFirstOrThrow({ where: { reportVersion: { visitId: v.id } } })).revokedAt).not.toBeNull();
    expect((await publish(v.id, payload)).json().error).toBe("report_link_revoked");
    expect((await draft(v.id, "2100-02-10T09:00:00Z")).statusCode).toBe(200);
    expect((await publish(v.id)).statusCode).toBe(201);
    expect(await prisma.reminder.count({ where: { visitId: v.id, state: "PENDING" } })).toBe(1);
    expect(await prisma.reminder.count({ where: { visitId: v.id, state: "CANCELLED" } })).toBe(1);
    expect(await prisma.backgroundJob.count({ where: { reminder: { visitId: v.id }, state: { in: ["PENDING", "RETRY", "RUNNING"] } } })).toBe(1);
  });

  it("cleans an old pending reminder even when the replacement has no next-visit date", async () => {
    const v = await visit(); await draft(v.id, "2099-01-10T09:00:00Z"); await publish(v.id);
    const old = await prisma.reminder.findFirstOrThrow({ where: { visitId: v.id } });
    await app.inject({ method: "DELETE", url: `/v1/visits/${v.id}/report-link` });
    // Simulate a leftover from a release that did not cancel on revocation.
    await prisma.reminder.update({ where: { id: old.id }, data: { state: "PENDING", cancelledAt: null } });
    await prisma.backgroundJob.updateMany({ where: { reminderId: old.id }, data: { state: "RETRY" } });
    await draft(v.id, null); expect((await publish(v.id)).statusCode).toBe(201);
    expect(await prisma.reminder.count({ where: { visitId: v.id, state: "PENDING" } })).toBe(0);
    expect(await prisma.backgroundJob.count({ where: { reminderId: old.id, state: { not: "DEAD" } } })).toBe(0);
  });

  it("cannot create two versions or two reminders in concurrent publication", async () => {
    const v = await visit(); await draft(v.id, "2099-01-10T09:00:00Z");
    const responses = await Promise.all([publish(v.id), publish(v.id)]);
    expect(responses.map(r => r.statusCode).sort()).toEqual([201, 409]);
    expect(await prisma.reportVersion.count({ where: { visitId: v.id } })).toBe(1);
    expect(await prisma.reminder.count({ where: { visitId: v.id, state: "PENDING" } })).toBe(1);
  });

  it("serializes publication against finding creation so the snapshot cannot silently miss an accepted finding", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const v = await visit(); await draft(v.id, null); const findingId = randomUUID();
      const [published, saved] = await Promise.all([publish(v.id), app.inject({ method: "PUT", url: `/v1/findings/${findingId}`,
        payload: { visitId: v.id, title: "Concurrent work", description: "Test", priceRub: 100, priority: "PLANNED", status: "DRAFT",
          createdAtEpochMs: Date.now(), updatedAtEpochMs: Date.now(), baseServerVersion: null } })]);
      expect(published.statusCode).toBe(201); expect([200, 409]).toContain(saved.statusCode);
      const version = await prisma.reportVersion.findFirstOrThrow({ where: { visitId: v.id } });
      const containsFinding = (version.findings as Array<{ id: string }>).some(f => f.id === findingId);
      expect(containsFinding).toBe(saved.statusCode === 200);
    }
  });

  it("does not resurrect a cancelled reminder when an in-flight provider response arrives", async () => {
    const v = await visit(); await draft(v.id, "2099-01-10T09:00:00Z"); await publish(v.id);
    const reminder = await prisma.reminder.findFirstOrThrow({ where: { visitId: v.id } });
    await deliverReminder(prisma, {
      send: async () => {
        expect((await app.inject({ method: "DELETE", url: `/v1/visits/${v.id}/report-link` })).statusCode).toBe(204);
        return { providerMessageId: "synthetic-provider-receipt" };
      },
      status: async () => "DELIVERED",
    }, reminder.id);
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).state).toBe("CANCELLED");
    expect(await prisma.backgroundJob.count({ where: { reminderId: reminder.id, type: "CHECK_REMINDER_DELIVERY" } })).toBe(0);
  });

  it("rolls the whole revocation back if cancelling queued work fails", async () => {
    const v = await visit(); await draft(v.id, "2099-01-10T09:00:00Z"); await publish(v.id);
    const failingClient = prisma.$extends({ query: { backgroundJob: {
      updateMany: async () => { throw new Error("Synthetic queue failure"); },
    } } });
    const failingApp = Fastify(); registerErrorHandler(failingApp);
    failingApp.addHook("preHandler", async request => { request.actor = { workshopId, userId, role: "EMPLOYEE" }; });
    await failingApp.register(reportRoutes(failingClient as unknown as PrismaClient));
    try {
      expect((await failingApp.inject({ method: "DELETE", url: `/v1/visits/${v.id}/report-link` })).statusCode).toBe(500);
      expect((await prisma.report.findUniqueOrThrow({ where: { visitId: v.id } })).status).toBe("PUBLISHED");
      expect((await prisma.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("COMPLETED");
      expect((await prisma.reportLink.findFirstOrThrow({ where: { reportVersion: { visitId: v.id } } })).revokedAt).toBeNull();
      expect((await prisma.reminder.findFirstOrThrow({ where: { visitId: v.id } })).state).toBe("PENDING");
    } finally { await failingApp.close(); }
  });
});
