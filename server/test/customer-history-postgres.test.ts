import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { customerRoutes } from "../src/http/routes/customers.js";
import { registerErrorHandler } from "../src/http/errors.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("customer history isolation and pagination", () => {
  const workshopId = randomUUID(), otherId = randomUUID(), customerId = randomUUID(), foreignCustomerId = randomUUID();
  const carId = randomUUID(), secondCarId = randomUUID(), foreignCarId = randomUUID();
  const app = Fastify(); let prisma: PrismaClient;
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
    await prisma.workshop.createMany({ data: [{ id: workshopId, name: "QA history" }, { id: otherId, name: "QA isolation" }] });
    await prisma.customer.createMany({ data: [{ id: customerId, workshopId, name: "QA client", phone: "+79991112233" },
      { id: foreignCustomerId, workshopId: otherId, name: "Foreign client", phone: "+79991112233" }] });
    await prisma.vehicle.createMany({ data: [{ id: carId, workshopId, customerId, label: "Lada", licensePlate: "А123АА77" },
      { id: secondCarId, workshopId, customerId, label: "Toyota", licensePlate: "В456ВВ77" },
      { id: foreignCarId, workshopId: otherId, customerId: foreignCustomerId, label: "Foreign", licensePlate: "М777ММ77" }] });
    const now = new Date();
    const visits = Array.from({ length: 23 }, (_, i) => ({ id: randomUUID(), workshopId, customerId, vehicleId: i === 22 ? secondCarId : carId,
      customerName: "QA client", customerPhone: "+79991112233", vehicleLabel: i === 22 ? "Toyota" : "Lada", licensePlate: "А123АА77", complaint: "Synthetic history", status: "IN_REPAIR" as const, createdAt: now, updatedAt: now }));
    await prisma.visit.createMany({ data: visits });
    await prisma.finding.createMany({ data: visits.map(v => ({ id: randomUUID(), workshopId, visitId: v.id, title: "Deferred work", description: "Do later", priceRub: 100,
      priority: "PLANNED" as const, status: "DEFERRED" as const, createdAt: now, updatedAt: now })) });
    registerErrorHandler(app);
    app.addHook("preHandler", async r => { r.actor = { workshopId, userId: randomUUID(), role: "EMPLOYEE" }; });
    await app.register(customerRoutes(prisma));
  });
  afterAll(async () => { await app.close(); await prisma.workshop.deleteMany({ where: { id: { in: [workshopId, otherId] } } }); await prisma.$disconnect(); });
  const get = (query = "", id: string = customerId) => app.inject({ method: "GET", url: `/v1/customers/${id}/history${query}` });
  it("shows every vehicle and pages history with tied dates without loss", async () => {
    const one = await get(), two = await get("?page=2"); expect(one.statusCode).toBe(200);
    expect(one.json().vehicles).toHaveLength(2); expect(one.json().visits.total).toBe(23);
    expect(one.json().visits.items).toHaveLength(20); expect(two.json().visits.items).toHaveLength(3);
    expect(new Set([...one.json().visits.items, ...two.json().visits.items].map(v => v.id)).size).toBe(23);
  });
  it("restricts both history and deferred work to the selected car", async () => {
    const r = await get(`?vehicleId=${secondCarId}`); expect(r.statusCode).toBe(200);
    expect(r.json().visits.total).toBe(1); expect(r.json().futureWork.total).toBe(1);
    expect(r.json().visits.items[0].vehicleId).toBe(secondCarId);
  });
  it("pages deferred work independently", async () => {
    const r = await get("?futurePage=2"); expect(r.statusCode).toBe(200);
    expect(r.json().futureWork.items).toHaveLength(3); expect(r.json().futureWork.total).toBe(23); expect(r.json().visits.page).toBe(1);
  });
  it("does not expose another workshop's client even with an identical phone", async () => {
    expect((await get("", foreignCustomerId)).statusCode).toBe(404);
  });
  it("rejects a car belonging to another client/workshop and malformed parameters", async () => {
    expect((await get(`?vehicleId=${foreignCarId}`)).statusCode).toBe(404);
    expect((await get("?page=0")).statusCode).toBe(400); expect((await get("?futurePage=abc")).statusCode).toBe(400);
    expect((await get("", "invalid-id")).statusCode).toBe(400);
  });
});
