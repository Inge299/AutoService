import { serializable } from "../../infrastructure/transaction.js";
import { Prisma, type PrismaClient, type VisitStatus } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { normalizePhone } from "../../security/phone.js";
import { paginationFields, parseCursor, pageEnvelope } from "../../domain/list-page.js";
import { normalizePlate, plateVariants } from "../../domain/license-plate.js";
import { IdentityConflict, resolveVisitIdentity } from "../../domain/visit-identity.js";

const paramsSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["DRAFT", "IN_REPAIR", "WAITING_APPROVAL", "COMPLETED", "CANCELLED"]).optional(),
  attention: z.enum(["true", "false"]).optional(),
  ...paginationFields,
}).refine(q => !(q.page && q.pagination) && (!q.cursor || q.pagination === "cursor"), "invalid_pagination");
const bodySchema = z.object({
  customerName: z.string().trim().max(200),
  customerId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  customerPhone: z.string().trim().min(10).max(32).transform(normalizePhone),
  vehicleLabel: z.string().trim().max(200),
  licensePlate: z.string().trim().max(32).transform(normalizePlate),
  mileageKm: z.number().int().nonnegative().nullable(),
  complaint: z.string().trim().max(4_000),
  status: z.enum(["DRAFT", "IN_REPAIR", "WAITING_APPROVAL", "COMPLETED", "CANCELLED"]),
  createdAtEpochMs: z.number().int().nonnegative(),
  updatedAtEpochMs: z.number().int().nonnegative(),
  baseServerVersion: z.number().int().positive().nullable().default(null),
}).refine(body => body.vehicleLabel.length > 0 || body.licensePlate.length > 0, {
  path: ["vehicleLabel"], message: "vehicle_or_plate_required",
});

export function visitRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get("/v1/visits", async (request) => {
      const query = listQuerySchema.parse(request.query);
      const { workshopId } = request.actor;
      const search = query.q || undefined;

      const where: Prisma.VisitWhereInput = {
          workshopId,
          ...(query.attention === "true" ? { AND: [{ status: { notIn: ["COMPLETED", "CANCELLED"] as VisitStatus[] } }, { findings: { some: { status: "CALL_REQUESTED" as const } } }] } : {}),
          ...(query.status ? { status: query.status as VisitStatus } : {}),
          ...(search
            ? {
                OR: [
                  { customerName: { contains: search, mode: "insensitive" } },
                  { customerPhone: { contains: search, mode: "insensitive" } },
                  { vehicleLabel: { contains: search, mode: "insensitive" } },
                  ...plateVariants(search).map(plate => ({ licensePlate: { contains: plate, mode: "insensitive" as const } })),
                  ...(/^[+\d\s()-]+$/.test(search) && search.replace(/\D/g, "").length >= 3
                    ? [{ customerPhone: { contains: search.replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7") } }] : []),
                ],
              }
            : {}),
        };
      const include = {
          findings: {
            orderBy: { createdAt: "asc" },
            include: {
              _count: { select: { media: true } },
              media: { where: { state: { in: ["VERIFIED", "READY"] } }, select: { id: true } },
            },
          },
          report: { select: { nextVisitAt: true } },
          _count: { select: { media: true } },
        } satisfies Prisma.VisitInclude;
      if (!query.page && !query.pagination) return prisma.visit.findMany({ where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: query.limit, include });
      const cursorWhere = parseCursor(query.cursor);
      return prisma.$transaction(async tx => {
        const [rows, total] = await Promise.all([
          tx.visit.findMany({ where: cursorWhere ? { AND: [where, cursorWhere] } : where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: ((query.page ?? 1) - 1) * query.limit,
            take: query.limit + 1, include }),
          tx.visit.count({ where }),
        ]);
        return pageEnvelope(rows, total, query);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
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
          report: { select: { nextVisitAt: true } },
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
        if (existing && ["COMPLETED", "CANCELLED"].includes(existing.status)) {
          return { closed: true as const };
        }
        if (body.status === "COMPLETED") return { reportRequired: true as const };
        if (existing && body.baseServerVersion !== existing.serverVersion) {
          return { conflict: true as const, visit: existing };
        }

        const { customer, vehicle } = await resolveVisitIdentity(tx, workshopId, body, existing);
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
              visit: { vehicleId: vehicle.id },
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
      }).catch(error => {
        if (error instanceof IdentityConflict) return { identityError: error.code };
        throw error;
      });

      if (!visit) return reply.code(404).send({ error: "not_found" });
      if ("identityError" in visit) return reply.code(409).send({ error: visit.identityError });
      if (visit.closed) return reply.code(409).send({ error: "visit_closed" });
      if (visit.reportRequired) return reply.code(409).send({ error: "visit_status_managed_by_report" });
      if (visit.conflict) return reply.code(409).send({ error: "version_conflict", server: visit.visit });
      return reply.send(visit.visit);
    });
  };
}
