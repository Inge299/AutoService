import type { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { issueSession, revokeSession, rotateSession } from "../../security/auth-session.js";
import { verifyPassword } from "../../security/password.js";

const loginSchema = z.object({
  login: z.string().trim().min(1).max(128).transform((value) => value.toLocaleLowerCase("ru-RU")),
  password: z.string().min(1).max(256),
});
const refreshSchema = z.object({ refreshToken: z.string().min(40).max(256) });

const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;

function canAttempt(address: string): boolean {
  const now = Date.now();
  const current = attempts.get(address);
  if (!current || current.resetAt <= now) {
    attempts.set(address, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_ATTEMPTS;
}

export function authRoutes(prisma: PrismaClient, accessTokenSecret?: string): FastifyPluginAsync {
  return async (app) => {
    app.post("/v1/auth/login", async (request, reply) => {
      if (!canAttempt(request.ip)) {
        return reply.code(429).send({ error: "too_many_attempts" });
      }

      const body = loginSchema.parse(request.body);
      const user = await prisma.user.findUnique({
        where: { login: body.login },
        select: {
          id: true,
          displayName: true,
          isActive: true,
          passwordHash: true,
          memberships: {
            where: { isActive: true },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { workshopId: true, role: true },
          },
        },
      });

      const valid = user?.isActive && user.passwordHash
        ? await verifyPassword(body.password, user.passwordHash)
        : false;
      const membership = user?.memberships[0];
      if (!valid || !user || !membership) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }

      attempts.delete(request.ip);
      const session = {
        userId: user.id,
        workshopId: membership.workshopId,
        displayName: user.displayName,
        role: membership.role,
      };
      if (!accessTokenSecret) return session;

      const tokens = await issueSession(prisma, {
        userId: session.userId,
        workshopId: session.workshopId,
        scope: "STAFF",
      }, accessTokenSecret);
      return {
        ...session,
        ...tokens,
        expiresAtEpochMs: tokens.accessTokenExpiresAtEpochMs,
      };
    });

    app.post("/public/v1/auth/refresh", async (request, reply) => {
      if (!accessTokenSecret) return reply.code(503).send({ error: "authentication_unavailable" });
      const body = refreshSchema.parse(request.body);
      const tokens = await rotateSession(prisma, body.refreshToken, accessTokenSecret);
      if (!tokens) return reply.code(401).send({ error: "invalid_refresh_token" });
      return reply.send({ ...tokens, expiresAtEpochMs: tokens.accessTokenExpiresAtEpochMs });
    });

    app.post("/v1/auth/logout", async (request, reply) => {
      if (request.actor.sessionId) await revokeSession(prisma, request.actor.sessionId);
      return reply.code(204).send();
    });

    app.get("/v1/session", async (request) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: request.actor.userId },
        select: { id: true, login: true, displayName: true },
      });
      return { ...user, workshopId: request.actor.workshopId, role: request.actor.role };
    });
  };
}
