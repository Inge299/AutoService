import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { ObjectStorage } from "../src/infrastructure/object-storage.js";

const config: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 8080,
  LOG_LEVEL: "silent",
  SMS_PROVIDER: "disabled",
  DATABASE_URL: "postgresql://unused",
  S3_ENDPOINT: "https://storage.example.test",
  S3_REGION: "ru-central1",
  S3_BUCKET: "test-bucket",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  S3_FORCE_PATH_STYLE: true,
  WORKER_POLL_INTERVAL_MS: 100,
};

describe("ObjectStorage upload targets", () => {
  it("does not duplicate hoisted S3 metadata in Android request headers", async () => {
    const sha256 = "a".repeat(64);
    const target = await new ObjectStorage(config).createUploadTarget({
      objectKey: "workshops/test/asset",
      mimeType: "audio/mp4",
      byteCount: 4,
      sha256,
    });

    const url = new URL(target.url);
    expect(target.headers).toEqual({ "content-type": "audio/mp4", "content-length": "4" });
    expect(url.searchParams.get("x-amz-meta-sha256")).toBe(sha256);
  });
});
