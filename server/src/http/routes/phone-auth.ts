import { createHash, randomUUID } from "node:crypto";
import type { OtpPurpose, PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { VerificationDelivery } from "../../infrastructure/verification-delivery.js";
import { issueSession } from "../../security/auth-session.js";
import { createOtpCode, hashOtpCode, hashOtpKey, otpHashesEqual } from "../../security/otp.js";
import { normalizePhone } from "../../security/phone.js";

const requestSchema = z.discriminatedUnion("audience", [
  z.object({
    phone: z.string().min(8).max(32).transform(normalizePhone),
    audience: z.enum(["STAFF", "CUSTOMER"]),
  }),
  z.object({
    approvalToken: z.string().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/),
    audience: z.literal("CUSTOMER_REGISTRATION"),
  }),
]);
const verifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

const CODE_TTL_MS = 5 * 60_000;
const RESEND_DELAY_MS = 60_000;
const PHONE_WINDOW_MS = 60 * 60_000;
const IP_WINDOW_MS = 15 * 60_000;
const MAX_PER_PHONE = 5;
const MAX_PER_IP = 20;

function purpose(audience: "STAFF" | "CUSTOMER" | "CUSTOMER_REGISTRATION"): OtpPurpose {
  if (audience === "STAFF") return "STAFF_LOGIN";
  return audience === "CUSTOMER" ? "CUSTOMER_LOGIN" : "CUSTOMER_REGISTRATION";
}

