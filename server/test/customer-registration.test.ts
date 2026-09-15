import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";
import { hashOtpCode } from "../src/security/otp.js";

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
const workshopId = "11111111-1111-4111-8111-111111111111";
const challengeId = "33333333-3333-4333-8333-333333333333";
const customerId = "44444444-4444-4444-8444-444444444444";
const code = "123456";
const approvalToken = "approval_token_abcdefghijklmnopqrstuvwxyz012345";

describe("customer account registration", () => {
  it("requires and consumes an OTP bound to the approval-link phone", async () => {
    const approval = {
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      approvalVersion: {
        workshopId,
        visit: {
          id: "55555555-5555-4555-8555-555555555555",
          customerId: null,
          customerName: "Иван",
          customerPhone: "+79991234567",
        },
      },
    };
    const challenge = {
      id: challengeId,
      purpose: "CUSTOMER_REGISTRATION",
      phone: "+79991234567",
      codeHash: hashOtpCode(challengeId, code, config.OTP_HASH_SECRET!),
      requestIpHash: "unused",
      userId: null,
      workshopId,
      customerId: null,
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
      resendAfter: new Date(),
      consumedAt: null,
      createdAt: new Date(),
    };
    const consume = vi.fn().mockResolvedValue({ count: 1 });
    const createUser = vi.fn().mockResolvedValue({});
    const prisma = {
      approvalLink: { findUnique: vi.fn().mockResolvedValue(approval) },
      otpChallenge: { findUnique: vi.fn().mockResolvedValue(challenge), updateMany: vi.fn() },
      authSession: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (callback) => callback({
        otpChallenge: { updateMany: consume },
        customer: {
          upsert: vi.fn().mockResolvedValue({
            id: customerId,
            workshopId,
            name: "Иван",
            phone: "+79991234567",
            email: null,
            accountUserId: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        user: { findFirst: vi.fn().mockResolvedValue(null), create: createUser },
        visit: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      })),
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({
      method: "POST",
      url: "/public/v1/customer-accounts/register",
      payload: {
        approvalToken,
        challengeId,
        code,
        email: "ivan@example.com",
        password: "strong-password",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(consume).toHaveBeenCalledOnce();
    expect(createUser).toHaveBeenCalledOnce();
    expect(response.json()).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      customer: { id: customerId, phone: "+79991234567" },
    });
    await app.close();
  });
});
