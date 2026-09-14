import type { MembershipRole, PrismaClient } from "@prisma/client";
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyAccessToken } from "../security/access-token.js";

const actorSchema = z.object({
  workshopId: z.string().uuid(),
  userId: z.string().uuid(),
});

declare module "fastify" {
  interface FastifyRequest {
    actor: z.infer<typeof actorSchema> & { role: MembershipRole };
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function registerActorContext(
  app: FastifyInstance,
  prisma: PrismaClient,
  nodeEnv: string,
  internalApiKey?: string,
): void {
  if (nodeEnv === "production" && !internalApiKey) {
    throw new Error("Production authentication requires INTERNAL_API_KEY");
  }

  app.decorateRequest("actor");
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/")) return;

    if (request.method === "POST" && request.url.split("?", 1)[0] === "/v1/auth/login") return;

    const authorization = request.headers.authorization;
    const bearerActor = internalApiKey && authorization?.startsWith("Bearer ")
      ? verifyAccessToken(authorization.slice("Bearer ".length), internalApiKey)
      : null;

    const staffBearerActor = bearerActor?.scope === "STAFF" ? bearerActor : null;
    if (internalApiKey && !staffBearerActor) {
      const suppliedKey = request.headers["x-internal-api-key"];
      if (typeof suppliedKey !== "string" || !safeEqual(suppliedKey, internalApiKey)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    }

    const parsed = actorSchema.safeParse(staffBearerActor ?? {
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
      select: {
        role: true,
        isActive: true,
        user: { select: { isActive: true } },
      },
    });
    if (!membership?.isActive || !membership.user.isActive) {
      return reply.code(403).send({ error: "access_revoked" });
    }
    request.actor = { ...parsed.data, role: membership.role };
  });
}

export const registerDevelopmentActorContext = registerActorContext;
