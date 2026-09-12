import type { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";

export function healthRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get("/health/live", async () => ({ status: "ok" }));
    app.get("/health/ready", async (_request, reply) => {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: "ok" });
    });
  };
}
