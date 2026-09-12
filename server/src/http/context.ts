import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const actorSchema = z.object({
  workshopId: z.string().uuid(),
  userId: z.string().uuid(),
});

declare module "fastify" {
  interface FastifyRequest {
    actor: z.infer<typeof actorSchema>;
  }
}

export function registerDevelopmentActorContext(
  app: FastifyInstance,
  prisma: PrismaClient,
  nodeEnv: string,
): void {
  if (nodeEnv === "production") {
    throw new Error("Production authentication is not implemented");
  }

  app.decorateRequest("actor");
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/")) return;

    const parsed = actorSchema.safeParse({
      workshopId: request.headers["x-workshop-id"],
      userId: request.headers["x-user-id"],
    });
    if (!parsed.success) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const membership = await prisma.membership.findUnique({
      where: {
        workshopId_userId: {
          workshopId: parsed.data.workshopId,
          userId: parsed.data.userId,
        },
      },
      select: { userId: true },
    });
    if (!membership) return reply.code(401).send({ error: "unauthorized" });
    request.actor = parsed.data;
  });
}
