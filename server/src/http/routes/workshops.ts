import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";

export function workshopRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get("/v1/workshop/summary", async request => {
      const workshopId = request.actor.workshopId;
      return prisma.$transaction(async tx => {
        const [visitGroups, findingGroups, value, attentionVisits, upcomingReminders, reminderGroups, urgentReminders] = await Promise.all([
          tx.visit.groupBy({ by: ["status"], where: { workshopId }, _count: { _all: true } }),
          tx.finding.groupBy({ by: ["status"], where: { workshopId }, _count: { _all: true } }),
          tx.finding.aggregate({ where: { workshopId, status: { in: ["APPROVED", "COMPLETED"] } }, _sum: { priceRub: true } }),
          tx.visit.count({ where: { workshopId, status: { notIn: ["COMPLETED", "CANCELLED"] }, findings: { some: { status: "CALL_REQUESTED" } } } }),
          tx.reminder.findMany({ where: { workshopId, state: "PENDING" }, orderBy: [{ sendAt: "asc" }, { id: "asc" }], take: 2,
            include: { returnVisit: { select: { id: true, status: true, updatedAt: true } }, reportVersion: { select: { version: true, createdAt: true } } } }),
          tx.reminder.groupBy({ by: ["state"], where: { workshopId }, _count: { _all: true } }),
          tx.reminder.count({ where: { workshopId, state: "PENDING", sendAt: { lt: new Date(Date.now() + 24 * 60 * 60_000) } } }),
        ]);
        const visitCounts = Object.fromEntries(visitGroups.map(g => [g.status, g._count._all]));
        const findingCounts = Object.fromEntries(findingGroups.map(g => [g.status, g._count._all]));
        const count = (key: string) => findingCounts[key] ?? 0;
        const sent = ["SENT_TO_CUSTOMER", "APPROVED", "COMPLETED", "DECLINED", "CALL_REQUESTED", "DEFERRED"].reduce((sum, key) => sum + count(key), 0);
        const decisions = sent - count("SENT_TO_CUSTOMER");
        return { totalVisits: visitGroups.reduce((sum, g) => sum + g._count._all, 0), visitCounts,
          activeVisits: visitGroups.filter(g => !["COMPLETED", "CANCELLED"].includes(g.status)).reduce((sum, g) => sum + g._count._all, 0),
          attentionVisits, sent, decisions, approved: count("APPROVED") + count("COMPLETED"),
          approvedValue: value._sum.priceRub ?? 0, upcomingReminders, urgentReminders,
          reminderCounts: Object.fromEntries(reminderGroups.map(g => [g.state, g._count._all])) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    });
    app.get("/v1/workshop", async (request, reply) => {
      const workshop = await prisma.workshop.findUnique({
        where: { id: request.actor.workshopId },
        select: { id: true, name: true, phone: true },
      });

      if (!workshop) return reply.code(404).send({ error: "not_found" });
      return workshop;
    });
  };
}
