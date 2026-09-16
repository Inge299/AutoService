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
const reminderId = "33333333-3333-4333-8333-333333333333";
const headers = { "x-workshop-id": workshopId, "x-user-id": userId };

describe("reminders", () => {
  it("cancels a pending reminder and its queued job before delivery", async () => {
    const reminderUpdate = vi.fn().mockResolvedValue({});
    const jobUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: "EMPLOYEE", isActive: true, user: { isActive: true } }) },
      $transaction: vi.fn(async (callback) => callback({
        reminder: { findFirst: vi.fn().mockResolvedValue({ id: reminderId, state: "PENDING" }), update: reminderUpdate },
        backgroundJob: { updateMany: jobUpdate },
        auditEvent: { create: auditCreate },
      })),
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({ method: "POST", url: `/v1/reminders/${reminderId}/cancel`, headers });

    expect(response.statusCode).toBe(204);
    expect(reminderUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "CANCELLED" }) }));
    expect(jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "DEAD" }) }));
    expect(auditCreate).toHaveBeenCalledOnce();
    await app.close();
  });
});
