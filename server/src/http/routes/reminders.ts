import type { ReminderState, PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().uuid() });
const listSchema = z.object({
  state: z.enum(["PENDING", "SENT", "DELIVERED", "FAILED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export function reminderRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get("/v1/reminders", async (request) => {
      const query = listSchema.parse(request.query);
      return prisma.reminder.findMany({
        where: { workshopId: request.actor.workshopId, ...(query.state ? { state: query.state as ReminderState } : {}) },
        orderBy: [{ sendAt: "asc" }, { createdAt: "desc" }],
        take: query.limit,
        include: {
          returnVisit: { select: { id: true, status: true, updatedAt: true } },
          reportVersion: { select: { version: true, createdAt: true } },
        },
      });
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
