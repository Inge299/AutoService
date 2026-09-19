import { serializable } from "../../infrastructure/transaction.js";
import { randomUUID } from "node:crypto";
import type { PrismaClient, VisitStatus } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["DRAFT", "IN_REPAIR", "WAITING_APPROVAL", "COMPLETED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
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
    app.get("/v1/visits", async (request) => {
      const query = listQuerySchema.parse(request.query);
      const { workshopId } = request.actor;
      const search = query.q || undefined;

      return prisma.visit.findMany({
        where: {
          workshopId,
          ...(query.status ? { status: query.status as VisitStatus } : {}),
          ...(search
            ? {
                OR: [
                  { customerName: { contains: search, mode: "insensitive" } },
                  { customerPhone: { contains: search, mode: "insensitive" } },
                  { vehicleLabel: { contains: search, mode: "insensitive" } },
                  { licensePlate: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: query.limit,
        include: {
          findings: {
            orderBy: { createdAt: "asc" },
            include: {
              _count: { select: { media: true } },
              media: { where: { state: { in: ["VERIFIED", "READY"] } }, select: { id: true } },
            },
          },
          _count: { select: { media: true } },
        },
      });
    });

    app.get("/v1/visits/:id", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const visit = await prisma.visit.findFirst({
        where: { id, workshopId: request.actor.workshopId },
        include: {
          findings: {
            orderBy: { createdAt: "asc" },
            include: {
              _count: { select: { media: true } },
              media: { where: { state: { in: ["VERIFIED", "READY"] } }, select: { id: true } },
            },
          },
          _count: { select: { media: true } },
        },
      });

      if (!visit) return reply.code(404).send({ error: "not_found" });
      return visit;
    });

    app.put("/v1/visits/:id", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const body = bodySchema.parse(request.body);
      const { workshopId } = request.actor;

      const visit = await serializable(prisma, async (tx) => {
        const existing = await tx.visit.findUnique({ where: { id } });
        if (existing && existing.workshopId !== workshopId) return null;
        if (existing && body.baseServerVersion !== existing.serverVersion) {
          return { conflict: true as const, visit: existing };
        }

        const customer = await tx.customer.upsert({
          where: { workshopId_phone: { workshopId, phone: body.customerPhone } },
          update: { name: body.customerName },
          create: { id: randomUUID(), workshopId, name: body.customerName, phone: body.customerPhone },
        });
        const existingVehicle = await tx.vehicle.findFirst({
          where: { workshopId, customerId: customer.id, label: body.vehicleLabel, licensePlate: body.licensePlate.toUpperCase() },
          select: { id: true },
        });
        const vehicle = existingVehicle
          ? await tx.vehicle.update({ where: { id: existingVehicle.id }, data: { updatedAt: new Date(body.updatedAtEpochMs) } })
          : await tx.vehicle.create({ data: { id: randomUUID(), workshopId, customerId: customer.id, label: body.vehicleLabel, licensePlate: body.licensePlate.toUpperCase() } });
        const data = {
          customerName: body.customerName,
          customerPhone: body.customerPhone,
          vehicleLabel: body.vehicleLabel,
          licensePlate: body.licensePlate.toUpperCase(),
          mileageKm: body.mileageKm,
          complaint: body.complaint,
          status: body.status as VisitStatus,
          updatedAt: new Date(body.updatedAtEpochMs),
          customerId: customer.id,
          vehicleId: vehicle.id,
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
        if (!existing) {
          const reminder = await tx.reminder.findFirst({
            where: {
              workshopId,
              customerPhone: body.customerPhone,
              returnVisitId: null,
              visitId: { not: saved.id },
              state: { in: ["PENDING", "SENT", "DELIVERED"] },
            },
            orderBy: { dueAt: "asc" },
            select: { id: true, state: true },
          });
          if (reminder) {
            await tx.reminder.update({
              where: { id: reminder.id },
              data: {
                returnVisitId: saved.id,
                ...(reminder.state === "PENDING" ? { state: "CANCELLED", cancelledAt: new Date() } : {}),
              },
            });
            await tx.auditEvent.create({
              data: {
                workshopId,
                actorUserId: request.actor.userId,
                action: "REMINDER_RETURN_VISIT_LINKED",
                entityType: "reminder",
                entityId: reminder.id,
                metadata: { returnVisitId: saved.id },
              },
            });
          }
        }
        return { conflict: false as const, visit: saved };
      });

      if (!visit) return reply.code(404).send({ error: "not_found" });
      if (visit.conflict) return reply.code(409).send({ error: "version_conflict", server: visit.visit });
      return reply.send(visit.visit);
    });
  };
}
