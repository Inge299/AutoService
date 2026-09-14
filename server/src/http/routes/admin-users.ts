import { randomUUID } from "node:crypto";
import { Prisma, type MembershipRole, type PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { hashPassword } from "../../security/password.js";

const loginPattern = /^[\p{L}\p{N}._@-]+$/u;
const paramsSchema = z.object({ userId: z.string().uuid() });
const createSchema = z.object({
  login: z.string().trim().min(3).max(64).regex(loginPattern).transform((value) => value.toLocaleLowerCase("ru-RU")),
  displayName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(32).optional().transform((value) => value || null),
  password: z.string().min(8).max(256),
  role: z.enum(["ADMIN", "EMPLOYEE"]).default("EMPLOYEE"),
});
const stateSchema = z.object({ isActive: z.boolean() });
const roleSchema = z.object({ role: z.enum(["ADMIN", "EMPLOYEE"]) });
const passwordSchema = z.object({ password: z.string().min(8).max(256) });

function requireAdmin(request: FastifyRequest, reply: { code(status: number): { send(payload: unknown): unknown } }) {
  if (request.actor.role !== "ADMIN") {
    reply.code(403).send({ error: "admin_required" });
    return false;
  }
  return true;
}

async function ensureAnotherAdmin(prisma: PrismaClient, workshopId: string, userId: string): Promise<boolean> {
  return (await prisma.membership.count({
    where: {
      workshopId,
      role: "ADMIN",
      isActive: true,
      userId: { not: userId },
      user: { isActive: true },
    },
  })) > 0;
}

function conflictCode(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");
  return target.includes("login") ? "login_taken" : target.includes("phone") ? "phone_taken" : "duplicate_user";
}

export function adminUserRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get("/v1/admin/users", async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const memberships = await prisma.membership.findMany({
        where: { workshopId: request.actor.workshopId },
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          isActive: true,
          createdAt: true,
          user: { select: { id: true, login: true, displayName: true, phone: true, isActive: true } },
        },
      });
      return memberships.map((membership) => ({
        id: membership.user.id,
        login: membership.user.login,
        displayName: membership.user.displayName,
        phone: membership.user.phone,
        role: membership.role,
        isActive: membership.isActive && membership.user.isActive,
        createdAt: membership.createdAt,
        isCurrent: membership.user.id === request.actor.userId,
      }));
    });

    app.post("/v1/admin/users", async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const body = createSchema.parse(request.body);
      try {
        const passwordHash = await hashPassword(body.password);
        const user = await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              id: randomUUID(),
              login: body.login,
              displayName: body.displayName,
              phone: body.phone,
              passwordHash,
            },
          });
          await tx.membership.create({
            data: {
              workshopId: request.actor.workshopId,
              userId: created.id,
              role: body.role as MembershipRole,
            },
          });
          await tx.auditEvent.create({
            data: {
              workshopId: request.actor.workshopId,
              actorUserId: request.actor.userId,
              action: "USER_CREATED",
              entityType: "user",
              entityId: created.id,
              metadata: { role: body.role },
            },
          });
          return created;
        });
        return reply.code(201).send({ id: user.id });
      } catch (error) {
        const code = conflictCode(error);
        if (code) return reply.code(409).send({ error: code });
        throw error;
      }
    });

    app.patch("/v1/admin/users/:userId/state", async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { userId } = paramsSchema.parse(request.params);
      const body = stateSchema.parse(request.body);
      if (userId === request.actor.userId && !body.isActive) {
        return reply.code(409).send({ error: "cannot_disable_self" });
      }
      const membership = await prisma.membership.findUnique({
        where: { workshopId_userId: { workshopId: request.actor.workshopId, userId } },
      });
      if (!membership) return reply.code(404).send({ error: "not_found" });
      if (!body.isActive && membership.role === "ADMIN" && !await ensureAnotherAdmin(prisma, request.actor.workshopId, userId)) {
        return reply.code(409).send({ error: "last_admin" });
      }
      await prisma.$transaction([
        prisma.membership.update({
          where: { workshopId_userId: { workshopId: request.actor.workshopId, userId } },
          data: { isActive: body.isActive },
        }),
        prisma.auditEvent.create({
          data: {
            workshopId: request.actor.workshopId,
            actorUserId: request.actor.userId,
            action: body.isActive ? "USER_ENABLED" : "USER_DISABLED",
            entityType: "user",
            entityId: userId,
          },
        }),
      ]);
      return { id: userId, isActive: body.isActive };
    });

    app.patch("/v1/admin/users/:userId/role", async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { userId } = paramsSchema.parse(request.params);
      const body = roleSchema.parse(request.body);
      if (userId === request.actor.userId && body.role !== "ADMIN") {
        return reply.code(409).send({ error: "cannot_demote_self" });
      }
      const membership = await prisma.membership.findUnique({
        where: { workshopId_userId: { workshopId: request.actor.workshopId, userId } },
      });
      if (!membership) return reply.code(404).send({ error: "not_found" });
      if (membership.role === "ADMIN" && body.role !== "ADMIN" && !await ensureAnotherAdmin(prisma, request.actor.workshopId, userId)) {
        return reply.code(409).send({ error: "last_admin" });
      }
      await prisma.membership.update({
        where: { workshopId_userId: { workshopId: request.actor.workshopId, userId } },
        data: { role: body.role as MembershipRole },
      });
      await prisma.auditEvent.create({
        data: {
          workshopId: request.actor.workshopId,
          actorUserId: request.actor.userId,
          action: "USER_ROLE_CHANGED",
          entityType: "user",
          entityId: userId,
          metadata: { role: body.role },
        },
      });
      return { id: userId, role: body.role };
    });

    app.post("/v1/admin/users/:userId/password", async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { userId } = paramsSchema.parse(request.params);
      const body = passwordSchema.parse(request.body);
      const membership = await prisma.membership.findUnique({
        where: { workshopId_userId: { workshopId: request.actor.workshopId, userId } },
        select: { userId: true },
      });
      if (!membership) return reply.code(404).send({ error: "not_found" });
      await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(body.password) } }),
        prisma.auditEvent.create({
          data: {
            workshopId: request.actor.workshopId,
            actorUserId: request.actor.userId,
            action: "USER_PASSWORD_RESET",
            entityType: "user",
            entityId: userId,
          },
        }),
      ]);
      return { id: userId };
    });
  };
}
