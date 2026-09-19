import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ObjectStorage } from "../../infrastructure/object-storage.js";

const paramsSchema = z.object({ token: z.string().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/) });

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function unavailable(link: { expiresAt: Date; revokedAt: Date | null }): boolean {
  return Boolean(link.revokedAt) || link.expiresAt.getTime() <= Date.now();
}

export function publicReportRoutes(prisma: PrismaClient, storage: ObjectStorage): FastifyPluginAsync {
  return async (app) => {
    app.get("/public/v1/reports/:token", async (request, reply) => {
      const { token } = paramsSchema.parse(request.params);
      const link = await prisma.reportLink.findUnique({
        where: { tokenHash: tokenHash(token) },
        include: {
          reportVersion: {
            include: { workshop: { select: { name: true, phone: true } } },
          },
        },
      });
      if (!link) return reply.code(404).send({ error: "not_found" });
      if (unavailable(link)) return reply.code(410).send({ error: "link_unavailable" });
      if (!link.openedAt) {
        await prisma.reportLink.update({ where: { id: link.id }, data: { openedAt: new Date() } });
      }

      const version = link.reportVersion;
      const assets = version.mediaIds.length
        ? await prisma.mediaAsset.findMany({
          where: {
            id: { in: version.mediaIds }, workshopId: version.workshopId, visitId: version.visitId,
            state: { in: ["VERIFIED", "READY"] },
          },
          select: { id: true, kind: true, mimeType: true, objectKey: true, sha256: true, byteCount: true },
        })
        : [];
      if (assets.length !== version.mediaIds.length) return reply.code(410).send({ error: "report_media_unavailable" });
      const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
      const media = await Promise.all(version.mediaIds.map(async (mediaId) => {
        const asset = assetsById.get(mediaId);
        if (!asset) throw new Error("Report media snapshot is incomplete");
        const objectKey = await storage.seal(asset);
        if (objectKey !== asset.objectKey) await prisma.mediaAsset.update({ where: { id: asset.id }, data: { objectKey } });
        const target = await storage.createDownloadTarget(objectKey);
        return { id: asset.id, kind: asset.kind, mimeType: asset.mimeType, url: target.url, expiresInSeconds: target.expiresInSeconds };
      }));
      return reply.send({
        expiresAt: link.expiresAt,
        openedAt: link.openedAt ?? new Date(),
        workshop: version.workshop,
        visit: {
          customerName: version.customerName,
          vehicleLabel: version.vehicleLabel,
          licensePlate: version.licensePlate,
          mileageKm: version.mileageKm,
          complaint: version.complaint,
        },
        report: {
          completedWork: version.completedWork,
          recommendations: version.recommendations,
          nextVisitAt: version.nextVisitAt,
          findings: version.findings,
          media,
        },
      });
    });
  };
}
