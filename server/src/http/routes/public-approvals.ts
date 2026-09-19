import { serializable } from "../../infrastructure/transaction.js";
import { createHash } from "node:crypto";
import type { ApprovalDecisionValue, FindingStatus, PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ObjectStorage } from "../../infrastructure/object-storage.js";

const paramsSchema = z.object({ token: z.string().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/) });
const decisionSchema = z.object({
  value: z.enum(["APPROVED", "DECLINED", "DEFERRED", "CALL_REQUESTED"]),
});

const approvalInclude = {
  approvalVersion: {
    include: {
      workshop: { select: { name: true, phone: true } },
      visit: {
        select: {
          id: true,
          customerName: true,
          vehicleLabel: true,
          licensePlate: true,
          status: true,
        },
      },
      finding: { select: { priority: true } },
      decision: { select: { value: true, createdAt: true } },
    },
  },
} as const;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function unavailable(link: { expiresAt: Date; revokedAt: Date | null }): boolean {
  return Boolean(link.revokedAt) || link.expiresAt.getTime() <= Date.now();
}

export function publicApprovalRoutes(prisma: PrismaClient, storage: ObjectStorage): FastifyPluginAsync {
  return async (app) => {
    app.get("/public/v1/approvals/:token", async (request, reply) => {
      const { token } = paramsSchema.parse(request.params);
      const link = await prisma.approvalLink.findUnique({
        where: { tokenHash: tokenHash(token) },
        include: approvalInclude,
      });
      if (!link) return reply.code(404).send({ error: "not_found" });
      if (unavailable(link)) return reply.code(410).send({ error: "link_unavailable" });

      if (!link.openedAt) {
        await prisma.approvalLink.update({ where: { id: link.id }, data: { openedAt: new Date() } });
      }

      const version = link.approvalVersion;
      const assets = version.mediaIds.length
        ? await prisma.mediaAsset.findMany({
            where: {
              id: { in: version.mediaIds },
              workshopId: version.workshopId,
              visitId: version.visitId,
              findingId: version.findingId,
              state: { in: ["VERIFIED", "READY"] },
            },
            select: { id: true, kind: true, mimeType: true, objectKey: true, sha256: true, byteCount: true },
          })
        : [];
      if (assets.length !== version.mediaIds.length) {
        return reply.code(410).send({ error: "approval_media_unavailable" });
      }
      const byId = new Map(assets.map((asset) => [asset.id, asset]));
      const media = await Promise.all(version.mediaIds.map(async (mediaId) => {
        const asset = byId.get(mediaId);
        if (!asset) throw new Error("Approval media snapshot is incomplete");
        const objectKey = await storage.seal(asset);
        if (objectKey !== asset.objectKey) await prisma.mediaAsset.update({ where: { id: asset.id }, data: { objectKey } });
        const target = await storage.createDownloadTarget(objectKey);
        return {
          id: asset.id,
          kind: asset.kind,
          mimeType: asset.mimeType,
          url: target.url,
          expiresInSeconds: target.expiresInSeconds,
        };
      }));
      return reply.send({
        expiresAt: link.expiresAt,
        openedAt: link.openedAt ?? new Date(),
        workshop: version.workshop,
        visit: version.visit,
        finding: {
          id: version.findingId,
          title: version.title,
          description: version.description,
          priceRub: version.priceRub,
          priority: version.finding.priority,
          mediaCount: media.length,
        },
        media,
        decision: version.decision,
      });
    });

    app.post("/public/v1/approvals/:token/decision", async (request, reply) => {
      const { token } = paramsSchema.parse(request.params);
      const body = decisionSchema.parse(request.body);
      const value = body.value as ApprovalDecisionValue;
      const findingStatus = body.value as FindingStatus;
      const result = await serializable(prisma, async (tx) => {
        const link = await tx.approvalLink.findUnique({
          where: { tokenHash: tokenHash(token) }, include: approvalInclude,
        });
        if (!link) return { code: 404, body: { error: "not_found" } };
        if (unavailable(link)) return { code: 410, body: { error: "link_unavailable" } };
        const existing = link.approvalVersion.decision;
        if (existing) return existing.value === body.value
          ? { code: 200, body: existing }
          : { code: 409, body: { error: "decision_already_recorded" } };
        if (["COMPLETED", "CANCELLED"].includes(link.approvalVersion.visit.status)) {
          return { code: 409, body: { error: "visit_closed" } };
        }
        const saved = await tx.approvalDecision.create({
          data: { approvalVersionId: link.approvalVersionId, value },
        });
        await tx.finding.update({
          where: { id: link.approvalVersion.findingId },
          data: { status: findingStatus, updatedAt: new Date(), serverVersion: { increment: 1 } },
        });
        const unansweredApprovals = await tx.finding.count({
          where: {
            workshopId: link.approvalVersion.workshopId,
            visitId: link.approvalVersion.visitId,
            status: "SENT_TO_CUSTOMER",
          },
        });
        await tx.visit.update({
          where: { id: link.approvalVersion.visitId },
          data: {
            // A visit is waiting only while there is at least one unanswered link.
            // A declined, deferred, or call-requested last decision must also release it.
            status: unansweredApprovals === 0 ? "IN_REPAIR" : "WAITING_APPROVAL",
            updatedAt: new Date(),
            serverVersion: { increment: 1 },
          },
        });
        await tx.auditEvent.create({
          data: {
            workshopId: link.approvalVersion.workshopId,
            action: "APPROVAL_DECISION_RECORDED",
            entityType: "finding",
            entityId: link.approvalVersion.findingId,
            metadata: { value, approvalVersionId: link.approvalVersionId, unansweredApprovals },
          },
        });
        return { code: 201, body: saved };
      });

      return reply.code(result.code).send(result.body);
    });
  };
}
