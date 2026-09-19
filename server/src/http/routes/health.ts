import type { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import type { ObjectStorage } from "../../infrastructure/object-storage.js";

export function healthRoutes(prisma: PrismaClient, storage: ObjectStorage): FastifyPluginAsync {
  return async (app) => {
    app.get("/health/live", async () => ({ status: "ok" }));
    app.get("/health/ready", async (_request, reply) => {
      await Promise.all([prisma.$queryRaw`SELECT 1`, storage.ready()]);
      return reply.send({ status: "ok" });
    });
  };
}
