import type { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { serializable } from "../../infrastructure/transaction.js";
import { isPastVisitDate } from "../../domain/visit-date.js";
import { cancelWorkReminders, scheduleWorkReminder } from "../../domain/follow-up-reminders.js";
import { futureWork } from "../../domain/report-recommendations.js";

const bodySchema = z.object({ baseServerVersion: z.number().int().positive(), dueAt: z.string().datetime({ offset: true }).nullable(),
  state: z.enum(["OPEN", "DONE", "CANCELLED"]) });

export function followUpRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async app => {
    app.put("/v1/findings/:id/follow-up", async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = bodySchema.parse(request.body), { workshopId, userId } = request.actor;
      const dueAt = body.dueAt ? new Date(body.dueAt) : null;
      const result = await serializable(prisma, async tx => {
        const finding = await tx.finding.findFirst({ where: { id, workshopId }, include: { visit: true } });
        if (!finding) return { error: "not_found", code: 404 } as const;
        if (finding.status === "COMPLETED" || finding.status === "DECLINED" || finding.visit.status === "CANCELLED" ||
          (finding.status !== "DEFERRED" && finding.priority !== "PLANNED")) return { error: "work_not_deferred", code: 409 } as const;
        if (finding.serverVersion !== body.baseServerVersion) return { error: "version_conflict", code: 409 } as const;
        if (body.state === "OPEN" && isPastVisitDate(dueAt)) return { error: "work_date_in_past", code: 400 } as const;
        const updated = await tx.finding.update({ where: { id }, data: { followUpDueAt: dueAt, followUpConfigured: true,
          followUpState: body.state, followUpCompletedAt: body.state === "DONE" ? new Date() : null,
          updatedAt: new Date(), serverVersion: { increment: 1 } } });
        await cancelWorkReminders(tx, workshopId, id);
        const report = await tx.reportVersion.findFirst({ where: { workshopId, visitId: finding.visitId,
          link: { is: { revokedAt: null } }, report: { status: "PUBLISHED" } }, orderBy: { version: "desc" } });
        if (report) {
          // Old reports had one combined reminder. Split it once, leaving each
          // other open work with its own schedule instead of silently losing it.
          const legacy = await tx.reminder.findMany({ where: { workshopId, reportVersionId: report.id, findingId: null,
            state: { in: ["PENDING", "FAILED"] } }, select: { id: true } });
          if (legacy.length) {
            const ids = legacy.map(row => row.id);
            await tx.reminder.updateMany({ where: { id: { in: ids }, workshopId }, data: { state: "CANCELLED", cancelledAt: new Date() } });
            await tx.backgroundJob.updateMany({ where: { workshopId, reminderId: { in: ids }, state: { in: ["PENDING", "RETRY", "RUNNING"] } },
              data: { state: "DEAD", lockedUntil: null, lastError: "Split into individual work reminders" } });
            const remaining = await tx.finding.findMany({ where: { workshopId, visitId: finding.visitId, id: { not: id } } });
            for (const work of futureWork(remaining)) {
              const date = work.followUpConfigured ? work.followUpDueAt : report.nextVisitAt;
              const existing = await tx.reminder.findFirst({ where: { workshopId, findingId: work.id, reportVersionId: report.id,
                state: { in: ["PENDING", "SENT", "DELIVERED"] } } });
              if (date && !existing) await scheduleWorkReminder(tx, finding.visit, report.id, work.id, `Необходимо выполнить: ${work.title}`, date);
            }
          }
        }
        if (report && body.state === "OPEN" && dueAt) {
          await scheduleWorkReminder(tx, finding.visit, report.id, id, `Необходимо выполнить: ${finding.title}`, dueAt);
        }
        await tx.auditEvent.create({ data: { workshopId, actorUserId: userId, action: "FOLLOW_UP_UPDATED", entityType: "finding", entityId: id,
          metadata: { previousState: finding.followUpState, state: body.state, previousDueAt: finding.followUpDueAt?.toISOString() ?? null, dueAt: body.dueAt } } });
        return { finding: updated };
      });
      if (result.code !== undefined) return reply.code(result.code).send({ error: result.error });
      return result.finding;
    });
  };
}
