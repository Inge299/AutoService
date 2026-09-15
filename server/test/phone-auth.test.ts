import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";
import type { VerificationMessage } from "../src/infrastructure/verification-delivery.js";

const config: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 8080,
  LOG_LEVEL: "silent",
  SMS_PROVIDER: "disabled",
  ACCESS_TOKEN_SECRET: "a".repeat(32),
  OTP_HASH_SECRET: "o".repeat(32),
  DATABASE_URL: "postgresql://unused",
  S3_REGION: "ru-central1",
  S3_BUCKET: "test-bucket",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  S3_FORCE_PATH_STYLE: true,
  WORKER_POLL_INTERVAL_MS: 100,
};
const userId = "22222222-2222-4222-8222-222222222222";
const workshopId = "11111111-1111-4111-8111-111111111111";

function otpPrisma(user: unknown) {
  const stored: { challenge?: Record<string, unknown> } = {};
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(user) },
    approvalLink: { findUnique: vi.fn().mockResolvedValue(null) },
    otpChallenge: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async ({ data }) => { stored.challenge = { ...data }; return data; }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(async () => stored.challenge ? {
        ...stored.challenge,
        attempts: 0,
        maxAttempts: 5,
        consumedAt: null,
      } : null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    authSession: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (callback) => callback({
      otpChallenge: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      authSession: { create: vi.fn().mockResolvedValue({}) },
    })),
  };
  return { prisma: prisma as unknown as PrismaClient, stored, raw: prisma };
}

describe("phone authentication", () => {
  it("normalizes a staff phone, sends a six-digit code and consumes it into a session", async () => {
    const database = otpPrisma({
      id: userId,
      isActive: true,
      memberships: [{ workshopId }],
      customerProfiles: [],
    });
    let delivered: VerificationMessage | undefined;
    const app = await buildApp(config, {
      prisma: database.prisma,
      storage: {} as ObjectStorage,
      verificationDelivery: {
        available: true,
        async sendCode(message) { delivered = message; },
      },
    });

    const requested = await app.inject({
      method: "POST",
      url: "/public/v1/auth/phone/request-code",
      payload: { phone: "8 (999) 123-45-67", audience: "STAFF" },
    });
    expect(requested.statusCode).toBe(202);
    expect(delivered).toMatchObject({ phone: "+79991234567", code: expect.stringMatching(/^\d{6}$/) });

    const verified = await app.inject({
      method: "POST",
      url: "/public/v1/auth/phone/verify-code",
      payload: { challengeId: requested.json().challengeId, code: delivered!.code },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    await app.close();
  });

  it("does not reveal an unknown phone and does not send a message", async () => {
    const database = otpPrisma(null);
    const sendCode = vi.fn();
    const app = await buildApp(config, {
      prisma: database.prisma,
      storage: {} as ObjectStorage,
      verificationDelivery: { available: true, sendCode },
    });

    const response = await app.inject({
      method: "POST",
      url: "/public/v1/auth/phone/request-code",
      payload: { phone: "+79990000000", audience: "CUSTOMER" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().challengeId).toEqual(expect.any(String));
    expect(sendCode).not.toHaveBeenCalled();
    await app.close();
  });

  it("sends a registration code only to the phone bound to the approval link", async () => {
    const database = otpPrisma(null);
    database.raw.approvalLink.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      approvalVersion: {
        workshopId,
        visit: { customerId: null, customerPhone: "8 999 123-45-67" },
      },
    });
    let delivered: VerificationMessage | undefined;
    const app = await buildApp(config, {
      prisma: database.prisma,
      storage: {} as ObjectStorage,
      verificationDelivery: { available: true, async sendCode(message) { delivered = message; } },
    });

    const response = await app.inject({
      method: "POST",
      url: "/public/v1/auth/phone/request-code",
      payload: {
        approvalToken: "approval_token_abcdefghijklmnopqrstuvwxyz012345",
        audience: "CUSTOMER_REGISTRATION",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(delivered?.phone).toBe("+79991234567");
    expect(database.raw.user.findUnique).not.toHaveBeenCalled();
    await app.close();
  });

  it("increments the persistent attempt counter for a wrong code", async () => {
    const database = otpPrisma({
      id: userId,
      isActive: true,
      memberships: [{ workshopId }],
      customerProfiles: [],
    });
    let delivered: VerificationMessage | undefined;
    const app = await buildApp(config, {
      prisma: database.prisma,
      storage: {} as ObjectStorage,
      verificationDelivery: { available: true, async sendCode(message) { delivered = message; } },
    });
    const requested = await app.inject({
      method: "POST",
      url: "/public/v1/auth/phone/request-code",
      payload: { phone: "+79991234567", audience: "STAFF" },
    });
    const wrongCode = delivered!.code === "000000" ? "000001" : "000000";

    const response = await app.inject({
      method: "POST",
      url: "/public/v1/auth/phone/verify-code",
      payload: { challengeId: requested.json().challengeId, code: wrongCode },
    });

    expect(response.statusCode).toBe(401);
    expect(database.raw.otpChallenge.updateMany).toHaveBeenCalledOnce();
    await app.close();
  });
});
