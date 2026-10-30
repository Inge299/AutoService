import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../src/http/errors.js";
import { visitRoutes } from "../src/http/routes/visits.js";
import { customerRoutes } from "../src/http/routes/customers.js";
import { workshopRoutes } from "../src/http/routes/workshops.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgreSQL list coverage and stable identity", () => {
  let prisma: PrismaClient;
  const workshopId = randomUUID(), otherWorkshopId = randomUUID();
  const app = Fastify();
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
    await prisma.workshop.createMany({ data: [{ id: workshopId, name: "Synthetic pagination" }, { id: otherWorkshopId, name: "Synthetic isolation" }] });
    registerErrorHandler(app);
    app.addHook("preHandler", async request => { request.actor = { workshopId, userId: randomUUID(), role: "EMPLOYEE" }; });
    await app.register(visitRoutes(prisma)); await app.register(customerRoutes(prisma)); await app.register(workshopRoutes(prisma));
  });
  afterAll(async () => { await app.close(); await prisma.workshop.deleteMany({ where: { id: { in: [workshopId, otherWorkshopId] } } }); await prisma.$disconnect(); });

  const body = (overrides = {}) => ({ customerName: "Synthetic identity", customerPhone: "8 (999) 111-22-33",
    vehicleLabel: "Toyota", licensePlate: "a123bc77", mileageKm: 1000, complaint: "Synthetic identity", status: "DRAFT",
    createdAtEpochMs: Date.now(), updatedAtEpochMs: Date.now(), baseServerVersion: null, ...overrides });
  async function save(id = randomUUID(), overrides = {}) {
    return app.inject({ method: "PUT", url: `/v1/visits/${id}`, payload: body(overrides) });
  }

  it("includes the inherited report date in legacy, numbered and cursor lists and visit details", async () => {
    const id = randomUUID();
    expect((await save(id, { customerName: "Synthetic report inheritance" })).statusCode).toBe(200);
    const nextVisitAt = new Date("2035-12-20T09:00:00.000Z");
    await prisma.report.create({ data: { workshopId, visitId: id, nextVisitAt } });
    for (const suffix of ["", "&page=1", "&pagination=cursor"]) {
      const response = await app.inject({ method: "GET", url: `/v1/visits?q=Synthetic%20report%20inheritance${suffix}` });
      expect(response.statusCode).toBe(200);
      const data = response.json(); const rows = Array.isArray(data) ? data : data.items;
      expect(rows).toHaveLength(1);
      expect(rows[0].report).toEqual({ nextVisitAt: nextVisitAt.toISOString() });
    }
    const detail = await app.inject({ method: "GET", url: `/v1/visits/${id}` });
    expect(detail.json().report).toEqual({ nextVisitAt: nextVisitAt.toISOString() });
    await prisma.report.update({ where: { visitId: id }, data: { nextVisitAt: null } });
    expect((await app.inject({ method: "GET", url: `/v1/visits/${id}` })).json().report).toEqual({ nextVisitAt: null });
  });

  it("reads every one of 437 visits with tied timestamps and survives updates between cursor pages", async () => {
    const createdAt = new Date("2026-01-01");
    const ids = Array.from({ length: 437 }, () => randomUUID());
    await prisma.visit.createMany({ data: ids.map(id => ({ id, workshopId, customerName: "Synthetic pages", customerPhone: "+79990000000",
      vehicleLabel: "Synthetic pages", licensePlate: "Т111ТТ77", complaint: "Synthetic pages", status: "DRAFT", createdAt, updatedAt: createdAt })) });
    await prisma.visit.create({ data: { id: randomUUID(), workshopId: otherWorkshopId, customerName: "Other workshop", customerPhone: "+79990000000",
      vehicleLabel: "Synthetic pages", licensePlate: "Т111ТТ77", complaint: "Other workshop", status: "DRAFT", createdAt, updatedAt: createdAt } });
    const found: string[] = []; let cursor: string | null = null;
    do {
      const url: string = `/v1/visits?pagination=cursor&limit=200&q=Synthetic%20pages${cursor ? "&cursor=" + cursor : ""}`;
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode).toBe(200); expect(r.json().total).toBe(437);
      found.push(...r.json().items.map((v: { id: string }) => v.id)); cursor = r.json().nextCursor;
      if (found.length === 200) await prisma.visit.update({ where: { id: ids[0]! }, data: { updatedAt: new Date() } });
    } while (cursor);
    expect(found).toHaveLength(437); expect(new Set(found)).toEqual(new Set(ids));
    const second = await app.inject({ method: "GET", url: "/v1/visits?page=3&limit=200&q=Synthetic%20pages" });
    expect(second.json().items).toHaveLength(37); expect(second.json().hasNext).toBe(false);
  });

  it("uses one customer and one car for different phone/plate formats and a renamed model", async () => {
    const one = await save(); expect(one.statusCode).toBe(200);
    const two = await save(randomUUID(), { customerPhone: "+7 999 111 22 33", licensePlate: "А123ВС77", vehicleLabel: "Toyota Camry" });
    expect(two.statusCode).toBe(200);
    expect(two.json().customerId).toBe(one.json().customerId); expect(two.json().vehicleId).toBe(one.json().vehicleId);
    expect(await prisma.customer.count({ where: { workshopId, phone: "+79991112233" } })).toBe(1);
    expect(await prisma.vehicle.count({ where: { workshopId, customerId: one.json().customerId } })).toBe(1);
    const edited = await save(two.json().id, { customerPhone: "+79991112233", vehicleLabel: "Toyota renamed again", baseServerVersion: two.json().serverVersion });
    expect(edited.statusCode).toBe(200); expect(edited.json().vehicleId).toBe(one.json().vehicleId);
  });

  it("reuses one legacy formatted phone instead of adding a canonical duplicate", async () => {
    const id = randomUUID(); await prisma.customer.create({ data: { id, workshopId, name: "Synthetic legacy", phone: "8 (999) 444-55-66" } });
    const r = await save(randomUUID(), { customerPhone: "+79994445566", licensePlate: "В444ВВ77" });
    expect(r.statusCode).toBe(200); expect(r.json().customerId).toBe(id);
    expect(await prisma.customer.count({ where: { workshopId, phone: "+79994445566" } })).toBe(0);
    const search = await app.inject({ method: "GET", url: "/v1/customers?page=1&q=%2B79994445566" });
    expect(search.statusCode).toBe(200); expect(search.json().items.map((c: { id: string }) => c.id)).toContain(id);
  });

  it("returns a conflict for ambiguous old clients and accepts an explicit selection", async () => {
    const first = randomUUID(), second = randomUUID();
    await prisma.customer.createMany({ data: [{ id: first, workshopId, name: "Synthetic duplicate 1", phone: "+79997778899" },
      { id: second, workshopId, name: "Synthetic duplicate 2", phone: "8 (999) 777-88-99" }] });
    const r = await save(randomUUID(), { customerPhone: "+79997778899", licensePlate: "С777СС77" });
    expect(r.statusCode).toBe(409); expect(r.json().error).toBe("customer_identity_ambiguous");
    const selected = await save(randomUUID(), { customerPhone: "+79997778899", customerId: second, licensePlate: "С777СС77" });
    expect(selected.statusCode).toBe(200); expect(selected.json().customerId).toBe(second);
    expect(await prisma.customer.count({ where: { id: { in: [first, second] } } })).toBe(2);
  });

  it("rejects an explicit foreign-workshop car without committing customer edits", async () => {
    const foreign = await prisma.vehicle.create({ data: { id: randomUUID(), workshopId: otherWorkshopId, label: "Foreign", licensePlate: "М555ММ77" } });
    const before = await prisma.customer.count({ where: { workshopId } });
    const r = await save(randomUUID(), { customerPhone: "+79995556677", vehicleId: foreign.id });
    expect(r.statusCode).toBe(409); expect(await prisma.customer.count({ where: { workshopId } })).toBe(before);
  });

  it("counts an old completed finding outside the first page in the workshop summary", async () => {
    const oldest = await prisma.visit.findFirstOrThrow({ where: { workshopId }, orderBy: { createdAt: "asc" } });
    await prisma.finding.create({ data: { id: randomUUID(), workshopId, visitId: oldest.id, title: "Synthetic completed work", description: "", priceRub: 12345,
      priority: "IMPORTANT", status: "COMPLETED", createdAt: new Date("2020-01-01"), updatedAt: new Date("2020-01-01") } });
    const r = await app.inject({ method: "GET", url: "/v1/workshop/summary" });
    expect(r.statusCode).toBe(200); expect(r.json().totalVisits).toBe(await prisma.visit.count({ where: { workshopId } }));
    expect(r.json()).toMatchObject({ approved: 1, approvedValue: 12345, sent: 1, decisions: 1 });
  });
});
