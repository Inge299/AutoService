import type { PrismaClient } from "@prisma/client";
import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ObjectStorage } from "../../infrastructure/object-storage.js";

export interface RuntimeMetrics {
  startedAt: Date;
  httpResponsesTotal: number;
  httpResponses5xx: number;
}

function hasInternalKey(value: string | string[] | undefined, expected: string | undefined): boolean {
  if (!expected || typeof value !== "string") return false;
  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function countsByState(rows: Array<{ state: string; _count: { _all: number } }>): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.state, row._count._all]));
}

export function healthRoutes(
  prisma: PrismaClient,
  storage: ObjectStorage,
  internalApiKey?: string,
  runtimeMetrics?: () => RuntimeMetrics,
): FastifyPluginAsync {
  return async (app) => {
    app.get("/health/live", async () => ({ status: "ok" }));
    app.get("/health/ready", async (_request, reply) => {
      await Promise.all([prisma.$queryRaw`SELECT 1`, storage.ready()]);
      return reply.send({ status: "ok" });
    });
    app.get("/health/metrics", async (request, reply) => {
      if (!hasInternalKey(request.headers["x-internal-api-key"], internalApiKey)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const [jobs, media] = await Promise.all([
        prisma.backgroundJob.groupBy({ by: ["state"], _count: { _all: true } }),
        prisma.mediaAsset.groupBy({ by: ["state"], _count: { _all: true } }),
      ]);
      const runtime = runtimeMetrics?.() ?? {
        startedAt: new Date(),
        httpResponsesTotal: 0,
        httpResponses5xx: 0,
      };
      return {
        status: "ok",
        startedAt: runtime.startedAt.toISOString(),
        http: {
          responsesTotal: runtime.httpResponsesTotal,
          responses5xx: runtime.httpResponses5xx,
        },
        backgroundJobs: countsByState(jobs),
        media: countsByState(media),
      };
    });
  };
}
