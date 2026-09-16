import { z } from "zod";
import type { Config } from "../config.js";

const smsRuResponseSchema = z.object({
  status: z.literal("OK").optional(),
  status_code: z.number().optional(),
  sms: z.record(z.string(), z.object({
    status: z.literal("OK").optional(),
    status_code: z.number().optional(),
    sms_id: z.string().optional(),
  })).optional(),
});
const smsRuStatusSchema = z.object({
  status: z.literal("OK").optional(),
  status_code: z.number().optional(),
  sms: z.record(z.string(), z.object({
    status: z.literal("OK").optional(),
    status_code: z.number().optional(),
  })).optional(),
});

export interface ReminderDelivery {
  send(message: { phone: string; text: string }): Promise<{ providerMessageId: string | null }>;
  status(providerMessageId: string): Promise<"PENDING" | "DELIVERED" | "FAILED">;
}

class UnavailableReminderDelivery implements ReminderDelivery {
  async send(): Promise<{ providerMessageId: string | null }> {
    throw new Error("SMS reminder delivery is disabled");
  }

  async status(): Promise<"PENDING" | "DELIVERED" | "FAILED"> {
    throw new Error("SMS reminder delivery is disabled");
  }
}

export class SmsRuReminderDelivery implements ReminderDelivery {
  constructor(
    private readonly apiId: string,
    private readonly sender: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: { phone: string; text: string }): Promise<{ providerMessageId: string | null }> {
    const phone = message.phone.replace(/^\+/, "");
    const form = new URLSearchParams({ api_id: this.apiId, to: phone, msg: message.text, json: "1" });
    if (this.sender) form.set("from", this.sender);
    const response = await this.fetchImpl("https://sms.ru/sms/send", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!response.ok) throw new Error(`SMS.RU HTTP ${response.status}`);
    const parsed = smsRuResponseSchema.safeParse(await response.json());
    const result = parsed.success ? parsed.data.sms?.[phone] : undefined;
    if (!result || result.status !== "OK" || result.status_code !== 100) {
      throw new Error(`SMS.RU rejected reminder: ${result?.status_code ?? "invalid_response"}`);
    }
    return { providerMessageId: result.sms_id ?? null };
  }

  async status(providerMessageId: string): Promise<"PENDING" | "DELIVERED" | "FAILED"> {
    const query = new URLSearchParams({ api_id: this.apiId, sms_id: providerMessageId, json: "1" });
    const response = await this.fetchImpl(`https://sms.ru/sms/status?${query.toString()}`);
    if (!response.ok) throw new Error(`SMS.RU HTTP ${response.status}`);
    const parsed = smsRuStatusSchema.safeParse(await response.json());
    const result = parsed.success ? parsed.data.sms?.[providerMessageId] : undefined;
    if (!result || result.status !== "OK" || result.status_code === undefined) {
      throw new Error(`SMS.RU status unavailable: ${result?.status_code ?? "invalid_response"}`);
    }
    if (result.status_code === 103) return "DELIVERED";
    if (result.status_code >= 104 || result.status_code < 0) return "FAILED";
    return "PENDING";
  }
}

export function createReminderDelivery(config: Config): ReminderDelivery {
  if (config.SMS_PROVIDER === "smsru" && config.SMS_RU_API_ID) {
    return new SmsRuReminderDelivery(config.SMS_RU_API_ID, config.SMS_RU_FROM);
  }
  return new UnavailableReminderDelivery();
}
