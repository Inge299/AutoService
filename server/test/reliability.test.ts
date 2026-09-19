import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { mediaRoutes } from "../src/http/routes/media.js";
import { publicApprovalRoutes } from "../src/http/routes/public-approvals.js";
import { serializable } from "../src/infrastructure/transaction.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";
const id = "11111111-1111-4111-8111-111111111111";
const token = "synthetic_approval_token_abcdefghijklmnopqrstuvwxyz";
const asset = { id, workshopId: id, visitId: id, findingId: id, operationId: id, state: "VERIFIED", byteCount: 4n, sha256: "a".repeat(64), mimeType: "image/jpeg", kind: "PHOTO", objectKey: "private/verified" };

async function mediaApp(prisma: unknown, storage: unknown = {}) {
  const app = Fastify();
  app.addHook("preHandler", async request => { request.actor = { workshopId: id, userId: id, role: "EMPLOYEE" }; });
  await app.register(mediaRoutes(prisma as PrismaClient, storage as ObjectStorage));
  return app;
}

describe("P0 reliability regressions", () => {
  it("never issues a writable target for verified evidence", async () => {
    const createUploadTarget = vi.fn();
    const app = await mediaApp({ visit: { findFirst: async () => ({ id }) }, finding: { findFirst: async () => ({ id }) }, mediaAsset: { findUnique: async () => asset } }, { createUploadTarget });
    try {
      const response = await app.inject({ method: "POST", url: `/v1/media/${id}/upload-session`, payload: { ...asset, byteCount: 4 } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ alreadyUploaded: true });
      expect(createUploadTarget).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(["DEAD", "RUNNING"])("restarts only DEAD verification, preserving %s job semantics", async state => {
    const update = vi.fn();
    const transaction = { mediaAsset: { update: vi.fn() }, backgroundJob: { findUnique: async () => ({ id, state }), update } };
    const prisma = { mediaAsset: { findFirst: async () => ({ ...asset, state: "RETRY" }) }, $transaction: async (fn: (tx: unknown) => unknown) => fn(transaction) };
    const app = await mediaApp(prisma, { head: async () => ({ byteCount: 4, sha256: asset.sha256 }) });
    try {
      const response = await app.inject({ method: "POST", url: `/v1/media/${id}/complete`, payload: {} });
      expect(response.statusCode).toBe(202);
      if (state === "DEAD") expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "PENDING", attempts: 0 }) }));
      else expect(update).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(["COMPLETED", "CANCELLED"])("does not reopen a %s visit on a late decision", async status => {
    const create = vi.fn();
    const transaction = { approvalLink: { findUnique: async () => ({ expiresAt: new Date(Date.now() + 60000), revokedAt: null, approvalVersion: { decision: null, visit: { status } } }) }, approvalDecision: { create } };
    const app = Fastify();
    await app.register(publicApprovalRoutes({ $transaction: async (fn: (tx: unknown) => unknown) => fn(transaction) } as unknown as PrismaClient, {} as ObjectStorage));
    try {
      const response = await app.inject({ method: "POST", url: `/public/v1/approvals/${token}/decision`, payload: { value: "APPROVED" } });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "visit_closed" });
      expect(create).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("re-reads business data after a serialization conflict", async () => {
    const action = vi.fn().mockResolvedValue("fresh decision");
    const transaction = vi.fn()
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("retry", { code: "P2034", clientVersion: "6.12.0" }))
      .mockImplementationOnce(async fn => fn({}));
    expect(await serializable({ $transaction: transaction } as unknown as PrismaClient, action)).toBe("fresh decision");
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenLastCalledWith(action, { isolationLevel: "Serializable" });
  });

  it("locks report evidence even when its finding is still a draft", async () => {
    const remove = vi.fn();
    const transaction = { mediaAsset: { findFirst: async () => ({ ...asset, finding: { status: "DRAFT" } }), delete: vi.fn() }, approvalVersion: { findFirst: async () => null }, reportVersion: { findFirst: async () => ({ id }) } };
    const app = await mediaApp({ $transaction: async (fn: (tx: unknown) => unknown) => fn(transaction) }, { remove });
    try {
      expect((await app.inject({ method: "DELETE", url: `/v1/media/${id}` })).statusCode).toBe(409);
      expect(remove).not.toHaveBeenCalled();
      expect(transaction.mediaAsset.delete).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
