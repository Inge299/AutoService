import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";

export interface VerificationMessage {
  challengeId: string;
  phone: string;
  code: string;
  expiresInSeconds: number;
  requestIp?: string;
}

export type VerificationStart =
  | { method: "SMS" }
  | { method: "CALLCHECK"; providerCheckId: string; callPhone: string; callPhonePretty: string };

export type CallCheckState = "PENDING" | "CONFIRMED" | "EXPIRED";

export interface VerificationDelivery {
  readonly available: boolean;
  start?(message: VerificationMessage): Promise<VerificationStart>;
  /** @deprecated Compatibility hook for existing delivery adapters. */
  sendCode?(message: VerificationMessage): Promise<void>;
  checkCall?(providerCheckId: string): Promise<CallCheckState>;
}

export async function startVerification(
  delivery: VerificationDelivery,
  message: VerificationMessage,
): Promise<VerificationStart> {
  if (delivery.start) return delivery.start(message);
  if (delivery.sendCode) {
    await delivery.sendCode(message);
    return { method: "SMS" };
  }
  throw new Error("Verification delivery is not configured");
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

const smsRuCallCheckStartSchema = z.object({
  status_code: z.number(),
  check_id: z.string().min(1).optional(),
  call_phone: z.string().min(3).optional(),
  call_phone_pretty: z.string().min(3).optional(),
  call_number: z.string().min(3).optional(),
  call_number_pretty: z.string().min(3).optional(),
});

const smsRuCallCheckStatusSchema = z.object({
  status_code: z.number(),
  check_status: z.union([z.string(), z.number()]).optional(),
});

export const disabledVerificationDelivery: VerificationDelivery = {
  available: false,
  async start() {
    throw new Error("SMS delivery is disabled");
  },
};

export function debugVerificationDelivery(logger: FastifyBaseLogger): VerificationDelivery {
  return {
    available: true,
    async start(message) {
      logger.warn(
        { challengeId: message.challengeId, phone: message.phone, code: message.code },
        "Development-only OTP code",
      );
      return { method: "SMS" };
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

  async start(message: VerificationMessage): Promise<VerificationStart> {
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
    return { method: "SMS" };
  }

  async sendCode(message: VerificationMessage): Promise<void> {
    await this.start(message);
  }
}

export class SmsRuCallCheckVerificationDelivery implements VerificationDelivery {
  readonly available = true;

  constructor(
    private readonly apiId: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async start(message: VerificationMessage): Promise<VerificationStart> {
    const form = new URLSearchParams({
      api_id: this.apiId,
      phone: message.phone.replace(/^\+/, ""),
      json: "1",
      ...(message.requestIp ? { ip: message.requestIp } : {}),
    });
    const response = await this.fetchImpl("https://sms.ru/callcheck/add", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`SMS.RU HTTP ${response.status}`);
    const parsed = smsRuCallCheckStartSchema.safeParse(await response.json());
    const callPhone = parsed.success ? parsed.data.call_phone ?? parsed.data.call_number : undefined;
    if (!parsed.success || parsed.data.status_code !== 100 || !parsed.data.check_id || !callPhone) {
      const statusCode = parsed.success ? parsed.data.status_code : "invalid_response";
      throw new Error(`SMS.RU rejected call verification: ${statusCode}`);
    }
    return {
      method: "CALLCHECK",
      providerCheckId: parsed.data.check_id,
      callPhone,
      callPhonePretty: parsed.data.call_phone_pretty ?? parsed.data.call_number_pretty ?? callPhone,
    };
  }

  async checkCall(providerCheckId: string): Promise<CallCheckState> {
    const form = new URLSearchParams({ api_id: this.apiId, check_id: providerCheckId, json: "1" });
    const response = await this.fetchImpl("https://sms.ru/callcheck/status", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`SMS.RU HTTP ${response.status}`);
    const parsed = smsRuCallCheckStatusSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.status_code !== 100) {
      const statusCode = parsed.success ? parsed.data.status_code : "invalid_response";
      throw new Error(`SMS.RU rejected call verification status: ${statusCode}`);
    }
    if (String(parsed.data.check_status) === "401") return "CONFIRMED";
    if (String(parsed.data.check_status) === "402") return "EXPIRED";
    return "PENDING";
  }
}

export function createVerificationDelivery(config: Config, logger: FastifyBaseLogger): VerificationDelivery {
  if (config.SMS_PROVIDER === "debug") return debugVerificationDelivery(logger);
  if (config.SMS_PROVIDER === "smsru" && config.SMS_RU_API_ID) {
    if ((config.SMS_RU_VERIFICATION_MODE ?? "callcheck") === "callcheck") {
      return new SmsRuCallCheckVerificationDelivery(config.SMS_RU_API_ID);
    }
    return new SmsRuVerificationDelivery(config.SMS_RU_API_ID, config.SMS_RU_FROM);
  }
  return disabledVerificationDelivery;
}
