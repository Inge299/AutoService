import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { createAccessToken, verifyAccessToken } from "../../security/access-token.js";
import { hashPassword, verifyPassword } from "../../security/password.js";

const approvalTokenSchema = z.string().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/);
const registerSchema = z.object({
  approvalToken: approvalTokenSchema,
  email: z.string().trim().email().max(254).transform((value) => value.toLocaleLowerCase("ru-RU")),
  password: z.string().min(8).max(256),
});
const loginSchema = z.object({
  identity: z.string().trim().min(3).max(254),
  password: z.string().min(8).max(256),
});

interface CustomerActor {
  userId: string;
  workshopId: string;
  customerId: string;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function accessDenied(reply: { code(status: number): { send(payload: unknown): unknown } }) {
  return reply.code(401).send({ error: "customer_unauthorized" });
}

async function customerActor(
  request: FastifyRequest,
  reply: { code(status: number): { send(payload: unknown): unknown } },
  prisma: PrismaClient,
  secret?: string,
): Promise<CustomerActor | null> {
  const authorization = request.headers.authorization;
  const parsed = secret && authorization?.startsWith("Bearer ")
    ? verifyAccessToken(authorization.slice("Bearer ".length), secret)
    : null;
  if (!parsed || parsed.scope !== "CUSTOMER" || !parsed.customerId) {
    accessDenied(reply);
    return null;
  }
  const customer = await prisma.customer.findFirst({
    where: {
      id: parsed.customerId,
      workshopId: parsed.workshopId,
      accountUserId: parsed.userId,
      accountUser: { isActive: true },
    },
    select: { id: true },
  });
  if (!customer) {
    accessDenied(reply);
    return null;
  }
  return { userId: parsed.userId, workshopId: parsed.workshopId, customerId: parsed.customerId };
}

function unavailable(link: { expiresAt: Date; revokedAt: Date | null }): boolean {
  return Boolean(link.revokedAt) || link.expiresAt.getTime() <= Date.now();
}

export function customerAccountRoutes(prisma: PrismaClient, secret?: string): FastifyPluginAsync {
  return async (app) => {
    app.post("/public/v1/customer-accounts/register", async (request, reply) => {
      if (!secret) return reply.code(503).send({ error: "customer_accounts_unavailable" });
      const body = registerSchema.parse(request.body);
      const link = await prisma.approvalLink.findUnique({
        where: { tokenHash: tokenHash(body.approvalToken) },
        include: {
          approvalVersion: {
            select: {
              workshopId: true,
              visit: { select: { id: true, customerId: true, customerName: true, customerPhone: true } },
            },
          },
        },
      });
      if (!link || unavailable(link)) return reply.code(410).send({ error: "approval_link_unavailable" });

      const visit = link.approvalVersion.visit;
      const registration = await prisma.$transaction(async (tx) => {
        const customer = visit.customerId
          ? await tx.customer.findUnique({ where: { id: visit.customerId } })
          : await tx.customer.upsert({
              where: { workshopId_phone: { workshopId: link.approvalVersion.workshopId, phone: visit.customerPhone } },
              update: { name: visit.customerName },
              create: {
                id: randomUUID(),
                workshopId: link.approvalVersion.workshopId,
                name: visit.customerName,
                phone: visit.customerPhone,
              },
            });
        if (!customer) throw new Error("Customer linked to approval was not found");
        if (customer.accountUserId) return { state: "claimed" as const };

        const duplicate = await tx.user.findFirst({
          where: { OR: [{ phone: customer.phone }, { email: body.email }] },
          select: { id: true },
        });
        if (duplicate) return { state: "identity_taken" as const };

        const userId = randomUUID();
        await tx.user.create({
          data: {
            id: userId,
            phone: customer.phone,
            email: body.email,
            displayName: customer.name,
            passwordHash: await hashPassword(body.password),
          },
        });
        await tx.customer.update({
          where: { id: customer.id },
          data: { accountUserId: userId, email: body.email },
        });
        await tx.visit.updateMany({
          where: {
            workshopId: link.approvalVersion.workshopId,
            customerId: null,
            customerPhone: customer.phone,
          },
          data: { customerId: customer.id },
        });
        return { state: "created" as const, customerId: customer.id, userId, customer };
      });
      if (registration.state === "claimed") return reply.code(409).send({ error: "account_already_registered" });
      if (registration.state === "identity_taken") return reply.code(409).send({ error: "identity_taken" });

      const access = createAccessToken({
        userId: registration.userId,
        workshopId: link.approvalVersion.workshopId,
        scope: "CUSTOMER",
        customerId: registration.customerId,
      }, secret);
      return reply.code(201).send({
        accessToken: access.token,
        expiresAtEpochMs: access.expiresAt,
        customer: { id: registration.customerId, name: registration.customer.name, phone: registration.customer.phone, email: body.email },
      });
    });

    app.post("/public/v1/customer-accounts/login", async (request, reply) => {
      if (!secret) return reply.code(503).send({ error: "customer_accounts_unavailable" });
      const body = loginSchema.parse(request.body);
      const identity = body.identity.toLocaleLowerCase("ru-RU");
      const user = await prisma.user.findFirst({
        where: { OR: [{ email: identity }, { phone: body.identity }] },
        include: { customerProfiles: { select: { id: true, workshopId: true, name: true, phone: true, email: true } } },
      });
      const valid = user?.isActive && user.passwordHash ? await verifyPassword(body.password, user.passwordHash) : false;
      const customer = user?.customerProfiles[0];
      if (!valid || !customer) return reply.code(401).send({ error: "invalid_credentials" });

      const access = createAccessToken({
        userId: user.id,
        workshopId: customer.workshopId,
        scope: "CUSTOMER",
        customerId: customer.id,
      }, secret);
      return reply.send({
        accessToken: access.token,
        expiresAtEpochMs: access.expiresAt,
        customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email },
      });
    });

    app.get("/public/v1/customer-accounts/me", async (request, reply) => {
      const actor = await customerActor(request, reply, prisma, secret);
      if (!actor) return;
      const customer = await prisma.customer.findUnique({
        where: { id: actor.customerId },
        include: {
          workshop: { select: { name: true, phone: true } },
          vehicles: { orderBy: { updatedAt: "desc" }, select: { id: true, label: true, licensePlate: true, updatedAt: true } },
        },
      });
      if (!customer) return accessDenied(reply);
      const visits = await prisma.visit.findMany({
        where: {
          workshopId: actor.workshopId,
          OR: [{ customerId: customer.id }, { customerId: null, customerPhone: customer.phone }],
        },
        orderBy: { updatedAt: "desc" },
        include: { findings: { orderBy: { createdAt: "asc" }, select: { id: true, title: true, description: true, priceRub: true, priority: true, status: true, createdAt: true } }, _count: { select: { media: true } } },
      });
      return {
        customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email },
        workshop: customer.workshop,
        vehicles: customer.vehicles,
        visits,
      };
    });
  };
}
