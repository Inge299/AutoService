import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";

const config: Config = {
  NODE_ENV: "test", HOST: "127.0.0.1", PORT: 8080, LOG_LEVEL: "silent", SMS_PROVIDER: "disabled",
  DATABASE_URL: "postgresql://unused", S3_REGION: "ru-central1", S3_BUCKET: "test-bucket",
  S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test", S3_FORCE_PATH_STYLE: true, WORKER_POLL_INTERVAL_MS: 100,
};
const workshopId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const visitId = "33333333-3333-4333-8333-333333333333";
const reminderId = "44444444-4444-4444-8444-444444444444";
const headers = { "x-workshop-id": workshopId, "x-user-id": userId };

describe("return visit reminders", () => {
  it("links a new visit to the oldest matching reminder and cancels it before send", async () => {
    const reminderUpdate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const transaction = {
      visit: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: visitId, serverVersion: 1 }) },
      customer: { upsert: vi.fn().mockResolvedValue({ id: "55555555-5555-4555-8555-555555555555" }) },
      vehicle: { findFirst: vi.fn().mockResolvedValue({ id: "66666666-6666-4666-8666-666666666666" }), update: vi.fn().mockResolvedValue({}) },
      reminder: { findFirst: vi.fn().mockResolvedValue({ id: reminderId, state: "PENDING" }), update: reminderUpdate },
      auditEvent: { create: auditCreate },
    };
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: "EMPLOYEE", isActive: true, user: { isActive: true } }) },
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({
      method: "PUT", url: `/v1/visits/${visitId}`, headers,
      payload: {
        customerName: "Иван", customerPhone: "+79991234567", vehicleLabel: "Toyota", licensePlate: "А123АА",
        mileageKm: 80_000, complaint: "Плановый осмотр", status: "DRAFT",
        createdAtEpochMs: 1_780_000_000_000, updatedAtEpochMs: 1_780_000_000_000, baseServerVersion: null,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(reminderUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ returnVisitId: visitId, state: "CANCELLED" }) }));
    expect(auditCreate).toHaveBeenCalledOnce();
    await app.close();
  });
});
