import { createHash, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { findingRoutes } from "../src/http/routes/findings.js";
import { publicApprovalRoutes } from "../src/http/routes/public-approvals.js";
import { registerErrorHandler } from "../src/http/errors.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";

// A dedicated disposable database is mandatory. Never defaults to DATABASE_URL.
describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgreSQL approval concurrency", () => {
  it("cannot both replace and decide the revoked version", async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
    const workshopId = randomUUID();
    await prisma.workshop.create({ data: { id: workshopId, name: "Synthetic concurrency test" } });
    const app = Fastify();
    registerErrorHandler(app);
    app.addHook("preHandler", async request => { request.actor = { workshopId, userId: randomUUID(), role: "EMPLOYEE" }; });
    await app.register(findingRoutes(prisma));
    await app.register(publicApprovalRoutes(prisma, {} as ObjectStorage));
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const visitId = randomUUID(), findingId = randomUUID();
        const token = `synthetic_${randomUUID().replaceAll("-", "")}_token`;
        await prisma.visit.create({ data: { id: visitId, workshopId, customerName: "Test", customerPhone: "+70000000000", vehicleLabel: "Test", licensePlate: "", complaint: "", status: "WAITING_APPROVAL", createdAt: new Date(), updatedAt: new Date() } });
        await prisma.finding.create({ data: { id: findingId, workshopId, visitId, title: "Test", description: "", priceRub: 100, priority: "IMPORTANT", status: "SENT_TO_CUSTOMER", createdAt: new Date(), updatedAt: new Date() } });
        await prisma.approvalVersion.create({ data: { operationId: randomUUID(), workshopId, visitId, findingId, version: 1, title: "Test", description: "", priceRub: 100, mediaIds: [], link: { create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60000) } } } });
        const [replacement, decision] = await Promise.all([
          app.inject({ method: "POST", url: `/v1/findings/${findingId}/approval-link`, payload: { operationId: randomUUID(), token: `replacement_${randomUUID().replaceAll("-", "")}`, mediaIds: [], descriptionOnly: true, replaceActive: true } }),
          app.inject({ method: "POST", url: `/public/v1/approvals/${token}/decision`, payload: { value: "APPROVED" } }),
        ]);
        expect([replacement.statusCode, decision.statusCode]).not.toContain(500);
        expect(replacement.statusCode === 201 && decision.statusCode === 201).toBe(false);
        expect([replacement.statusCode, decision.statusCode]).toContain(201);
        const finding = await prisma.finding.findUniqueOrThrow({ where: { id: findingId } });
        expect(finding.status).toBe(decision.statusCode === 201 ? "APPROVED" : "SENT_TO_CUSTOMER");
      }
    } finally {
      await app.close();
      await prisma.approvalDecision.deleteMany({ where: { approvalVersion: { workshopId } } });
      await prisma.approvalVersion.deleteMany({ where: { workshopId } });
      await prisma.workshop.delete({ where: { id: workshopId } });
      await prisma.$disconnect();
    }
  });
});
