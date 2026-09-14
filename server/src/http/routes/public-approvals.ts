import { createHash } from "node:crypto";
import type { ApprovalDecisionValue, FindingStatus, PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

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

export function publicApprovalRoutes(prisma: PrismaClient): FastifyPluginAsync {
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
          mediaCount: version.mediaIds.length,
        },
        decision: version.decision,
      });
    });

    app.post("/public/v1/approvals/:token/decision", async (request, reply) => {
      const { token } = paramsSchema.parse(request.params);
      const body = decisionSchema.parse(request.body);
      const link = await prisma.approvalLink.findUnique({
        where: { tokenHash: tokenHash(token) },
        include: approvalInclude,
      });
      if (!link) return reply.code(404).send({ error: "not_found" });
      if (unavailable(link)) return reply.code(410).send({ error: "link_unavailable" });

      const existing = link.approvalVersion.decision;
      if (existing) {
        if (existing.value !== body.value) return reply.code(409).send({ error: "decision_already_recorded" });
        return reply.send(existing);
      }

      const value = body.value as ApprovalDecisionValue;
      const findingStatus = body.value as FindingStatus;
      const decision = await prisma.$transaction(async (tx) => {
        const saved = await tx.approvalDecision.create({
          data: { approvalVersionId: link.approvalVersionId, value },
        });
        await tx.finding.update({
          where: { id: link.approvalVersion.findingId },
          data: { status: findingStatus, updatedAt: new Date(), serverVersion: { increment: 1 } },
        });
        await tx.visit.update({
          where: { id: link.approvalVersion.visitId },
          data: {
            ...(body.value === "APPROVED" ? { status: "IN_REPAIR" as const } : {}),
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
            metadata: { value, approvalVersionId: link.approvalVersionId },
          },
        });
        return saved;
      });

      return reply.code(201).send(decision);
    });
  };
}
