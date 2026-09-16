import { createHash } from "node:crypto";
import type { FindingPriority, FindingStatus, PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  visitId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4_000),
  priceRub: z.number().int().nonnegative().nullable(),
  priority: z.enum(["CRITICAL", "IMPORTANT", "PLANNED"]),
  status: z.enum([
    "DRAFT", "READY_FOR_APPROVAL", "SENT_TO_CUSTOMER", "APPROVED",
    "DECLINED", "CALL_REQUESTED", "DEFERRED",
  ]),
  createdAtEpochMs: z.number().int().nonnegative(),
  updatedAtEpochMs: z.number().int().nonnegative(),
  baseServerVersion: z.number().int().positive().nullable().default(null),
});

const staffWritableFindingStatuses = new Set(["DRAFT", "READY_FOR_APPROVAL"]);

const approvalSchema = z.object({
  operationId: z.string().uuid(),
  token: z.string().min(43).max(200).regex(/^[A-Za-z0-9_-]+$/),
  mediaIds: z.array(z.string().uuid()).max(20),
  expiresInDays: z.number().int().min(1).max(30).default(7),
}).superRefine((value, context) => {
  if (new Set(value.mediaIds).size !== value.mediaIds.length) {
    context.addIssue({ code: "custom", path: ["mediaIds"], message: "Media ids must be unique" });
  }
});

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function findingRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.put("/v1/findings/:id", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const body = bodySchema.parse(request.body);
      const { workshopId } = request.actor;
      if (!staffWritableFindingStatuses.has(body.status)) {
        return reply.code(403).send({ error: "finding_status_managed_by_approval" });
      }

      const result = await prisma.$transaction(async (tx) => {
        const visit = await tx.visit.findFirst({ where: { id: body.visitId, workshopId }, select: { id: true } });
        if (!visit) return null;
        const existing = await tx.finding.findUnique({ where: { id } });
        if (existing && existing.workshopId !== workshopId) return null;
        if (existing && existing.status !== "DRAFT") return { statusProtected: true as const };
        if (existing && body.baseServerVersion !== existing.serverVersion) {
          return { conflict: true as const, finding: existing };
        }

        const data = {
          visitId: body.visitId,
          title: body.title,
          description: body.description,
          priceRub: body.priceRub,
          priority: body.priority as FindingPriority,
          status: body.status as FindingStatus,
          updatedAt: new Date(body.updatedAtEpochMs),
        };
        const finding = existing
          ? await tx.finding.update({ where: { id }, data: { ...data, serverVersion: { increment: 1 } } })
          : await tx.finding.create({
              data: { id, workshopId, ...data, createdAt: new Date(body.createdAtEpochMs) },
            });
        return { conflict: false as const, finding };
      });

      if (!result) return reply.code(404).send({ error: "not_found" });
      if (result.statusProtected) return reply.code(403).send({ error: "finding_status_managed_by_approval" });
      if (result.conflict) return reply.code(409).send({ error: "version_conflict", server: result.finding });
      return reply.send(result.finding);
    });

    app.post("/v1/findings/:id/approval-link", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const body = approvalSchema.parse(request.body);
      const { workshopId, userId } = request.actor;
      const expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 60 * 60_000);
      const hashedToken = tokenHash(body.token);

      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.approvalVersion.findUnique({
          where: { operationId: body.operationId },
          include: { link: true },
        });
        if (existing) {
          if (
            existing.workshopId !== workshopId || existing.findingId !== id ||
            !existing.link || existing.link.tokenHash !== hashedToken
          ) {
            return { kind: "operation_conflict" as const };
          }
          return { kind: "existing" as const, link: existing.link, approvalVersionId: existing.id };
        }

        const finding = await tx.finding.findFirst({
          where: { id, workshopId, status: "READY_FOR_APPROVAL" },
          select: {
            id: true,
            visitId: true,
            title: true,
            description: true,
            priceRub: true,
          },
        });
        if (!finding) return { kind: "finding_unavailable" as const };
        if (finding.priceRub === null) return { kind: "price_required" as const };

        const media = await tx.mediaAsset.findMany({
          where: {
            id: { in: body.mediaIds },
            workshopId,
            visitId: finding.visitId,
            findingId: id,
            state: { in: ["VERIFIED", "READY"] },
          },
          select: { id: true },
        });
        if (media.length !== body.mediaIds.length) return { kind: "media_unavailable" as const };

        const previous = await tx.approvalVersion.findFirst({
          where: { findingId: id },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        // Claim the READY state atomically. This prevents two concurrent staff
        // requests from publishing different links for the same finding.
        const claimed = await tx.finding.updateMany({
          where: { id, workshopId, status: "READY_FOR_APPROVAL" },
          data: { status: "SENT_TO_CUSTOMER", updatedAt: new Date(), serverVersion: { increment: 1 } },
        });
        if (claimed.count !== 1) return { kind: "finding_unavailable" as const };
        const approvalVersion = await tx.approvalVersion.create({
          data: {
            operationId: body.operationId,
            workshopId,
            visitId: finding.visitId,
            findingId: id,
            version: (previous?.version ?? 0) + 1,
            title: finding.title,
            description: finding.description,
            priceRub: finding.priceRub,
            mediaIds: body.mediaIds,
          },
        });
        const link = await tx.approvalLink.create({
          data: {
            approvalVersionId: approvalVersion.id,
            tokenHash: hashedToken,
            expiresAt,
          },
        });
        await tx.visit.update({
          where: { id: finding.visitId },
          data: { status: "WAITING_APPROVAL", updatedAt: new Date(), serverVersion: { increment: 1 } },
        });
        await tx.auditEvent.create({
          data: {
            workshopId,
            actorUserId: userId,
            action: "APPROVAL_LINK_CREATED",
            entityType: "finding",
            entityId: id,
            metadata: { approvalVersionId: approvalVersion.id, mediaCount: body.mediaIds.length },
          },
        });
        return { kind: "created" as const, link, approvalVersionId: approvalVersion.id };
      });

      if (result.kind === "finding_unavailable") return reply.code(409).send({ error: "finding_not_ready" });
      if (result.kind === "price_required") return reply.code(409).send({ error: "price_required" });
      if (result.kind === "media_unavailable") return reply.code(409).send({ error: "approval_media_unavailable" });
      if (result.kind === "operation_conflict") return reply.code(409).send({ error: "operation_conflict" });

      return reply.code(result.kind === "created" ? 201 : 200).send({
        approvalVersionId: result.approvalVersionId,
        token: body.token,
        publicPath: `/a/${body.token}`,
        expiresAt: result.link.expiresAt,
        reused: result.kind === "existing",
      });
    });

    app.delete("/v1/findings/:id/approval-link", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const { workshopId, userId } = request.actor;
      const approval = await prisma.approvalVersion.findFirst({
        where: { findingId: id, workshopId, link: { is: { revokedAt: null } } },
        orderBy: { version: "desc" },
        include: { link: true },
      });
      if (!approval?.link) return reply.code(404).send({ error: "active_approval_not_found" });

      await prisma.$transaction(async (tx) => {
        await tx.approvalLink.update({ where: { id: approval.link!.id }, data: { revokedAt: new Date() } });
        await tx.finding.updateMany({
          where: { id, workshopId, status: "SENT_TO_CUSTOMER" },
          data: { status: "READY_FOR_APPROVAL", updatedAt: new Date(), serverVersion: { increment: 1 } },
        });
        await tx.auditEvent.create({
          data: {
            workshopId,
            actorUserId: userId,
            action: "APPROVAL_LINK_REVOKED",
            entityType: "finding",
            entityId: id,
            metadata: { approvalVersionId: approval.id },
          },
        });
      });
      return reply.code(204).send();
    });
  };
}
