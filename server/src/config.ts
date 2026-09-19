import { z } from "zod";

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");
const emptyToUndefined = (value: unknown) => value === "" ? undefined : value;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  INTERNAL_API_KEY: z.string().min(32).optional(),
  ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
  OTP_HASH_SECRET: z.string().min(32).optional(),
  SMS_PROVIDER: z.enum(["disabled", "debug", "smsru"]).default("disabled"),
  SMS_RU_API_ID: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  SMS_RU_FROM: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(32).optional()),
  SMS_RU_VERIFICATION_MODE: z.enum(["callcheck", "sms"]).default("callcheck"),
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

type ParsedConfig = z.infer<typeof schema>;
// Legacy tests and embedders construct Config directly. The parser always supplies
// this value; keeping it optional here avoids breaking those callers during rollout.
export type Config = Omit<ParsedConfig, "SMS_RU_VERIFICATION_MODE"> & {
  SMS_RU_VERIFICATION_MODE?: ParsedConfig["SMS_RU_VERIFICATION_MODE"];
};

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
  if (config.NODE_ENV === "production" && !config.S3_PUBLIC_ENDPOINT) {
    throw new Error("S3_PUBLIC_ENDPOINT is required in production for Android media uploads");
  }
  if (config.NODE_ENV === "production" && config.S3_PUBLIC_ENDPOINT && !config.S3_PUBLIC_ENDPOINT.startsWith("https://")) {
    throw new Error("S3_PUBLIC_ENDPOINT must use HTTPS in production");
  }
  if (config.SMS_PROVIDER === "smsru" && !config.SMS_RU_API_ID) {
    throw new Error("SMS_RU_API_ID is required when SMS_PROVIDER=smsru");
  }
  return config;
}
