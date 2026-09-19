import { serializable } from "../../infrastructure/transaction.js";
import type { MediaKind, PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ObjectStorage } from "../../infrastructure/object-storage.js";

const paramsSchema = z.object({ id: z.string().uuid() });
const uploadSchema = z.object({
  operationId: z.string().uuid(),
  visitId: z.string().uuid(),
  findingId: z.string().uuid().nullable().default(null),
  kind: z.enum(["PHOTO", "VIDEO", "VOICE"]),
  mimeType: z.enum(["image/jpeg", "video/mp4", "audio/mp4"]),
  byteCount: z.number().int().positive().max(50 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine((value, context) => {
  const expectedMime = { PHOTO: "image/jpeg", VIDEO: "video/mp4", VOICE: "audio/mp4" }[value.kind];
  if (value.mimeType !== expectedMime) {
    context.addIssue({ code: "custom", path: ["mimeType"], message: "MIME type does not match media kind" });
  }
});

export function mediaRoutes(prisma: PrismaClient, storage: ObjectStorage): FastifyPluginAsync {
  return async (app) => {
    app.get("/v1/media/:id", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, workshopId: request.actor.workshopId },
        select: { id: true, state: true, byteCount: true, sha256: true, lastError: true },
      });
      if (!asset) return reply.code(404).send({ error: "not_found" });
      return reply.send({ ...asset, byteCount: asset.byteCount.toString() });
    });

    app.post("/v1/media/:id/upload-session", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const body = uploadSchema.parse(request.body);
      const { workshopId } = request.actor;

      const visit = await prisma.visit.findFirst({ where: { id: body.visitId, workshopId }, select: { id: true } });
      if (!visit) return reply.code(404).send({ error: "visit_not_found" });
      if (body.findingId) {
        const finding = await prisma.finding.findFirst({
          where: { id: body.findingId, visitId: body.visitId, workshopId },
          select: { id: true },
        });
        if (!finding) return reply.code(404).send({ error: "finding_not_found" });
      }

      const objectKey = `workshops/${workshopId}/visits/${body.visitId}/media/${id}/original`;
      const existing = await prisma.mediaAsset.findUnique({ where: { operationId: body.operationId } });
      if (existing && (
        existing.workshopId !== workshopId || existing.id !== id || existing.sha256 !== body.sha256 ||
        existing.byteCount !== BigInt(body.byteCount) || existing.visitId !== body.visitId ||
        existing.findingId !== body.findingId || existing.kind !== body.kind || existing.mimeType !== body.mimeType
      )) {
        return reply.code(409).send({ error: "operation_conflict" });
      }

      const asset = existing ?? await prisma.mediaAsset.create({
        data: {
          id,
          operationId: body.operationId,
          workshopId,
          visitId: body.visitId,
          findingId: body.findingId,
          kind: body.kind as MediaKind,
          mimeType: body.mimeType,
          byteCount: BigInt(body.byteCount),
          sha256: body.sha256,
          objectKey,
        },
      });
      if (["VERIFIED", "PROCESSING", "READY"].includes(asset.state)) {
        return reply.send({ mediaId: asset.id, state: asset.state, alreadyUploaded: true });
      }
      const target = await storage.createUploadTarget({
        objectKey: asset.objectKey,
        mimeType: asset.mimeType,
        byteCount: Number(asset.byteCount),
        sha256: asset.sha256,
      });
      return reply.send({ mediaId: asset.id, method: "PUT", ...target });
    });

    app.post("/v1/media/:id/complete", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const { workshopId } = request.actor;
      const asset = await prisma.mediaAsset.findFirst({ where: { id, workshopId } });
      if (!asset) return reply.code(404).send({ error: "not_found" });
      if (["VERIFIED", "PROCESSING", "READY"].includes(asset.state)) {
        return reply.send({ id: asset.id, state: asset.state });
      }

      const object = await storage.head(asset.objectKey);
      if (BigInt(object.byteCount) !== asset.byteCount || object.sha256 !== asset.sha256) {
        return reply.code(409).send({ error: "integrity_metadata_mismatch" });
      }

      await serializable(prisma, async (tx) => {
        const key = `verify-media:${id}:${asset.sha256}`;
        const job = await tx.backgroundJob.findUnique({ where: { idempotencyKey: key } });
        if (job?.state === "SUCCEEDED") return;
        await tx.mediaAsset.update({ where: { id }, data: { state: "VERIFYING", lastError: null } });
        if (job?.state === "DEAD") {
          await tx.backgroundJob.update({ where: { id: job.id }, data: { state: "PENDING", attempts: 0, runAfter: new Date(), lockedUntil: null, lastError: null } });
        } else if (!job) {
          await tx.backgroundJob.create({ data: { workshopId, type: "VERIFY_MEDIA", payload: { mediaId: id }, idempotencyKey: key } });
        }
      });
      return reply.code(202).send({ id, state: "VERIFYING" });
    });

    app.put("/v1/media/:id/content", { bodyLimit: 50 * 1024 * 1024 }, async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const { workshopId } = request.actor;
      const asset = await prisma.mediaAsset.findFirst({ where: { id, workshopId } });
      if (!asset) return reply.code(404).send({ error: "not_found" });
      if (["VERIFIED", "PROCESSING", "READY"].includes(asset.state) || asset.objectKey.endsWith("/verified")) return reply.code(409).send({ error: "media_already_verified" });
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "binary_body_required" });
      if (request.body.byteLength !== Number(asset.byteCount)) {
        return reply.code(409).send({ error: "byte_count_mismatch" });
      }
      const sha256 = createHash("sha256").update(request.body).digest("hex");
      if (sha256 !== asset.sha256) return reply.code(409).send({ error: "checksum_mismatch" });

      await storage.upload({
        objectKey: asset.objectKey,
        mimeType: asset.mimeType,
        byteCount: Number(asset.byteCount),
        sha256: asset.sha256,
        body: request.body,
      });
      return reply.code(204).send();
    });

    app.delete("/v1/media/:id", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const { workshopId } = request.actor;
      const result = await serializable(prisma, async (tx) => {
        const asset = await tx.mediaAsset.findFirst({ where: { id, workshopId }, include: { finding: { select: { status: true } } } });
        if (!asset) return { kind: "missing" as const };
        const [approval, report] = await Promise.all([
          tx.approvalVersion.findFirst({ where: { workshopId, mediaIds: { has: id } }, select: { id: true } }),
          tx.reportVersion.findFirst({ where: { workshopId, mediaIds: { has: id } }, select: { id: true } }),
        ]);
        if (approval || report || (asset.finding && !["DRAFT", "READY_FOR_APPROVAL"].includes(asset.finding.status))) return { kind: "locked" as const };
        await tx.mediaAsset.delete({ where: { id } });
        return { kind: "deleted" as const, objectKey: asset.objectKey };
      });
      if (result.kind === "missing") return reply.code(404).send({ error: "not_found" });
      if (result.kind === "locked") return reply.code(409).send({ error: "media_locked_by_approval" });
      await storage.remove(result.objectKey);
      return reply.code(204).send();
    });
  };
}
