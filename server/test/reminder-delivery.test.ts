import { describe, expect, it, vi } from "vitest";
import { SmsRuReminderDelivery } from "../src/infrastructure/reminder-delivery.js";

describe("SMS.RU reminder delivery", () => {
  it("sends provider-safe form data and returns only the provider message id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sms: { "79991234567": { status: "OK", status_code: 100, sms_id: "message-1" } },
    }), { status: 200 }));
    const delivery = new SmsRuReminderDelivery("test-api-id-123456", "AutoService", fetchImpl);

    const result = await delivery.send({ phone: "+79991234567", text: "Текст напоминания" });

    expect(result).toEqual({ providerMessageId: "message-1" });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect((init.body as URLSearchParams).get("msg")).toBe("Текст напоминания");
  });

  it("maps provider delivery status without storing the SMS body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sms: { "message-1": { status: "OK", status_code: 103 } },
    }), { status: 200 }));
    const delivery = new SmsRuReminderDelivery("test-api-id-123456", undefined, fetchImpl);

    await expect(delivery.status("message-1")).resolves.toBe("DELIVERED");
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("/sms/status?");
  });
});
