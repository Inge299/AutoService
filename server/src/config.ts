import { z } from "zod";

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  INTERNAL_API_KEY: z.string().min(32).optional(),
  ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
  OTP_HASH_SECRET: z.string().min(32).optional(),
  SMS_PROVIDER: z.enum(["disabled", "debug"]).default("disabled"),
  DATABASE_URL: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default("ru-central1"),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanFromString.default(false),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(environment);
  if (config.NODE_ENV === "production" && !config.INTERNAL_API_KEY) {
    throw new Error("INTERNAL_API_KEY must contain at least 32 characters in production");
  }
  if (config.NODE_ENV === "production" && !config.ACCESS_TOKEN_SECRET) {
    throw new Error("ACCESS_TOKEN_SECRET must contain at least 32 characters in production");
  }
  if (config.NODE_ENV === "production" && !config.OTP_HASH_SECRET) {
    throw new Error("OTP_HASH_SECRET must contain at least 32 characters in production");
  }
  if (config.NODE_ENV === "production" && config.SMS_PROVIDER === "debug") {
    throw new Error("SMS_PROVIDER=debug is forbidden in production");
  }
  return config;
}
