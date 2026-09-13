import type { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";

export function workshopRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
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
