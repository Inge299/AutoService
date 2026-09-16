import { describe, expect, it, vi } from "vitest";
import { SmsRuCallCheckVerificationDelivery, SmsRuVerificationDelivery } from "../src/infrastructure/verification-delivery.js";

const message = {
  challengeId: "33333333-3333-4333-8333-333333333333",
  phone: "+79991234567",
  code: "123456",
  expiresInSeconds: 300,
};

describe("SMS.RU verification delivery", () => {
  it("sends OTP credentials in a form body and validates the per-phone status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "OK",
      status_code: 100,
      sms: {
        "79991234567": { status: "OK", status_code: 100, sms_id: "message-1" },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const delivery = new SmsRuVerificationDelivery(
      "api-id-12345678901234567890",
      "AutoService",
      fetchMock as unknown as typeof fetch,
    );

    await delivery.sendCode(message);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://sms.ru/sms/send");
    const form = init!.body as URLSearchParams;
    expect(form.get("api_id")).toBe("api-id-12345678901234567890");
    expect(form.get("to")).toBe("79991234567");
    expect(form.get("msg")).toContain("123456");
    expect(form.get("from")).toBe("AutoService");
  });

  it("starts and checks an incoming call without an SMS sender", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "OK",
        status_code: 100,
        check_id: "check-1",
        call_phone: "78005008275",
        call_phone_pretty: "+7 (800) 500-8275",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "OK",
        status_code: 100,
        check_status: "401",
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const delivery = new SmsRuCallCheckVerificationDelivery(
      "api-id-12345678901234567890",
      fetchMock as unknown as typeof fetch,
    );

    const started = await delivery.start({ ...message, requestIp: "198.51.100.12" });
    expect(started).toMatchObject({ method: "CALLCHECK", providerCheckId: "check-1", callPhone: "78005008275" });
    expect(await delivery.checkCall("check-1")).toBe("CONFIRMED");

    const firstForm = fetchMock.mock.calls[0]![1]!.body as URLSearchParams;
    expect(fetchMock.mock.calls[0]![0]).toBe("https://sms.ru/callcheck/add");
    expect(firstForm.get("phone")).toBe("79991234567");
    expect(firstForm.get("ip")).toBe("198.51.100.12");
    expect(fetchMock.mock.calls[1]![0]).toBe("https://sms.ru/callcheck/status");
  });

  it("fails closed when SMS.RU rejects the recipient", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "OK",
      status_code: 100,
      sms: {
        "79991234567": { status: "ERROR", status_code: 207, status_text: "rejected" },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const delivery = new SmsRuVerificationDelivery(
      "api-id-12345678901234567890",
      undefined,
      fetchMock as unknown as typeof fetch,
    );

    await expect(delivery.sendCode(message)).rejects.toThrow("207");
  });
});
