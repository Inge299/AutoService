import { createHash } from "node:crypto";
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
const findingId = "33333333-3333-4333-8333-333333333333";
const visitId = "44444444-4444-4444-8444-444444444444";
const mediaId = "55555555-5555-4555-8555-555555555555";
const operationId = "66666666-6666-4666-8666-666666666666";
const token = "approval_token_abcdefghijklmnopqrstuvwxyz0123456789";
const headers = { "x-workshop-id": workshopId, "x-user-id": userId };

describe("approval link creation", () => {
  it("snapshots verified finding media and returns the caller-held token", async () => {
    const approvalCreate = vi.fn().mockResolvedValue({ id: "77777777-7777-4777-8777-777777777777" });
    const linkCreate = vi.fn().mockResolvedValue({
      id: "88888888-8888-4888-8888-888888888888",
      expiresAt: new Date("2026-10-01T12:00:00.000Z"),
    });
    const transaction = {
      approvalVersion: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: approvalCreate,
      },
      finding: {
        findFirst: vi.fn().mockResolvedValue({
          id: findingId,
          visitId,
          title: "Тормозные колодки",
          description: "Требуется замена",
          priceRub: 12_800,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      mediaAsset: { findMany: vi.fn().mockResolvedValue([{ id: mediaId }]) },
      approvalLink: { create: linkCreate },
      visit: { update: vi.fn().mockResolvedValue({}) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: "EMPLOYEE", isActive: true, user: { isActive: true } }) },
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({
      method: "POST",
      url: `/v1/findings/${findingId}/approval-link`,
      headers,
      payload: { operationId, token, mediaIds: [mediaId], expiresInDays: 7 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      approvalVersionId: "77777777-7777-4777-8777-777777777777",
      token,
      publicPath: `/a/${token}`,
      reused: false,
    });
    expect(approvalCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ operationId, findingId, visitId, mediaIds: [mediaId], priceRub: 12_800 }),
    }));
    expect(linkCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        approvalVersionId: "77777777-7777-4777-8777-777777777777",
        tokenHash: createHash("sha256").update(token).digest("hex"),
      }),
    }));
    expect(transaction.finding.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SENT_TO_CUSTOMER" }),
    }));
    await app.close();
  });

  it("returns an existing link only when the retry proves the same token", async () => {
    const expiresAt = new Date("2026-10-01T12:00:00.000Z");
    const transaction = {
      approvalVersion: {
        findUnique: vi.fn().mockResolvedValue({
          id: "77777777-7777-4777-8777-777777777777",
          workshopId,
          findingId,
          link: {
            tokenHash: createHash("sha256").update(token).digest("hex"),
            expiresAt,
          },
        }),
      },
    };
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: "EMPLOYEE", isActive: true, user: { isActive: true } }) },
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({
      method: "POST",
      url: `/v1/findings/${findingId}/approval-link`,
      headers,
      payload: { operationId, token, mediaIds: [mediaId] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ token, expiresAt: expiresAt.toJSON(), reused: true });
    await app.close();
  });

  it("revokes the active public link and restores an undecided finding to ready", async () => {
    const linkUpdate = vi.fn().mockResolvedValue({});
    const findingUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: "EMPLOYEE", isActive: true, user: { isActive: true } }) },
      approvalVersion: { findFirst: vi.fn().mockResolvedValue({
        id: "77777777-7777-4777-8777-777777777777",
        link: { id: "88888888-8888-4888-8888-888888888888" },
      }) },
      $transaction: vi.fn(async (callback) => callback({
        approvalLink: { update: linkUpdate },
        finding: { updateMany: findingUpdateMany },
        auditEvent: { create: auditCreate },
      })),
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({
      method: "DELETE",
      url: `/v1/findings/${findingId}/approval-link`,
      headers,
    });

    expect(response.statusCode).toBe(204);
    expect(linkUpdate).toHaveBeenCalledOnce();
    expect(findingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "READY_FOR_APPROVAL" }),
    }));
    expect(auditCreate).toHaveBeenCalledOnce();
    await app.close();
  });
});
