import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";
import type { PrismaClient } from "@prisma/client";

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

describe("request observability", () => {
  it("returns a generated correlation ID without reflecting an inbound token", async () => {
    const app = await buildApp(config, {
      prisma: { $queryRaw: vi.fn() } as unknown as PrismaClient,
      storage: {} as ObjectStorage,
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/health/live",
        headers: { "x-request-id": "untrusted-client-value" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-request-id"]).toBe("req-1");
    } finally {
      await app.close();
    }
  });
});
