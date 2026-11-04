import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../src/http/errors.js";
import { reportRoutes } from "../src/http/routes/reports.js";
import { mediaRoutes } from "../src/http/routes/media.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";
import { findingRoutes } from "../src/http/routes/findings.js";
import { visitRoutes } from "../src/http/routes/visits.js";
import { customerVisibleMediaIds, projectReportFindings } from "../src/domain/customer-visibility.js";
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
    await app.register(reportRoutes(prisma)); await app.register(mediaRoutes(prisma, { createUploadTarget: async () => ({ url: "https://example.test/upload" }) } as unknown as ObjectStorage)); await app.register(findingRoutes(prisma)); await app.register(visitRoutes(prisma));
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
  const publish = (id: string, payload: { operationId: string; token: string; expectedMediaIds?: string[] } = { operationId: randomUUID(), token: randomUUID().replaceAll("-", "") }) =>
    app.inject({ method: "POST", url: `/v1/visits/${id}/report/publish`, payload: { expectedMediaIds: [], ...payload } });

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

  it("requires acknowledgement of private drafts and preserves immutable media associations", async () => {
    const v = await visit(); await draft(v.id, null);
    const hiddenId = randomUUID(), visibleId = randomUUID();
    for (const [id, status, title] of [[hiddenId, "DRAFT", "Private draft"], [visibleId, "COMPLETED", "Visible work"]] as const) {
      await prisma.finding.create({ data: { id, workshopId, visitId: v.id, title, description: "QA", priceRub: 100,
        priority: "PLANNED", status, createdAt: new Date(), updatedAt: new Date() } });
    }
    const generalMedia = randomUUID(), privateMedia = randomUUID(), visibleMedia = randomUUID();
    for (const [id, findingId] of [[generalMedia, null], [privateMedia, hiddenId], [visibleMedia, visibleId]] as const) {
      await prisma.mediaAsset.create({ data: { id, operationId: randomUUID(), workshopId, visitId: v.id, findingId,
        kind: "PHOTO", mimeType: "image/jpeg", byteCount: 1n, sha256: "a".repeat(64), objectKey: `qa/${id}/verified`, state: "READY" } });
    }
    expect((await publish(v.id)).json().error).toBe("private_findings_changed");
    const response = await app.inject({ method: "POST", url: `/v1/visits/${v.id}/report/publish`, payload: {
      operationId: randomUUID(), token: randomUUID().replaceAll("-", ""), acknowledgedPrivateFindingIds: [hiddenId], expectedMediaIds: [generalMedia, visibleMedia],
    } });
    expect(response.statusCode).toBe(201);
    const version = await prisma.reportVersion.findFirstOrThrow({ where: { visitId: v.id } });
    expect(version.recommendations).not.toContain("Private draft");
    const projection = projectReportFindings(version.findings);
    const ids = customerVisibleMediaIds(version.mediaIds, version.mediaManifest, projection.visibleIds, projection.hasHidden, []);
    expect(ids.sort()).toEqual([generalMedia, visibleMedia].sort());
    const portalCount = await prisma.visit.findUniqueOrThrow({ where: { id: v.id }, select: { _count: { select: { media: { where: {
      state: { in: ["VERIFIED", "READY"] }, OR: [{ findingId: null }, { finding: { is: { status: { in: ["SENT_TO_CUSTOMER", "APPROVED", "COMPLETED", "DECLINED", "DEFERRED", "CALL_REQUESTED"] } } } }],
    } } } } } });
    expect(portalCount._count.media).toBe(2);
  });

  it("publishes an explicitly selected private work as a recommendation without exposing its media", async () => {
    const v = await visit(); await draft(v.id, null);
    const findingId = randomUUID(), mediaId = randomUUID();
    const dueAt = new Date("2099-11-20T09:00:00Z");
    await prisma.finding.create({ data: { id: findingId, workshopId, visitId: v.id, title: "Synthetic recommendation", description: "Inspect",
      priceRub: null, priority: "IMPORTANT", status: "DRAFT", followUpConfigured: true, followUpDueAt: dueAt, followUpState: "OPEN",
      createdAt: new Date(), updatedAt: new Date() } });
    await prisma.mediaAsset.create({ data: { id: mediaId, operationId: randomUUID(), workshopId, visitId: v.id, findingId,
      kind: "PHOTO", mimeType: "image/jpeg", byteCount: 1n, sha256: "a".repeat(64), objectKey: `qa/${mediaId}/verified`, state: "READY" } });
    const payload = { operationId: randomUUID(), token: randomUUID().replaceAll("-", ""), expectedMediaIds: [],
      acknowledgedPrivateFindingIds: [findingId], recommendedPrivateFindingIds: [findingId] };
    expect((await app.inject({ method: "POST", url: `/v1/visits/${v.id}/report/publish`, payload: { ...payload, recommendedPrivateFindingIds: [randomUUID()] } })).json().error).toBe("recommendations_changed");
    const response = await app.inject({ method: "POST", url: `/v1/visits/${v.id}/report/publish`, payload });
    expect(response.statusCode).toBe(201);
    const version = await prisma.reportVersion.findFirstOrThrow({ where: { visitId: v.id } });
    const projection = projectReportFindings(version.findings);
    expect(projection.visible).toEqual([expect.objectContaining({ id: findingId, status: "RECOMMENDED" })]);
    expect(customerVisibleMediaIds(version.mediaIds, version.mediaManifest, projection.mediaVisibleIds, projection.hasHidden, [])).toEqual([]);
    expect(version.recommendations).toContain("Synthetic recommendation");
    expect(await prisma.reminder.count({ where: { visitId: v.id, findingId, dueAt } })).toBe(1);
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: findingId } })).status).toBe("DRAFT");
  });

  it("does not publish until the expected server media is complete and ready", async () => {
    const v = await visit(); await draft(v.id, null);
    const mediaId = randomUUID();
    await prisma.mediaAsset.create({ data: { id: mediaId, operationId: randomUUID(), workshopId, visitId: v.id,
      kind: "PHOTO", mimeType: "image/jpeg", byteCount: 1n, sha256: "a".repeat(64), objectKey: `qa/${mediaId}/verified`, state: "RETRY" } });
    const payload = { operationId: randomUUID(), token: randomUUID().replaceAll("-", ""), expectedMediaIds: [mediaId] };
    expect((await publish(v.id, payload)).json().error).toBe("report_media_pending");
    await prisma.mediaAsset.update({ where: { id: mediaId }, data: { state: "READY" } });
    expect((await publish(v.id, { ...payload, expectedMediaIds: [] })).json().error).toBe("report_media_changed");
    expect((await publish(v.id, payload)).statusCode).toBe(201);
    expect((await prisma.reportVersion.findFirstOrThrow({ where: { visitId: v.id } })).mediaIds).toEqual([mediaId]);
  });

  it("queues old media once and blocks publication until it is sealed", async () => {
    const v = await visit(); await draft(v.id, null);
    const mediaId = randomUUID();
    await prisma.mediaAsset.create({ data: { id: mediaId, operationId: randomUUID(), workshopId, visitId: v.id,
      kind: "PHOTO", mimeType: "image/jpeg", byteCount: 1n, sha256: "a".repeat(64), objectKey: `qa/${mediaId}/original`, state: "READY" } });
    const payload = { operationId: randomUUID(), token: randomUUID().replaceAll("-", ""), expectedMediaIds: [mediaId] };
    expect((await publish(v.id, payload)).json().error).toBe("report_media_pending");
    expect((await publish(v.id, payload)).json().error).toBe("report_media_pending");
    expect(await prisma.reportVersion.count({ where: { visitId: v.id } })).toBe(0);
    expect(await prisma.backgroundJob.count({ where: { idempotencyKey: `legacy-seal:${mediaId}` } })).toBe(1);
    await prisma.backgroundJob.update({ where: { idempotencyKey: `legacy-seal:${mediaId}` }, data: { state: "DEAD" } });
    expect((await publish(v.id, payload)).json().error).toBe("report_media_failed");
    await prisma.mediaAsset.update({ where: { id: mediaId }, data: { objectKey: `qa/${mediaId}/verified` } });
    expect((await publish(v.id, payload)).statusCode).toBe(201);
  });

  it("waits for old approval media and stops retrying after a terminal preparation failure", async () => {
    const v = await visit(), findingId = randomUUID(), mediaId = randomUUID();
    await prisma.finding.create({ data: { id: findingId, workshopId, visitId: v.id, title: "Synthetic", description: "QA", priceRub: 100,
      priority: "IMPORTANT", status: "READY_FOR_APPROVAL", createdAt: new Date(), updatedAt: new Date() } });
    await prisma.mediaAsset.create({ data: { id: mediaId, operationId: randomUUID(), workshopId, visitId: v.id, findingId,
      kind: "PHOTO", mimeType: "image/jpeg", byteCount: 1n, sha256: "a".repeat(64), objectKey: `qa/${mediaId}/original`, state: "READY" } });
    const payload = { operationId: randomUUID(), token: `approval_${randomUUID().replaceAll("-", "")}_synthetic`, mediaIds: [mediaId] };
    const prepare = () => app.inject({ method: "POST", url: `/v1/findings/${findingId}/approval-link`, payload });
    const pending = await prepare();
    expect(pending.statusCode).toBe(503); expect(pending.json().error).toBe("approval_media_preparing");
    expect(await prisma.approvalVersion.count({ where: { findingId } })).toBe(0);
    await prisma.backgroundJob.update({ where: { idempotencyKey: `legacy-seal:${mediaId}` }, data: { state: "DEAD" } });
    expect((await prepare()).json().error).toBe("approval_media_preparation_failed");
    await prisma.mediaAsset.update({ where: { id: mediaId }, data: { objectKey: `qa/${mediaId}/verified` } });
    expect((await prepare()).statusCode).toBe(201);
  });

  it("serializes report publication against new media registration", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const v = await visit(); await draft(v.id, null);
      const mediaId = randomUUID();
      const [report, upload] = await Promise.all([
        publish(v.id),
        app.inject({ method: "POST", url: `/v1/media/${mediaId}/upload-session`, payload: {
          operationId: randomUUID(), visitId: v.id, findingId: null, kind: "PHOTO", mimeType: "image/jpeg",
          byteCount: 1, sha256: "a".repeat(64),
        } }),
      ]);
      if (report.statusCode === 201) {
        expect(upload.statusCode).toBe(409);
        expect(upload.json().error).toBe("visit_closed");
        expect(await prisma.mediaAsset.count({ where: { id: mediaId } })).toBe(0);
      } else {
        expect(report.statusCode).toBe(409);
        expect(report.json().error).toBe("report_media_pending");
        expect(upload.statusCode).toBe(200);
        expect(await prisma.reportVersion.count({ where: { visitId: v.id } })).toBe(0);
      }
    }
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
      expect([201, 409]).toContain(published.statusCode);
      expect([200, 409]).toContain(saved.statusCode);
      if (saved.statusCode === 200) {
        expect(published.statusCode).toBe(409);
        expect(published.json().error).toBe("private_findings_changed");
        expect(await prisma.reportVersion.count({ where: { visitId: v.id } })).toBe(0);
      } else {
        expect(published.statusCode).toBe(201);
        expect(await prisma.reportVersion.count({ where: { visitId: v.id } })).toBe(1);
      }
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
