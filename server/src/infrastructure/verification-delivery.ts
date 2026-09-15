import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";

export interface VerificationMessage {
  challengeId: string;
  phone: string;
  code: string;
  expiresInSeconds: number;
}

export interface VerificationDelivery {
  readonly available: boolean;
  sendCode(message: VerificationMessage): Promise<void>;
}

type Fetch = typeof fetch;

const smsRuResponseSchema = z.object({
  status: z.string(),
  status_code: z.number(),
  sms: z.record(z.string(), z.object({
    status: z.string(),
    status_code: z.number(),
    sms_id: z.string().optional(),
    status_text: z.string().optional(),
  })).optional(),
});

export const disabledVerificationDelivery: VerificationDelivery = {
  available: false,
  async sendCode() {
    throw new Error("SMS delivery is disabled");
  },
};

export function debugVerificationDelivery(logger: FastifyBaseLogger): VerificationDelivery {
  return {
    available: true,
    async sendCode(message) {
      logger.warn(
        { challengeId: message.challengeId, phone: message.phone, code: message.code },
        "Development-only OTP code",
      );
    },
  };
}

export class SmsRuVerificationDelivery implements VerificationDelivery {
  readonly available = true;

  constructor(
    private readonly apiId: string,
    private readonly sender?: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async sendCode(message: VerificationMessage): Promise<void> {
    const phone = message.phone.replace(/^\+/, "");
    const form = new URLSearchParams({
      api_id: this.apiId,
      to: phone,
      msg: `Код AutoService: ${message.code}. Действует ${Math.ceil(message.expiresInSeconds / 60)} мин.`,
      json: "1",
      ttl: String(Math.max(1, Math.ceil(message.expiresInSeconds / 60))),
      ...(this.sender ? { from: this.sender } : {}),
    });
    const response = await this.fetchImpl("https://sms.ru/sms/send", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`SMS.RU HTTP ${response.status}`);

    const parsed = smsRuResponseSchema.safeParse(await response.json());
    const result = parsed.success ? parsed.data.sms?.[phone] : undefined;
    if (!parsed.success || parsed.data.status_code !== 100 || result?.status_code !== 100) {
      const statusCode = parsed.success ? result?.status_code ?? parsed.data.status_code : "invalid_response";
      throw new Error(`SMS.RU rejected verification message: ${statusCode}`);
    }
  }
}

export function createVerificationDelivery(config: Config, logger: FastifyBaseLogger): VerificationDelivery {
  if (config.SMS_PROVIDER === "debug") return debugVerificationDelivery(logger);
  if (config.SMS_PROVIDER === "smsru" && config.SMS_RU_API_ID) {
    return new SmsRuVerificationDelivery(config.SMS_RU_API_ID, config.SMS_RU_FROM);
  }
  return disabledVerificationDelivery;
}
