import type { PrismaClient, VisitStatus } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  customerName: z.string().trim().max(200),
  customerPhone: z.string().trim().min(10).max(32),
  vehicleLabel: z.string().trim().max(200),
  licensePlate: z.string().trim().max(32),
  mileageKm: z.number().int().nonnegative().nullable(),
  complaint: z.string().trim().max(4_000),
  status: z.enum(["DRAFT", "IN_REPAIR", "WAITING_APPROVAL", "COMPLETED", "CANCELLED"]),
  createdAtEpochMs: z.number().int().nonnegative(),
  updatedAtEpochMs: z.number().int().nonnegative(),
  baseServerVersion: z.number().int().positive().nullable().default(null),
});

export function visitRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.put("/v1/visits/:id", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const body = bodySchema.parse(request.body);
      const { workshopId } = request.actor;

      const visit = await prisma.$transaction(async (tx) => {
        const existing = await tx.visit.findUnique({ where: { id } });
        if (existing && existing.workshopId !== workshopId) return null;
        if (existing && body.baseServerVersion !== existing.serverVersion) {
          return { conflict: true as const, visit: existing };
        }

        const data = {
          customerName: body.customerName,
          customerPhone: body.customerPhone,
          vehicleLabel: body.vehicleLabel,
          licensePlate: body.licensePlate.toUpperCase(),
          mileageKm: body.mileageKm,
          complaint: body.complaint,
          status: body.status as VisitStatus,
          updatedAt: new Date(body.updatedAtEpochMs),
        };
        const saved = existing
          ? await tx.visit.update({
              where: { id },
              data: { ...data, serverVersion: { increment: 1 } },
            })
          : await tx.visit.create({
              data: {
                id,
                workshopId,
                ...data,
                createdAt: new Date(body.createdAtEpochMs),
              },
            });
        return { conflict: false as const, visit: saved };
      });

      if (!visit) return reply.code(404).send({ error: "not_found" });
      if (visit.conflict) return reply.code(409).send({ error: "version_conflict", server: visit.visit });
      return reply.send(visit.visit);
    });
  };
}
