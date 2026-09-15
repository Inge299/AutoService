import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";

const config: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 8080,
  LOG_LEVEL: "silent",
  SMS_PROVIDER: "disabled",
  DATABASE_URL: "postgresql://unused",
  S3_REGION: "ru-central1",
  S3_BUCKET: "test-bucket",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  S3_FORCE_PATH_STYLE: true,
  WORKER_POLL_INTERVAL_MS: 100,
};

describe("health", () => {
  it("returns liveness without external dependencies", async () => {
    const app = await buildApp(config, {
      prisma: {} as PrismaClient,
      storage: {} as ObjectStorage,
    });
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("protects application routes", async () => {
    const app = await buildApp(config, {
      prisma: {} as PrismaClient,
      storage: {} as ObjectStorage,
    });
    const response = await app.inject({
      method: "PUT",
      url: "/v1/visits/11111111-1111-4111-8111-111111111111",
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
    await app.close();
  });

  it("uses the client address supplied by the single production proxy hop", async () => {
    const app = await buildApp({
      ...config,
      NODE_ENV: "production",
      INTERNAL_API_KEY: "i".repeat(32),
      ACCESS_TOKEN_SECRET: "a".repeat(32),
      OTP_HASH_SECRET: "o".repeat(32),
    }, {
      prisma: {} as PrismaClient,
      storage: {} as ObjectStorage,
    });
    app.get("/_test/client-ip", async (request) => ({ ip: request.ip }));
    const response = await app.inject({
      method: "GET",
      url: "/_test/client-ip",
      headers: { "x-forwarded-for": "203.0.113.42" },
    });
    expect(response.json()).toEqual({ ip: "203.0.113.42" });
    await app.close();
  });
});
