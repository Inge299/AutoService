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
    membership: { findUnique: vi.fn().mockResolvedValue({ userId }) },
    customer: { findMany: vi.fn().mockResolvedValue([]) },
    visit: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    ...overrides,
  } as unknown as PrismaClient;
}

describe("read routes", () => {
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
