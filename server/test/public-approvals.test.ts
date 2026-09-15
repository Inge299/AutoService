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

const token = "evaluation_token_abcdefghijklmnopqrstuvwxyz012345";
const approvalVersionId = "11111111-1111-4111-8111-111111111101";
const findingId = "11111111-1111-4111-8111-111111111102";
const visitId = "11111111-1111-4111-8111-111111111103";
const workshopId = "11111111-1111-4111-8111-111111111104";

function approvalLink(decision: { value: string; createdAt: Date } | null = null) {
  return {
    id: "11111111-1111-4111-8111-111111111105",
    approvalVersionId,
    tokenHash: "unused",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    openedAt: null,
    createdAt: new Date(),
    approvalVersion: {
      id: approvalVersionId,
      workshopId,
      visitId,
      findingId,
      version: 1,
      title: "Тормозные колодки",
      description: "Требуется замена",
      priceRub: 12_800,
      mediaIds: [],
      createdAt: new Date(),
      workshop: { name: "АвтоСфера", phone: "+70000000000" },
      visit: {
        id: visitId,
        customerName: "Иван Петров",
        vehicleLabel: "Toyota Camry",
        licensePlate: "А123АА56",
        status: "WAITING_APPROVAL",
      },
      finding: { priority: "CRITICAL" },
      decision,
    },
  };
}

describe("public approval routes", () => {
  it("returns the immutable approval snapshot without authentication", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      approvalLink: { findUnique: vi.fn().mockResolvedValue(approvalLink()), update },
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({ method: "GET", url: `/public/v1/approvals/${token}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workshop: { name: "АвтоСфера" },
      visit: { vehicleLabel: "Toyota Camry" },
      finding: { title: "Тормозные колодки", priceRub: 12_800 },
      decision: null,
    });
    expect(update).toHaveBeenCalledOnce();
    await app.close();
  });

  it("records a decision and updates the finding and visit", async () => {
    const create = vi.fn().mockResolvedValue({ value: "APPROVED", createdAt: new Date() });
    const findingUpdate = vi.fn().mockResolvedValue({});
    const visitUpdate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      approvalLink: { findUnique: vi.fn().mockResolvedValue(approvalLink()) },
      $transaction: vi.fn(async (callback) => callback({
        approvalDecision: { create },
        finding: { update: findingUpdate },
        visit: { update: visitUpdate },
        auditEvent: { create: auditCreate },
      })),
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({
      method: "POST",
      url: `/public/v1/approvals/${token}/decision`,
      payload: { value: "APPROVED" },
    });

    expect(response.statusCode).toBe(201);
    expect(create).toHaveBeenCalledOnce();
    expect(findingUpdate).toHaveBeenCalledOnce();
    expect(visitUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "IN_REPAIR" }),
    }));
    expect(auditCreate).toHaveBeenCalledOnce();
    await app.close();
  });
});
