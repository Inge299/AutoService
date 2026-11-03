import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../src/http/errors.js";
import { visitRoutes } from "../src/http/routes/visits.js";
import { findingRoutes } from "../src/http/routes/findings.js";
import { reportRoutes } from "../src/http/routes/reports.js";
import { isPastVisitDate } from "../src/domain/visit-date.js";

const workshopId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const visitBody = { customerName: "Test", customerPhone: "+79991234567", vehicleLabel: "Toyota",
  licensePlate: "А123АА77", mileageKm: 100, complaint: "Test", status: "IN_REPAIR",
  createdAtEpochMs: 1, updatedAtEpochMs: 1, baseServerVersion: 1 };
const findingBody = { visitId: id, title: "Test", description: "", priceRub: 100, priority: "IMPORTANT",
  status: "DRAFT", createdAtEpochMs: 1, updatedAtEpochMs: 1, baseServerVersion: 1 };

async function appFor(tx: unknown) {
  const app = Fastify();
  registerErrorHandler(app);
  app.addHook("preHandler", async request => { request.actor = { workshopId, userId: id, role: "EMPLOYEE" }; });
  const prisma = { $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as unknown as PrismaClient;
  await app.register(visitRoutes(prisma));
  await app.register(findingRoutes(prisma));
  await app.register(reportRoutes(prisma));
  return app;
}

describe("visit integrity", () => {
  it.each(["COMPLETED", "CANCELLED"])("protects a %s visit before touching its client or vehicle", async status => {
    const upsert = vi.fn();
    const app = await appFor({ visit: { findUnique: async () => ({ workshopId, status }) }, customer: { upsert } });
    try {
      const r = await app.inject({ method: "PUT", url: `/v1/visits/${id}`, payload: visitBody });
      expect(r.statusCode).toBe(409); expect(r.json()).toEqual({ error: "visit_closed" });
      expect(upsert).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("cannot manufacture a completed visit without report publication", async () => {
    const app = await appFor({ visit: { findUnique: async () => null } });
    try {
      const r = await app.inject({ method: "PUT", url: `/v1/visits/${id}`, payload: { ...visitBody, status: "COMPLETED" } });
      expect(r.statusCode).toBe(409); expect(r.json().error).toBe("visit_status_managed_by_report");
    } finally { await app.close(); }
  });

  it.each(["COMPLETED", "CANCELLED"])("cannot add or edit a finding in a %s visit", async status => {
    const findUnique = vi.fn();
    const app = await appFor({ visit: { findFirst: async () => ({ id, status }) }, finding: { findUnique } });
    try {
      const r = await app.inject({ method: "PUT", url: `/v1/findings/${other}`, payload: findingBody });
      expect(r.statusCode).toBe(409); expect(r.json().error).toBe("visit_closed");
      expect(findUnique).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("cannot bypass closed-visit protection by moving an existing finding to another visit", async () => {
    const update = vi.fn();
    const app = await appFor({ visit: { findFirst: async () => ({ id, status: "IN_REPAIR" }) },
      finding: { findUnique: async () => ({ workshopId, visitId: other, status: "DRAFT" }), update } });
    try {
      const r = await app.inject({ method: "PUT", url: `/v1/findings/${other}`, payload: findingBody });
      expect(r.statusCode).toBe(409); expect(r.json().error).toBe("finding_visit_mismatch");
      expect(update).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([{ customerPhone: "not-a-phone-value" }, { customerPhone: "++79991234567" },
    { vehicleLabel: "  ", licensePlate: " " }])("rejects invalid visit data %j before database writes", async overrides => {
    const app = await appFor({});
    try { expect((await app.inject({ method: "PUT", url: `/v1/visits/${id}`, payload: { ...visitBody, ...overrides } })).statusCode).toBe(400); }
    finally { await app.close(); }
  });

  it("normalizes the phone before resolving the customer", async () => {
    const create = vi.fn().mockResolvedValue({ id });
    const app = await appFor({ visit: { findUnique: async () => ({ workshopId, status: "DRAFT", serverVersion: 1 }), update: async () => ({ id }) },
      $queryRaw: async () => [], customer: { create }, vehicle: { create: async () => ({ id }) } });
    try {
      const r = await app.inject({ method: "PUT", url: `/v1/visits/${id}`, payload: { ...visitBody, customerPhone: "8 (999) 123-45-67" } });
      expect(r.statusCode).toBe(200);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ workshopId, phone: "+79991234567" }) }));
    } finally { await app.close(); }
  });

  it("rejects a past next-visit date when saving a draft", async () => {
    const create = vi.fn();
    const app = await appFor({ visit: { findFirst: async () => ({ id, status: "IN_REPAIR" }) }, report: { findUnique: async () => null, create } });
    try {
      const r = await app.inject({ method: "PUT", url: `/v1/visits/${id}/report`, payload: { completedWork: "Test", recommendations: "", nextVisitAt: "2020-01-01T09:00:00.000Z" } });
      expect(r.statusCode).toBe(400); expect(r.json().error).toBe("next_visit_date_in_past");
      expect(create).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("rechecks a draft's date at publication after midnight has passed", async () => {
    const create = vi.fn();
    const app = await appFor({ reportVersion: { findUnique: async () => null, create }, report: { findFirst: async () => ({ nextVisitAt: new Date("2020-01-01"), visit: { status: "IN_REPAIR" } }) } });
    try {
      const r = await app.inject({ method: "POST", url: `/v1/visits/${id}/report/publish`, payload: { operationId: other, token: "x".repeat(43) } });
      expect(r.statusCode).toBe(400); expect(r.json().error).toBe("next_visit_date_in_past");
      expect(create).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("allows today's Moscow midnight, but not the previous calendar day", () => {
    const now = new Date("2026-10-27T22:00:00Z"); // 28 October in Moscow
    expect(isPastVisitDate(new Date("2026-10-27T21:00:00Z"), now)).toBe(false);
    expect(isPastVisitDate(new Date("2026-10-27T20:59:59Z"), now)).toBe(true);
    expect(isPastVisitDate(null, now)).toBe(false);
  });
});
