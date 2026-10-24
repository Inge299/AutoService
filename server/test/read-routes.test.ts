import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";

const config: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 8080,
  LOG_LEVEL: "silent",
  SMS_PROVIDER: "disabled",
  DATABASE_URL: "postgresql://unused",
  S3_REGION: "ru-central1",
  S3_BUCKET: "test-bucket",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  S3_FORCE_PATH_STYLE: true,
  WORKER_POLL_INTERVAL_MS: 100,
};

const workshopId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const headers = { "x-workshop-id": workshopId, "x-user-id": userId };

function mockedPrisma(overrides: Record<string, unknown>): PrismaClient {
  return {
    membership: { findUnique: vi.fn().mockResolvedValue({ role: "ADMIN", isActive: true, user: { isActive: true } }) },
    workshop: { findUnique: vi.fn().mockResolvedValue({ id: workshopId, name: "АвтоСфера", phone: "+79990000000" }) },
    customer: { findMany: vi.fn().mockResolvedValue([]) },
    visit: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    ...overrides,
  } as unknown as PrismaClient;
}

describe("read routes", () => {
  it.each([
    ["8 (999) 123-45-67", "79991234567"],
    ["+7 999 123 45 67", "79991234567"],
    ["999 123", "999123"],
  ])("normalizes formatted phone search %s within the workshop", async (query, normalized) => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = await buildApp(config, { prisma: mockedPrisma({ customer: { findMany } }), storage: {} as ObjectStorage });
    try {
      const response = await app.inject({ method: "GET", url: `/v1/customers?q=${encodeURIComponent(query)}`, headers });
      expect(response.statusCode).toBe(200);
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workshopId,
        OR: expect.arrayContaining([{ phone: { contains: normalized } }]),
      }) }));
    } finally { await app.close(); }
  });

  it("searches plate with region and returns all vehicles for explicit selection", async () => {
    const vehicles = [{ id: "car-1", label: "Lada", licensePlate: "А123ВС777" }, { id: "car-2", label: "Toyota", licensePlate: "М777ММ77" }];
    const findMany = vi.fn().mockResolvedValue([{ id: "customer", name: "Иван", phone: "+79991234567", vehicles }]);
    const app = await buildApp(config, { prisma: mockedPrisma({ customer: { findMany } }), storage: {} as ObjectStorage });
    try {
      const response = await app.inject({ method: "GET", url: `/v1/customers?q=${encodeURIComponent("а123вс 777")}`, headers });
      expect(response.statusCode).toBe(200);
      expect(response.json()[0].vehicles).toEqual(vehicles);
      const where = findMany.mock.calls[0]![0].where;
      expect(where.workshopId).toBe(workshopId);
      expect(JSON.stringify(where)).toContain("А123ВС777");
    } finally { await app.close(); }
  });
  it("returns the authenticated workshop profile", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: workshopId, name: "АвтоСфера", phone: "+79990000000" });
    const app = await buildApp(config, {
      prisma: mockedPrisma({ workshop: { findUnique } }),
      storage: {} as ObjectStorage,
    });

    const response = await app.inject({ method: "GET", url: "/v1/workshop", headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: workshopId, name: "АвтоСфера", phone: "+79990000000" });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: workshopId },
      select: { id: true, name: true, phone: true },
    });
    await app.close();
  });

  it("lists only the authenticated workshop visits with validated filters", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        workshopId,
        customerName: "Иван Петров",
        customerPhone: "+79990000000",
        vehicleLabel: "Toyota Camry",
        licensePlate: "А123АА56",
        mileageKm: 100_000,
        complaint: "Стук",
        status: "IN_REPAIR",
        serverVersion: 2,
        createdAt: new Date("2026-09-13T08:00:00Z"),
        updatedAt: new Date("2026-09-13T09:00:00Z"),
        findings: [],
        _count: { media: 0 },
      },
    ]);
    const app = await buildApp(config, {
      prisma: mockedPrisma({ visit: { findMany, findFirst: vi.fn() } }),
      storage: {} as ObjectStorage,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/visits?q=Camry&status=IN_REPAIR&limit=25",
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workshopId, status: "IN_REPAIR" }),
      take: 25,
    }));
    await app.close();
  });

  it("does not return a visit from another workshop", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const app = await buildApp(config, {
      prisma: mockedPrisma({ visit: { findMany: vi.fn(), findFirst } }),
      storage: {} as ObjectStorage,
    });

    const id = "33333333-3333-4333-8333-333333333333";
    const response = await app.inject({ method: "GET", url: `/v1/visits/${id}`, headers });

    expect(response.statusCode).toBe(404);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, workshopId } }));
    await app.close();
  });

  it("scopes customer search to the authenticated workshop", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = await buildApp(config, {
      prisma: mockedPrisma({ customer: { findMany } }),
      storage: {} as ObjectStorage,
    });

    const response = await app.inject({ method: "GET", url: "/v1/customers?q=Camry", headers });

    expect(response.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workshopId }),
      take: 100,
    }));
    await app.close();
  });
});
