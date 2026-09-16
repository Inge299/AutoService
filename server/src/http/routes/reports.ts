import { createHash } from "node:crypto";
import type { PrismaClient, ReportStatus } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().uuid() });
const draftSchema = z.object({
  completedWork: z.string().trim().max(8_000),
  recommendations: z.string().trim().max(8_000),
  nextVisitAt: z.string().datetime({ offset: true }).nullable().default(null),
});
const publishSchema = z.object({
  operationId: z.string().uuid(),
  token: z.string().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/),
  expiresInDays: z.number().int().min(1).max(90).default(30),
});

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function reportRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get("/v1/visits/:id/report", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const report = await prisma.report.findFirst({
        where: { visitId: id, workshopId: request.actor.workshopId },
        include: {
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            include: { link: { select: { expiresAt: true, revokedAt: true, openedAt: true } } },
          },
        },
      });
      if (!report) return reply.code(404).send({ error: "not_found" });
      return report;
    });

    app.put("/v1/visits/:id/report", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const body = draftSchema.parse(request.body);
      const { workshopId } = request.actor;
      const nextVisitAt = body.nextVisitAt ? new Date(body.nextVisitAt) : null;

      const result = await prisma.$transaction(async (tx) => {
        const visit = await tx.visit.findFirst({ where: { id, workshopId }, select: { id: true } });
        if (!visit) return { kind: "not_found" as const };
        const existing = await tx.report.findUnique({ where: { visitId: id } });
        if (existing?.status === "PUBLISHED") return { kind: "published" as const };
        const data = {
          completedWork: body.completedWork,
          recommendations: body.recommendations,
          nextVisitAt,
        };
        const report = existing
          ? await tx.report.update({ where: { id: existing.id }, data })
          : await tx.report.create({ data: { workshopId, visitId: id, ...data } });
        return { kind: "saved" as const, report };
      });

      if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
      if (result.kind === "published") return reply.code(409).send({ error: "report_already_published" });
      return reply.send(result.report);
    });

    app.post("/v1/visits/:id/report/publish", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const body = publishSchema.parse(request.body);
      const { workshopId, userId } = request.actor;
      const expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 60 * 60_000);
      const hashedToken = tokenHash(body.token);

      const result = await prisma.$transaction(async (tx) => {
        const existingVersion = await tx.reportVersion.findUnique({
          where: { operationId: body.operationId },
          include: { link: true },
        });
        if (existingVersion) {
          if (
            existingVersion.workshopId !== workshopId || existingVersion.visitId !== id ||
            !existingVersion.link || existingVersion.link.tokenHash !== hashedToken
          ) return { kind: "operation_conflict" as const };
          return { kind: "existing" as const, version: existingVersion, link: existingVersion.link };
        }

        const report = await tx.report.findFirst({
          where: { visitId: id, workshopId, status: "DRAFT" },
          include: {
            visit: {
              select: {
                id: true,
                customerName: true,
                customerPhone: true,
                vehicleLabel: true,
                licensePlate: true,
                mileageKm: true,
                complaint: true,
              },
            },
          },
        });
        if (!report) return { kind: "report_unavailable" as const };
        if (!report.completedWork) return { kind: "completed_work_required" as const };

        const [previous, findings, media] = await Promise.all([
          tx.reportVersion.findFirst({ where: { reportId: report.id }, orderBy: { version: "desc" }, select: { version: true } }),
          tx.finding.findMany({
            where: { workshopId, visitId: id },
            orderBy: { createdAt: "asc" },
            select: { id: true, title: true, description: true, priceRub: true, priority: true, status: true },
          }),
          tx.mediaAsset.findMany({
            where: { workshopId, visitId: id, state: { in: ["VERIFIED", "READY"] } },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          }),
        ]);
        const version = await tx.reportVersion.create({
          data: {
            operationId: body.operationId,
            reportId: report.id,
            workshopId,
            visitId: id,
            version: (previous?.version ?? 0) + 1,
            customerName: report.visit.customerName,
            customerPhone: report.visit.customerPhone,
            vehicleLabel: report.visit.vehicleLabel,
            licensePlate: report.visit.licensePlate,
            mileageKm: report.visit.mileageKm,
            complaint: report.visit.complaint,
            completedWork: report.completedWork,
            recommendations: report.recommendations,
            nextVisitAt: report.nextVisitAt,
            findings,
            mediaIds: media.map((asset) => asset.id),
          },
        });
        const link = await tx.reportLink.create({
          data: { reportVersionId: version.id, tokenHash: hashedToken, expiresAt },
        });
        if (report.nextVisitAt) {
          const sendAt = new Date(Math.max(Date.now(), report.nextVisitAt.getTime() - 7 * 24 * 60 * 60_000));
          const reminder = await tx.reminder.create({
            data: {
              workshopId,
              reportVersionId: version.id,
              visitId: id,
              customerName: report.visit.customerName,
              customerPhone: report.visit.customerPhone,
              vehicleLabel: report.visit.vehicleLabel,
              reason: report.recommendations || "Плановое обслуживание",
              dueAt: report.nextVisitAt,
              sendAt,
            },
          });
          await tx.backgroundJob.create({
            data: {
              workshopId,
              reminderId: reminder.id,
              type: "SEND_REMINDER_SMS",
              payload: { reminderId: reminder.id },
              idempotencyKey: `reminder:${reminder.id}:sms`,
              runAfter: sendAt,
            },
          });
        }
        await tx.report.update({
          where: { id: report.id },
          data: { status: "PUBLISHED" as ReportStatus, publishedAt: new Date() },
        });
        await tx.visit.update({
          where: { id },
          data: { status: "COMPLETED", updatedAt: new Date(), serverVersion: { increment: 1 } },
        });
        await tx.auditEvent.create({
          data: {
            workshopId,
            actorUserId: userId,
            action: "REPORT_PUBLISHED",
            entityType: "visit",
            entityId: id,
            metadata: { reportId: report.id, reportVersionId: version.id, mediaCount: media.length },
          },
        });
        return { kind: "created" as const, version, link };
      });

      if (result.kind === "report_unavailable") return reply.code(409).send({ error: "report_not_draft" });
      if (result.kind === "completed_work_required") return reply.code(409).send({ error: "completed_work_required" });
      if (result.kind === "operation_conflict") return reply.code(409).send({ error: "operation_conflict" });
      return reply.code(result.kind === "created" ? 201 : 200).send({
        reportVersionId: result.version.id,
        token: body.token,
        publicPath: `/r/${body.token}`,
        expiresAt: result.link.expiresAt,
        reused: result.kind === "existing",
      });
    });

    app.delete("/v1/visits/:id/report-link", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const { workshopId, userId } = request.actor;
      const version = await prisma.reportVersion.findFirst({
        where: { visitId: id, workshopId },
        orderBy: { version: "desc" },
        include: { link: true },
      });
      if (!version?.link || version.link.revokedAt) return reply.code(404).send({ error: "not_found" });

      await prisma.$transaction(async (tx) => {
        await tx.reportLink.update({ where: { id: version.link!.id }, data: { revokedAt: new Date() } });
        await tx.report.update({ where: { id: version.reportId }, data: { status: "DRAFT", publishedAt: null } });
        await tx.visit.updateMany({
          where: { id, workshopId, status: "COMPLETED" },
          data: { status: "IN_REPAIR", updatedAt: new Date(), serverVersion: { increment: 1 } },
        });
        await tx.auditEvent.create({
          data: {
            workshopId,
            actorUserId: userId,
            action: "REPORT_LINK_REVOKED",
            entityType: "visit",
            entityId: id,
            metadata: { reportVersionId: version.id },
          },
        });
      });
      return reply.code(204).send();
    });
  };
}