export function phoneAuthRoutes(
  prisma: PrismaClient,
  accessTokenSecret: string | undefined,
  otpHashSecret: string | undefined,
  delivery: VerificationDelivery,
): FastifyPluginAsync {
  return async (app) => {
    app.post("/public/v1/auth/phone/request-code", async (request, reply) => {
      if (!accessTokenSecret || !otpHashSecret || !delivery.available) {
        return reply.code(503).send({ error: "phone_authentication_unavailable" });
      }
      const body = requestSchema.parse(request.body);
      const now = new Date();
      const otpPurpose = purpose(body.audience);
      const requestIpHash = hashOtpKey(request.ip, otpHashSecret);
      const registrationLink = body.audience === "CUSTOMER_REGISTRATION"
        ? await prisma.approvalLink.findUnique({
            where: { tokenHash: createHash("sha256").update(body.approvalToken).digest("hex") },
            select: {
              expiresAt: true,
              revokedAt: true,
              approvalVersion: {
                select: {
                  workshopId: true,
                  visit: { select: { customerId: true, customerPhone: true } },
                },
              },
            },
          })
        : null;
      if (
        body.audience === "CUSTOMER_REGISTRATION" &&
        (!registrationLink || registrationLink.revokedAt || registrationLink.expiresAt <= now)
      ) {
        return reply.code(410).send({ error: "approval_link_unavailable" });
      }
      const phone = body.audience === "CUSTOMER_REGISTRATION"
        ? normalizePhone(registrationLink!.approvalVersion.visit.customerPhone)
        : body.phone;
      const [latest, phoneRequests, ipRequests] = await Promise.all([
        prisma.otpChallenge.findFirst({
          where: { phone, purpose: otpPurpose },
          orderBy: { createdAt: "desc" },
          select: { resendAfter: true },
        }),
        prisma.otpChallenge.count({
          where: { phone, createdAt: { gte: new Date(now.getTime() - PHONE_WINDOW_MS) } },
        }),
        prisma.otpChallenge.count({
          where: { requestIpHash, createdAt: { gte: new Date(now.getTime() - IP_WINDOW_MS) } },
        }),
      ]);
      if (latest && latest.resendAfter > now) {
        return reply.code(429).send({
          error: "retry_later",
          retryAfterSeconds: Math.ceil((latest.resendAfter.getTime() - now.getTime()) / 1_000),
        });
      }
      if (phoneRequests >= MAX_PER_PHONE || ipRequests >= MAX_PER_IP) {
        return reply.code(429).send({ error: "too_many_attempts" });
      }

      const user = body.audience === "CUSTOMER_REGISTRATION" ? null : await prisma.user.findUnique({
        where: { phone },
        select: {
          id: true,
          isActive: true,
          memberships: {
            where: { isActive: true },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { workshopId: true },
          },
          customerProfiles: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { id: true, workshopId: true },
          },
        },
      });
      const staff = body.audience === "STAFF" ? user?.memberships[0] : undefined;
      const customer = body.audience === "CUSTOMER" ? user?.customerProfiles[0] : undefined;
      const registration = body.audience === "CUSTOMER_REGISTRATION" ? registrationLink : null;
      const recognized = Boolean(registration || (user?.isActive && (staff || customer)));
      const challengeId = randomUUID();
      const code = createOtpCode();
      const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
      const resendAfter = new Date(now.getTime() + RESEND_DELAY_MS);
      await prisma.otpChallenge.create({
        data: {
          id: challengeId,
          purpose: otpPurpose,
          phone,
          codeHash: hashOtpCode(challengeId, code, otpHashSecret),
          requestIpHash,
          expiresAt,
          resendAfter,
          ...(recognized && user ? { userId: user.id } : {}),
          ...(staff ? { workshopId: staff.workshopId } : {}),
          ...(customer ? { workshopId: customer.workshopId, customerId: customer.id } : {}),
          ...(registration ? {
            workshopId: registration.approvalVersion.workshopId,
            ...(registration.approvalVersion.visit.customerId
              ? { customerId: registration.approvalVersion.visit.customerId }
              : {}),
          } : {}),
        },
      });

      if (recognized) {
        try {
          await delivery.sendCode({
            challengeId,
            phone,
            code,
            expiresInSeconds: CODE_TTL_MS / 1_000,
          });
        } catch (error) {
          await prisma.otpChallenge.update({ where: { id: challengeId }, data: { expiresAt: now } });
          request.log.error({ err: error, challengeId }, "OTP delivery failed");
          return reply.code(502).send({ error: "verification_delivery_failed" });
        }
      }

      return reply.code(202).send({
        challengeId,
        expiresInSeconds: CODE_TTL_MS / 1_000,
        resendAfterEpochMs: resendAfter.getTime(),
      });
    });

    app.post("/public/v1/auth/phone/verify-code", async (request, reply) => {
      if (!accessTokenSecret || !otpHashSecret) {
        return reply.code(503).send({ error: "phone_authentication_unavailable" });
      }
      const body = verifySchema.parse(request.body);
      const now = new Date();
      const challenge = await prisma.otpChallenge.findUnique({ where: { id: body.challengeId } });
      const valid = challenge && !challenge.consumedAt && challenge.expiresAt > now &&
        challenge.attempts < challenge.maxAttempts &&
        challenge.purpose !== "CUSTOMER_REGISTRATION" &&
        otpHashesEqual(challenge.codeHash, hashOtpCode(challenge.id, body.code, otpHashSecret));
      if (!valid || !challenge?.userId || !challenge.workshopId) {
        if (challenge && !challenge.consumedAt && challenge.expiresAt > now) {
          await prisma.otpChallenge.updateMany({
            where: { id: challenge.id, consumedAt: null, attempts: { lt: challenge.maxAttempts } },
            data: { attempts: { increment: 1 } },
          });
        }
        return reply.code(401).send({ error: "invalid_or_expired_code" });
      }

      const tokens = await prisma.$transaction(async (tx) => {
        const consumed = await tx.otpChallenge.updateMany({
          where: {
            id: challenge.id,
            consumedAt: null,
            attempts: { lt: challenge.maxAttempts },
            expiresAt: { gt: now },
          },
          data: { consumedAt: now },
        });
        if (consumed.count !== 1) return null;
        return issueSession(tx, {
          userId: challenge.userId!,
          workshopId: challenge.workshopId!,
          scope: challenge.purpose === "STAFF_LOGIN" ? "STAFF" : "CUSTOMER",
          ...(challenge.customerId ? { customerId: challenge.customerId } : {}),
        }, accessTokenSecret, now);
      });
      if (!tokens) return reply.code(401).send({ error: "invalid_or_expired_code" });
      return reply.send({ ...tokens, expiresAtEpochMs: tokens.accessTokenExpiresAtEpochMs });
    });
  };
}
