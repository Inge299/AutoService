import { Prisma, type ReminderState, type PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { paginationFields, parseCursor, pageEnvelope } from "../../domain/list-page.js";

const paramsSchema = z.object({ id: z.string().uuid() });
const listSchema = z.object({
  state: z.enum(["PENDING", "SENT", "DELIVERED", "FAILED", "CANCELLED"]).optional(),
  ...paginationFields,
}).refine(q => !(q.page && q.pagination) && (!q.cursor || q.pagination === "cursor"), "invalid_pagination");

export function reminderRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get("/v1/reminders", async (request) => {
      const query = listSchema.parse(request.query);
      const where = { workshopId: request.actor.workshopId, ...(query.state ? { state: query.state as ReminderState } : {}) };
      const include = {
          returnVisit: { select: { id: true, status: true, updatedAt: true } },
          reportVersion: { select: { version: true, createdAt: true } },
        } satisfies Prisma.ReminderInclude;
      if (!query.page && !query.pagination) return prisma.reminder.findMany({ where,
        orderBy: [{ sendAt: "asc" }, { createdAt: "desc" }, { id: "desc" }], take: query.limit, include });
      const cursorWhere = parseCursor(query.cursor);
      return prisma.$transaction(async tx => {
        const [rows, total] = await Promise.all([
          tx.reminder.findMany({ where: cursorWhere ? { AND: [where, cursorWhere] } : where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: ((query.page ?? 1) - 1) * query.limit,
            take: query.limit + 1, include }), tx.reminder.count({ where }),
        ]);
        return pageEnvelope(rows, total, query);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    });

    app.post("/v1/reminders/:id/cancel", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const { workshopId, userId } = request.actor;
      const result = await prisma.$transaction(async (tx) => {
        const reminder = await tx.reminder.findFirst({ where: { id, workshopId }, select: { id: true, state: true } });
        if (!reminder) return "not_found" as const;
        if (reminder.state !== "PENDING") return "not_pending" as const;
        await tx.reminder.update({
          where: { id },
          data: { state: "CANCELLED", cancelledAt: new Date(), lastError: null },
        });
        await tx.backgroundJob.updateMany({
          where: { reminderId: id, state: { in: ["PENDING", "RETRY", "RUNNING"] } },
          data: { state: "DEAD", lockedUntil: null, lastError: "Cancelled by staff" },
        });
        await tx.auditEvent.create({
          data: {
            workshopId,
            actorUserId: userId,
            action: "REMINDER_CANCELLED",
            entityType: "reminder",
            entityId: id,
          },
        });
        return "cancelled" as const;
      });
      if (result === "not_found") return reply.code(404).send({ error: "not_found" });
      if (result === "not_pending") return reply.code(409).send({ error: "reminder_not_pending" });
      return reply.code(204).send();
    });
  };
}
