"use server";

import { redirect } from "next/navigation";
import {
  clearCustomerSession,
  createCustomerSessionToken,
  getCustomerSession,
  persistCustomerSession,
  type BackendTokens,
} from "@/lib/auth/session";
import {
  AutoServiceApiError,
  getCustomerPortalWithAccessToken,
  loginCustomerAccount,
  logoutCustomerSession,
  registerCustomerAccount,
  requestPhoneCode,
  verifyPhoneCode,
} from "@/lib/api/autoservice-api";
import { clientForwardedFor } from "@/lib/auth/client-address";

function errorPath(path: string, code: string, values: Record<string, string | undefined> = {}): never {
  const params = new URLSearchParams({ error: code });
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  redirect(`${path}?${params}`);
}

async function persistCustomer(tokens: BackendTokens, customerId: string, displayName: string): Promise<void> {
  const token = createCustomerSessionToken({ ...tokens, customerId, displayName });
  await persistCustomerSession(token, tokens.refreshTokenExpiresAtEpochMs);
}

export async function requestCustomerRegistrationCodeAction(formData: FormData): Promise<void> {
  const approval = String(formData.get("approval") ?? "");
  if (!approval) errorPath("/customer/register", "invalid_data");
  let challenge;
  try {
    challenge = await requestPhoneCode(
      { audience: "CUSTOMER_REGISTRATION", approvalToken: approval },
      await clientForwardedFor(),
    );
  } catch (error) {
    if (error instanceof AutoServiceApiError && error.status === 429) {
      errorPath("/customer/register", "too_many_attempts", { approval });
    }
    errorPath("/customer/register", "sms_unavailable", { approval });
  }
  redirect(`/customer/register?approval=${encodeURIComponent(approval)}&challenge=${encodeURIComponent(challenge.challengeId)}`);
}

export async function registerCustomerAction(formData: FormData): Promise<void> {
  const approval = String(formData.get("approval") ?? "");
  const challenge = String(formData.get("challenge") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const state = { approval, challenge };
  if (!approval || !challenge || !/^\d{6}$/.test(code) || !email || password.length < 8) {
    errorPath("/customer/register", "invalid_data", state);
  }
  try {
    const identity = await registerCustomerAccount(approval, challenge, code, email, password);
    await persistCustomer(identity, identity.customer.id, identity.customer.name);
  } catch (error) {
    if (error instanceof AutoServiceApiError && error.status === 409) {
      errorPath("/customer/login", "account_exists", { approval });
    }
    if (error instanceof AutoServiceApiError && error.status === 401) {
      errorPath("/customer/register", "invalid_code", state);
    }
    errorPath("/customer/register", "registration_failed", state);
  }
  redirect(`/cabinet?approval=${encodeURIComponent(approval)}`);
}

export async function loginCustomerAction(formData: FormData): Promise<void> {
  const identityValue = String(formData.get("identity") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const approval = String(formData.get("approval") ?? "");
  if (!identityValue || !password) errorPath("/customer/login", "invalid_credentials", { approval });
  try {
    const identity = await loginCustomerAccount(identityValue, password);
    await persistCustomer(identity, identity.customer.id, identity.customer.name);
  } catch {
    errorPath("/customer/login", "invalid_credentials", { approval });
  }
  redirect(approval ? `/cabinet?approval=${encodeURIComponent(approval)}` : "/cabinet");
}

export async function requestCustomerLoginCodeAction(formData: FormData): Promise<void> {
  const phone = String(formData.get("phone") ?? "").trim();
  const approval = String(formData.get("approval") ?? "");
  if (phone.length < 8 || phone.length > 32) {
    errorPath("/customer/login", "invalid_phone", { approval, mode: "sms" });
  }
  let challenge;
  try {
    challenge = await requestPhoneCode({ audience: "CUSTOMER", phone }, await clientForwardedFor());
  } catch (error) {
    if (error instanceof AutoServiceApiError && error.status === 429) {
      errorPath("/customer/login", "too_many_attempts", { approval, mode: "sms" });
    }
    errorPath("/customer/login", "sms_unavailable", { approval, mode: "sms" });
  }
  const params = new URLSearchParams({ mode: "code", challenge: challenge.challengeId });
  if (approval) params.set("approval", approval);
  redirect(`/customer/login?${params}`);
}

export async function verifyCustomerLoginCodeAction(formData: FormData): Promise<void> {
  const challenge = String(formData.get("challenge") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const approval = String(formData.get("approval") ?? "");
  const state = { approval, mode: "code", challenge };
  if (!challenge || !/^\d{6}$/.test(code)) errorPath("/customer/login", "invalid_code", state);
  try {
    const tokens = await verifyPhoneCode(challenge, code);
    const portal = await getCustomerPortalWithAccessToken(tokens.accessToken);
    if (!portal) errorPath("/customer/login", "invalid_code", state);
    await persistCustomer(tokens, portal.customer.id, portal.customer.name);
  } catch {
    errorPath("/customer/login", "invalid_code", state);
  }
  redirect(approval ? `/cabinet?approval=${encodeURIComponent(approval)}` : "/cabinet");
}

export async function logoutCustomerAction(): Promise<void> {
  const session = await getCustomerSession();
  try {
    if (session) await logoutCustomerSession(session);
  } finally {
    await clearCustomerSession();
  }
  redirect("/customer/login");
}
