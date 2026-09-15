import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://unused",
    S3_BUCKET: "test-bucket",
    S3_ACCESS_KEY_ID: "test",
    S3_SECRET_ACCESS_KEY: "test",
    SMS_PROVIDER: "disabled",
    ...overrides,
  };
}

describe("authentication configuration", () => {
  it("treats empty optional SMS.RU compose values as absent", () => {
    const config = loadConfig(environment({ SMS_RU_API_ID: "", SMS_RU_FROM: "" }));
    expect(config.SMS_RU_API_ID).toBeUndefined();
    expect(config.SMS_RU_FROM).toBeUndefined();
  });

  it("requires an API id when SMS.RU is enabled", () => {
    expect(() => loadConfig(environment({ SMS_PROVIDER: "smsru" }))).toThrow("SMS_RU_API_ID");
  });

  it("forbids debug delivery in production", () => {
    expect(() => loadConfig(environment({
      NODE_ENV: "production",
      INTERNAL_API_KEY: "i".repeat(32),
      ACCESS_TOKEN_SECRET: "a".repeat(32),
      OTP_HASH_SECRET: "o".repeat(32),
      SMS_PROVIDER: "debug",
    }))).toThrow("forbidden in production");
  });
});
