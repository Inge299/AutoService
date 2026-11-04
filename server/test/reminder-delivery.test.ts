import { describe, expect, it, vi } from "vitest";
import { SmsRuReminderDelivery } from "../src/infrastructure/reminder-delivery.js";

describe("SMS.RU reminder delivery", () => {
  it.each([204, 207, 220])("preserves recipient rejection code %s", async (code) => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({
      status: "OK", status_code: 100,
      sms: { "79991234567": { status: "ERROR", status_code: code, status_text: "Provider details" } },
    }));
    const delivery = new SmsRuReminderDelivery("test-api-id-123456", undefined, fetchImpl);
    await expect(delivery.send({ phone: "+79991234567", text: "Test" })).rejects.toThrow(`SMS.RU rejected reminder: ${code}`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["send", "status"] as const)("preserves top-level authentication failure in %s", async (method) => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ status: "ERROR", status_code: 200 }));
    const delivery = new SmsRuReminderDelivery("test-api-id-123456", undefined, fetchImpl);
    const result = method === "send" ? delivery.send({ phone: "+79991234567", text: "Test" }) : delivery.status("message-1");
    await expect(result).rejects.toThrow(method === "send" ? "SMS.RU rejected reminder: 200" : "SMS.RU status unavailable: 200");
  });

  it("does not discard a successful recipient because another recipient failed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ status: "OK", status_code: 100, sms: {
      "79991234567": { status: "OK", status_code: 100, sms_id: "message-1" },
      "79990000000": { status: "ERROR", status_code: 207 },
    } }));
    const delivery = new SmsRuReminderDelivery("test-api-id-123456", undefined, fetchImpl);
    await expect(delivery.send({ phone: "+79991234567", text: "Test" })).resolves.toEqual({ providerMessageId: "message-1" });
  });

  it("keeps malformed provider responses distinct from known rejection codes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ status: "unexpected" }));
    const delivery = new SmsRuReminderDelivery("test-api-id-123456", undefined, fetchImpl);
    await expect(delivery.send({ phone: "+79991234567", text: "Test" })).rejects.toThrow("SMS.RU rejected reminder: invalid_response");
  });

  it("preserves a delivery-status rejection code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ status: "OK", status_code: 100, sms: {
      "message-1": { status: "ERROR", status_code: 201 },
    } }));
    const delivery = new SmsRuReminderDelivery("test-api-id-123456", undefined, fetchImpl);
    await expect(delivery.status("message-1")).rejects.toThrow("SMS.RU status unavailable: 201");
  });

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
