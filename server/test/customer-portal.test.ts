import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";
import { createAccessToken } from "../src/security/access-token.js";

const config: Config = {
  NODE_ENV: "test", HOST: "127.0.0.1", PORT: 8080, LOG_LEVEL: "silent", SMS_PROVIDER: "disabled",
  ACCESS_TOKEN_SECRET: "a".repeat(32), OTP_HASH_SECRET: "o".repeat(32), DATABASE_URL: "postgresql://unused",
  S3_REGION: "ru-central1", S3_BUCKET: "test-bucket", S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test",
  S3_FORCE_PATH_STYLE: true, WORKER_POLL_INTERVAL_MS: 100,
};
const workshopId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";

describe("customer portal", () => {
  it("returns a published immutable report only with the customer visit history", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: "55555555-5555-4555-8555-555555555555", customerName: "Иван", customerPhone: "+79991234567",
      vehicleLabel: "Lada Vesta", licensePlate: "А123АА77", mileageKm: 10_000, complaint: "ТО",
      status: "COMPLETED", createdAt: new Date(), updatedAt: new Date(), findings: [], _count: { media: 2 },
      report: { status: "PUBLISHED", completedWork: "Заменили масло", recommendations: "Проверить уровень", nextVisitAt: new Date("2026-10-01T09:00:00Z"), publishedAt: new Date() },
    }]);
    const prisma = {
      authSession: { findUnique: vi.fn().mockResolvedValue({ userId, workshopId, customerId, scope: "CUSTOMER", expiresAt: new Date(Date.now() + 60_000), revokedAt: null }) },
      customer: {
        findFirst: vi.fn().mockResolvedValue({ id: customerId }),
        findUnique: vi.fn().mockResolvedValue({ id: customerId, name: "Иван", phone: "+79991234567", email: null, workshop: { name: "АвтоСфера", phone: null }, vehicles: [] }),
      },
      visit: { findMany },
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });
    const { token } = createAccessToken({ sessionId, userId, workshopId, customerId, scope: "CUSTOMER" }, config.ACCESS_TOKEN_SECRET!);

    const response = await app.inject({ method: "GET", url: "/public/v1/customer-accounts/me", headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ visits: [{ report: { status: "PUBLISHED", completedWork: "Заменили масло" } }] });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workshopId }),
      include: expect.objectContaining({ report: expect.any(Object) }),
    }));
    await app.close();
  });

  it("does not expose an unpublished report draft to the customer", async () => {
    const prisma = {
      authSession: { findUnique: vi.fn().mockResolvedValue({ userId, workshopId, customerId, scope: "CUSTOMER", expiresAt: new Date(Date.now() + 60_000), revokedAt: null }) },
      customer: {
        findFirst: vi.fn().mockResolvedValue({ id: customerId }),
        findUnique: vi.fn().mockResolvedValue({ id: customerId, name: "Иван", phone: "+79991234567", email: null, workshop: { name: "АвтоСфера", phone: null }, vehicles: [] }),
      },
      visit: { findMany: vi.fn().mockResolvedValue([{
        id: "55555555-5555-4555-8555-555555555555", customerName: "Иван", customerPhone: "+79991234567",
        vehicleLabel: "Lada Vesta", licensePlate: "А123АА77", mileageKm: 10_000, complaint: "ТО",
        status: "IN_REPAIR", createdAt: new Date(), updatedAt: new Date(), findings: [], _count: { media: 0 },
        report: { status: "DRAFT", completedWork: "Внутренний черновик", recommendations: "", nextVisitAt: null, publishedAt: null },
      }]) },
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });
    const { token } = createAccessToken({ sessionId, userId, workshopId, customerId, scope: "CUSTOMER" }, config.ACCESS_TOKEN_SECRET!);

    const response = await app.inject({ method: "GET", url: "/public/v1/customer-accounts/me", headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ visits: [{ report: null }] });
    expect(response.body).not.toContain("Внутренний черновик");
    await app.close();
  });
});
