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
    actor: z.infer<typeof actorSchema> & { role: MembershipRole; sessionId?: string };
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
  accessTokenSecret?: string,
): void {
  if (nodeEnv === "production" && (!internalApiKey || !accessTokenSecret)) {
    throw new Error("Production authentication requires dedicated internal and access-token secrets");
  }

  app.decorateRequest("actor");
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/")) return;

    if (request.method === "POST" && request.url.split("?", 1)[0] === "/v1/auth/login") return;

    const authorization = request.headers.authorization;
    const bearerActor = accessTokenSecret && authorization?.startsWith("Bearer ")
      ? verifyAccessToken(authorization.slice("Bearer ".length), accessTokenSecret)
      : null;

    const staffBearerActor = bearerActor?.scope === "STAFF" ? bearerActor : null;
    if (authorization?.startsWith("Bearer ") && !staffBearerActor) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (!staffBearerActor && internalApiKey) {
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
    if (staffBearerActor) {
      const session = await prisma.authSession.findUnique({
        where: { id: staffBearerActor.sessionId },
        select: {
          userId: true,
          workshopId: true,
          scope: true,
          customerId: true,
          expiresAt: true,
          revokedAt: true,
        },
      });
      if (
        !session || session.revokedAt || session.expiresAt <= new Date() ||
        session.scope !== "STAFF" || session.customerId ||
        session.userId !== staffBearerActor.userId ||
        session.workshopId !== staffBearerActor.workshopId
      ) {
        return reply.code(401).send({ error: "session_expired" });
      }
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
    request.actor = {
      ...parsed.data,
      role: membership.role,
      ...(staffBearerActor ? { sessionId: staffBearerActor.sessionId } : {}),
    };
  });
}

export const registerDevelopmentActorContext = registerActorContext;
