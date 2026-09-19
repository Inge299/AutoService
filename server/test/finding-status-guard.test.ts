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
const visitId = "33333333-3333-4333-8333-333333333333";
const findingId = "44444444-4444-4444-8444-444444444444";
const headers = { "x-workshop-id": workshopId, "x-user-id": userId };

const basePayload = {
  visitId,
  title: "Тормозные колодки",
  description: "Нужна замена",
  priceRub: 4_000,
  priority: "IMPORTANT",
  createdAtEpochMs: 1_789_113_600_000,
  updatedAtEpochMs: 1_789_113_600_000,
  baseServerVersion: 1,
};

describe("finding status guard", () => {
  it("does not let a staff client record a customer decision through finding sync", async () => {
    const transaction = vi.fn();
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: "EMPLOYEE", isActive: true, user: { isActive: true } }) },
      $transaction: transaction,
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({
      method: "PUT",
      url: `/v1/findings/${findingId}`,
      headers,
      payload: { ...basePayload, status: "APPROVED" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "finding_status_managed_by_approval" });
    expect(transaction).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not let a staff client edit a finding after it is prepared", async () => {
    const update = vi.fn();
    const transaction = vi.fn(async (callback) => callback({
      visit: { findFirst: vi.fn().mockResolvedValue({ id: visitId }) },
      finding: { findUnique: vi.fn().mockResolvedValue({ workshopId, status: "READY_FOR_APPROVAL", serverVersion: 1 }), update },
    }));
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: "EMPLOYEE", isActive: true, user: { isActive: true } }) },
      $transaction: transaction,
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({
      method: "PUT",
      url: `/v1/findings/${findingId}`,
      headers,
      payload: { ...basePayload, status: "READY_FOR_APPROVAL" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "finding_status_managed_by_approval" });
    expect(update).not.toHaveBeenCalled();
    await app.close();
  });

  it("marks only an approved finding as completed through the dedicated action", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const completed = { id: findingId, workshopId, visitId, status: "COMPLETED", serverVersion: 3 };
    const transaction = vi.fn(async (callback) => callback({
      finding: {
        findFirst: vi.fn().mockResolvedValue({ id: findingId, visitId }),
        updateMany,
        findUnique: vi.fn().mockResolvedValue(completed),
      },
      visit: { findFirst: vi.fn().mockResolvedValue({ status: "IN_REPAIR" }) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    }));
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: "EMPLOYEE", isActive: true, user: { isActive: true } }) },
      $transaction: transaction,
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({ method: "POST", url: `/v1/findings/${findingId}/complete`, headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: findingId, status: "COMPLETED" });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: findingId, workshopId, status: "APPROVED" },
      data: expect.objectContaining({ status: "COMPLETED" }),
    }));
    await app.close();
  });
});
