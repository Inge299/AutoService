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

export function findingRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.put("/v1/findings/:id", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const body = bodySchema.parse(request.body);
      const { workshopId } = request.actor;

      const result = await prisma.$transaction(async (tx) => {
        const visit = await tx.visit.findFirst({ where: { id: body.visitId, workshopId }, select: { id: true } });
        if (!visit) return null;
        const existing = await tx.finding.findUnique({ where: { id } });
        if (existing && existing.workshopId !== workshopId) return null;
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
      if (result.conflict) return reply.code(409).send({ error: "version_conflict", server: result.finding });
      return reply.send(result.finding);
    });
  };
}
