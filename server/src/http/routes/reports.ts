import { queueLegacyMedia } from "../../infrastructure/legacy-media.js";
import { customerVisibleStatus } from "../../domain/customer-visibility.js";
import { serializable } from "../../infrastructure/transaction.js";
import { createHash } from "node:crypto";
import type { PrismaClient, ReportStatus } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { reportRecommendations, futureWork } from "../../domain/report-recommendations.js";
import { scheduleWorkReminder } from "../../domain/follow-up-reminders.js";
import { cancelVisitReminders } from "../../domain/cancel-visit-reminders.js";
import { isPastVisitDate } from "../../domain/visit-date.js";

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
  acknowledgedPrivateFindingIds: z.array(z.string().uuid()).max(500).default([]),
  expectedMediaIds: z.array(z.string().uuid()).max(5000).optional(),
  recommendedPrivateFindingIds: z.array(z.string().uuid()).max(500).default([]),
});

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function reportRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get("/v1/report-features", async () => ({ explicitRecommendations: true }));
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

      const result = await serializable(prisma, async (tx) => {
        const visit = await tx.visit.findFirst({ where: { id, workshopId }, select: { id: true, status: true } });
        if (!visit) return { kind: "not_found" as const };
        const existing = await tx.report.findUnique({ where: { visitId: id } });
        if (existing?.status === "PUBLISHED") return { kind: "published" as const };
        if (["COMPLETED", "CANCELLED"].includes(visit.status)) return { kind: "closed" as const };
        if (isPastVisitDate(nextVisitAt)) return { kind: "past_date" as const };
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
      if (result.kind === "closed") return reply.code(409).send({ error: "visit_closed" });
      if (result.kind === "past_date") return reply.code(400).send({ error: "next_visit_date_in_past" });
      return reply.send(result.report);
    });

    // Recovery is read-only and cannot accidentally start a publication.
    app.post("/v1/visits/:id/report/recover", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const body = z.object({ operationId: z.string().uuid(), token: z.string().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/) }).parse(request.body);
      const version = await prisma.reportVersion.findUnique({ where: { operationId: body.operationId }, include: { link: true } });
      if (!version || version.workshopId !== request.actor.workshopId || version.visitId !== id || !version.link || version.link.tokenHash !== tokenHash(body.token)) {
        return reply.code(404).send({ error: "report_operation_not_found" });
      }
      if (version.link.revokedAt) return reply.code(409).send({ error: "report_link_revoked" });
      return { reportVersionId: version.id, token: body.token, publicPath: `/r/${body.token}`, expiresAt: version.link.expiresAt, reused: true };
    });

    app.post("/v1/visits/:id/report/publish", async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const body = publishSchema.parse(request.body);
      const { workshopId, userId } = request.actor;
      const expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 60 * 60_000);
      const hashedToken = tokenHash(body.token);

      const result = await serializable(prisma, async (tx) => {
        const existingVersion = await tx.reportVersion.findUnique({
          where: { operationId: body.operationId },
          include: { link: true },
        });
        if (existingVersion) {
          if (
            existingVersion.workshopId !== workshopId || existingVersion.visitId !== id ||
            !existingVersion.link || existingVersion.link.tokenHash !== hashedToken
          ) return { kind: "operation_conflict" as const };
          if (existingVersion.link.revokedAt) return { kind: "revoked" as const };
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
                status: true,
              },
            },
          },
        });
        if (!report) return { kind: "report_unavailable" as const };
        if (["COMPLETED", "CANCELLED"].includes(report.visit.status)) return { kind: "report_unavailable" as const };
        if (isPastVisitDate(report.nextVisitAt)) return { kind: "past_date" as const };
        const unanswered = await tx.finding.count({ where: { visitId: id, workshopId, status: "SENT_TO_CUSTOMER" } });
        if (unanswered > 0) return { kind: "pending_approvals" as const };
        if (!report.completedWork) return { kind: "completed_work_required" as const };

        const [previous, findings, media] = await Promise.all([
          tx.reportVersion.findFirst({ where: { reportId: report.id }, orderBy: { version: "desc" }, select: { version: true } }),
          tx.finding.findMany({
            where: { workshopId, visitId: id },
            orderBy: { createdAt: "asc" },
            select: { id: true, title: true, description: true, priceRub: true, priority: true, status: true,
              followUpDueAt: true, followUpConfigured: true, followUpState: true },
          }),
          tx.mediaAsset.findMany({
            where: { workshopId, visitId: id },
            orderBy: { createdAt: "asc" },
            select: { id: true, findingId: true, state: true, objectKey: true },
          }),
        ]);
        const visibleFindings = findings.filter(finding => customerVisibleStatus(finding.status));
        const privateIds = findings.filter(finding => !customerVisibleStatus(finding.status)).map(finding => finding.id).sort();
        const acknowledgedIds = [...new Set(body.acknowledgedPrivateFindingIds)].sort();
        if (privateIds.length !== acknowledgedIds.length || privateIds.some((id, index) => id !== acknowledgedIds[index])) {
          return { kind: "private_findings_changed" as const };
        }
        const recommendedIds = new Set(body.recommendedPrivateFindingIds);
        if ([...recommendedIds].some(id => !privateIds.includes(id)) || findings.some(finding =>
          recommendedIds.has(finding.id) && finding.followUpState !== "OPEN")) return { kind: "recommendations_changed" as const };
        const recommendedFindings = findings.filter(finding => recommendedIds.has(finding.id))
          .map(finding => ({ ...finding, status: "RECOMMENDED" as const }));
        if (!body.expectedMediaIds) return { kind: "report_client_update_required" as const };
        const visibleIds = new Set(visibleFindings.map(finding => finding.id));
        const relevantMedia = media.filter(asset => asset.findingId === null || visibleIds.has(asset.findingId));
        if (relevantMedia.some(asset => asset.state !== "VERIFIED" && asset.state !== "READY")) {
          return { kind: "report_media_pending" as const };
        }
        const preparation = await queueLegacyMedia(tx, workshopId, relevantMedia);
        if (preparation === "failed") return { kind: "report_media_failed" as const };
        if (preparation === "preparing") return { kind: "report_media_pending" as const };
        const serverMediaIds = relevantMedia.map(asset => asset.id).sort();
        const expectedMediaIds = [...new Set(body.expectedMediaIds)].sort();
        if (serverMediaIds.length !== expectedMediaIds.length || serverMediaIds.some((id, index) => id !== expectedMediaIds[index])) {
          return { kind: "report_media_changed" as const };
        }
        const readyMedia = media.filter(asset => asset.state === "VERIFIED" || asset.state === "READY");
        const reportableFindings = [...visibleFindings, ...recommendedFindings];
        const recommendations = reportRecommendations(report.recommendations, reportableFindings, report.nextVisitAt);
        const planned = futureWork(reportableFindings);
        if (planned.some(work => isPastVisitDate(work.followUpConfigured ? work.followUpDueAt ?? null : report.nextVisitAt))) {
          return { kind: "past_date" as const };
        }
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
            recommendations,
            nextVisitAt: report.nextVisitAt,
            findings: findings.map(finding => ({ ...finding, ...(recommendedIds.has(finding.id) ? { reportRecommendation: true } : {}), followUpDueAt: finding.followUpDueAt?.toISOString() ?? null })),
            mediaIds: readyMedia.map((asset) => asset.id),
            mediaManifest: readyMedia.map(asset => ({ id: asset.id, findingId: asset.findingId ?? null })),
          },
        });
        const link = await tx.reportLink.create({
          data: { reportVersionId: version.id, tokenHash: hashedToken, expiresAt },
        });
        await cancelVisitReminders(tx, workshopId, id, "Superseded by a new report version");
        const reminderVisit = { ...report.visit, id, workshopId };
        for (const work of planned) {
          const dueAt = work.followUpConfigured ? work.followUpDueAt ?? null : report.nextVisitAt;
          if (dueAt) await scheduleWorkReminder(tx, reminderVisit, version.id, work.id, `Необходимо выполнить: ${work.title}`, dueAt);
        }
        if (!planned.length && report.nextVisitAt) {
          await scheduleWorkReminder(tx, reminderVisit, version.id, null, recommendations || "Плановое обслуживание", report.nextVisitAt);
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
            metadata: { reportId: report.id, reportVersionId: version.id, mediaCount: readyMedia.length },
          },
        });
        return { kind: "created" as const, version, link };
      });

      if (result.kind === "report_client_update_required") return reply.code(409).send({ error: "report_client_update_required" });
      if (result.kind === "report_media_failed") return reply.code(409).send({ error: "report_media_failed" });
      if (result.kind === "report_media_pending") return reply.code(409).send({ error: "report_media_pending" });
      if (result.kind === "report_media_changed") return reply.code(409).send({ error: "report_media_changed" });
      if (result.kind === "recommendations_changed") return reply.code(409).send({ error: "recommendations_changed" });
      if (result.kind === "private_findings_changed") return reply.code(409).send({ error: "private_findings_changed" });
      if (result.kind === "pending_approvals") return reply.code(409).send({ error: "pending_approvals" });
      if (result.kind === "report_unavailable") return reply.code(409).send({ error: "report_not_draft" });
      if (result.kind === "completed_work_required") return reply.code(409).send({ error: "completed_work_required" });
      if (result.kind === "operation_conflict") return reply.code(409).send({ error: "operation_conflict" });
      if (result.kind === "revoked") return reply.code(409).send({ error: "report_link_revoked" });
      if (result.kind === "past_date") return reply.code(400).send({ error: "next_visit_date_in_past" });
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
      const revoked = await serializable(prisma, async (tx) => {
        const version = await tx.reportVersion.findFirst({
          where: { visitId: id, workshopId },
          orderBy: { version: "desc" },
          include: { link: true },
        });
        if (!version?.link || version.link.revokedAt) return false;
        await cancelVisitReminders(tx, workshopId, id, "Report link revoked");
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
        return true;
      });
      if (!revoked) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send();
    });
  };
}
