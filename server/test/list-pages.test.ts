import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../src/http/errors.js";
import { visitRoutes } from "../src/http/routes/visits.js";
import { customerRoutes } from "../src/http/routes/customers.js";
import { reminderRoutes } from "../src/http/routes/reminders.js";
import { workshopRoutes } from "../src/http/routes/workshops.js";
import { normalizePlate } from "../src/domain/license-plate.js";

const workshopId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
async function appFor(tx: unknown, extra = {}) {
  const app = Fastify(); registerErrorHandler(app);
  app.addHook("preHandler", async request => { request.actor = { workshopId, userId: id, role: "EMPLOYEE" }; });
  const prisma = { ...extra, $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as unknown as PrismaClient;
  await app.register(visitRoutes(prisma)); await app.register(customerRoutes(prisma));
  await app.register(reminderRoutes(prisma)); await app.register(workshopRoutes(prisma)); return app;
}
describe("list pages and summaries", () => {
  it.each(["visits", "customers", "reminders"])("returns total, stable cursor and a final partial page for %s", async path => {
    const findMany = vi.fn().mockResolvedValue([{ id, createdAt: new Date("2026-01-01") }, { id: workshopId, createdAt: new Date("2026-01-01") }]);
    const count = vi.fn().mockResolvedValue(437);
    const app = await appFor({ visit: { findMany, count }, customer: { findMany, count }, reminder: { findMany, count } });
    try {
      const r = await app.inject({ method: "GET", url: `/v1/${path}?pagination=cursor&limit=1` });
      expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ total: 437, pageSize: 1, hasNext: true });
      expect(r.json().items).toHaveLength(1); expect(r.json().nextCursor).toBeTruthy();
      const cursor = r.json().nextCursor;
      findMany.mockResolvedValue([{ id: workshopId, createdAt: new Date("2026-01-01") }]);
      const last = await app.inject({ method: "GET", url: `/v1/${path}?pagination=cursor&limit=1&cursor=${cursor}` });
      expect(last.json()).toMatchObject({ total: 437, hasNext: false, nextCursor: null });
      expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { AND: [expect.objectContaining({ workshopId }),
        { OR: [{ createdAt: { lt: new Date("2026-01-01") } }, { createdAt: new Date("2026-01-01"), id: { lt: id } }] }] } }));
    } finally { await app.close(); }
  });

  it.each(["page=0", "page=1&pagination=cursor", "cursor=broken", "pagination=cursor&cursor=broken", "limit=201"])("rejects invalid pagination %s", async query => {
    const app = await appFor({});
    try { expect((await app.inject({ method: "GET", url: `/v1/visits?${query}` })).statusCode).toBe(400); }
    finally { await app.close(); }
  });

  it("retains the array response for old APK versions", async () => {
    const app = await appFor({}, { visit: { findMany: async () => [{ id }] } });
    try { expect((await app.inject({ method: "GET", url: "/v1/visits?limit=200" })).json()).toEqual([{ id }]); }
    finally { await app.close(); }
  });

  it("scopes aggregates to the entire workshop and includes completed approvals", async () => {
    const groupedVisits = vi.fn().mockResolvedValue([{ status: "DRAFT", _count: { _all: 410 } }, { status: "COMPLETED", _count: { _all: 27 } }]);
    const groupedFindings = vi.fn().mockResolvedValue([{ status: "COMPLETED", _count: { _all: 15 } }, { status: "DEFERRED", _count: { _all: 2 } }]);
    const reminders = vi.fn().mockResolvedValue([]);
    const app = await appFor({ visit: { groupBy: groupedVisits, count: async () => 0 },
      finding: { groupBy: groupedFindings, aggregate: async () => ({ _sum: { priceRub: 15000 } }) },
      reminder: { findMany: reminders, groupBy: async () => [{ state: "CANCELLED", _count: { _all: 3 } }], count: async () => 0 } });
    try {
      const r = await app.inject({ method: "GET", url: "/v1/workshop/summary" });
      expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ totalVisits: 437, activeVisits: 410, sent: 17, decisions: 17, approved: 15, approvedValue: 15000, upcomingReminders: [], reminderCounts: { CANCELLED: 3 } });
      expect(groupedVisits).toHaveBeenCalledWith(expect.objectContaining({ where: { workshopId } }));
      expect(reminders).toHaveBeenCalledWith(expect.objectContaining({ where: { workshopId, state: "PENDING" } }));
    } finally { await app.close(); }
  });

  it("normalizes case, separators and look-alike Latin plate letters", () => {
    expect(normalizePlate(" a 123-bc 77 ")).toBe("А123ВС77");
    expect(normalizePlate("А123ВС77")).toBe("А123ВС77");
  });
});
