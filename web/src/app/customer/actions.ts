"use server";

import { redirect } from "next/navigation";
import { createCustomerSessionToken, persistCustomerSession } from "@/lib/auth/session";
import { AutoServiceApiError, loginCustomerAccount, registerCustomerAccount } from "@/lib/api/autoservice-api";

function errorPath(path: string, code: string, approval?: string): never {
  const params = new URLSearchParams({ error: code });
  if (approval) params.set("approval", approval);
  redirect(`${path}?${params}`);
}

export async function registerCustomerAction(formData: FormData): Promise<void> {
  const approval = String(formData.get("approval") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!approval || !email || password.length < 8) errorPath("/customer/register", "invalid_data", approval);
  try {
    const identity = await registerCustomerAccount(approval, email, password);
    await persistCustomerSession(createCustomerSessionToken({
      accessToken: identity.accessToken,
      customerId: identity.customer.id,
      displayName: identity.customer.name,
    }));
  } catch (error) {
    if (error instanceof AutoServiceApiError && error.status === 409) errorPath("/customer/login", "account_exists", approval);
    errorPath("/customer/register", "registration_failed", approval);
  }
  redirect(`/cabinet?approval=${encodeURIComponent(approval)}`);
}

export async function loginCustomerAction(formData: FormData): Promise<void> {
  const identityValue = String(formData.get("identity") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const approval = String(formData.get("approval") ?? "");
  if (!identityValue || !password) errorPath("/customer/login", "invalid_credentials", approval);
  try {
    const identity = await loginCustomerAccount(identityValue, password);
    await persistCustomerSession(createCustomerSessionToken({
      accessToken: identity.accessToken,
      customerId: identity.customer.id,
      displayName: identity.customer.name,
    }));
  } catch {
    errorPath("/customer/login", "invalid_credentials", approval);
  }
  redirect(approval ? `/cabinet?approval=${encodeURIComponent(approval)}` : "/cabinet");
}
