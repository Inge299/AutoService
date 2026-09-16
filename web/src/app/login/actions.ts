"use server";

import {
  clearSession,
  createSessionToken,
  getSession,
  persistSession,
} from "@/lib/auth/session";
import {
  AutoServiceApiError,
  authenticateApiUser,
  getApiSessionWithAccessToken,
  logoutStaffSession,
  requestPhoneCode,
  verifyPhoneCall,
  verifyPhoneCode,
} from "@/lib/api/autoservice-api";
import { clientForwardedFor } from "@/lib/auth/client-address";
import { redirect } from "next/navigation";

export async function loginAction(formData: FormData): Promise<void> {
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (login.length > 128 || password.length > 256) {
    redirect("/staff/login?error=invalid_credentials");
  }

  let identity;
  try {
    identity = await authenticateApiUser(login, password, await clientForwardedFor());
  } catch (error) {
    if (error instanceof AutoServiceApiError && error.status === 429) {
      redirect("/staff/login?error=too_many_attempts");
    }
    redirect("/staff/login?error=server_unavailable");
  }
  if (!identity) redirect("/staff/login?error=invalid_credentials");

  const token = createSessionToken(identity);
  await persistSession(token, identity.refreshTokenExpiresAtEpochMs);
  redirect("/dashboard");
}

export async function requestStaffCodeAction(formData: FormData): Promise<void> {
  const phone = String(formData.get("phone") ?? "").trim();
  if (phone.length < 8 || phone.length > 32) redirect("/staff/login?mode=sms&error=invalid_phone");
  let challenge;
  try {
    challenge = await requestPhoneCode({ audience: "STAFF", phone }, await clientForwardedFor());
  } catch (error) {
    if (error instanceof AutoServiceApiError && error.status === 429) {
      redirect("/staff/login?mode=sms&error=too_many_attempts");
    }
    redirect("/staff/login?mode=sms&error=sms_unavailable");
  }
  if (challenge.verification.method === "CALLCHECK") {
    const params = new URLSearchParams({
      mode: "call",
      challenge: challenge.challengeId,
      callPhone: challenge.verification.callPhone,
      callPhonePretty: challenge.verification.callPhonePretty,
    });
    redirect(`/staff/login?${params}`);
  }
  redirect(`/staff/login?mode=code&challenge=${encodeURIComponent(challenge.challengeId)}`);
}

export async function verifyStaffCallAction(formData: FormData): Promise<void> {
  const challengeId = String(formData.get("challenge") ?? "");
  const callPhone = String(formData.get("callPhone") ?? "");
  const callPhonePretty = String(formData.get("callPhonePretty") ?? "");
  const state = new URLSearchParams({ mode: "call", challenge: challengeId, callPhone, callPhonePretty });
  if (!challengeId) redirect(`/staff/login?${state}&error=invalid_code`);
  try {
    const result = await verifyPhoneCall(challengeId);
    if (!("accessToken" in result)) {
      redirect(`/staff/login?${state}&error=${result.status === "pending" ? "call_pending" : "invalid_code"}`);
    }
    const identity = await getApiSessionWithAccessToken(result.accessToken);
    const session = {
      ...result,
      userId: identity.id,
      workshopId: identity.workshopId,
      displayName: identity.displayName,
      role: identity.role,
    };
    await persistSession(createSessionToken(session), result.refreshTokenExpiresAtEpochMs);
  } catch {
    redirect(`/staff/login?${state}&error=invalid_code`);
  }
  redirect("/dashboard");
}

export async function verifyStaffCodeAction(formData: FormData): Promise<void> {
  const challengeId = String(formData.get("challenge") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  if (!challengeId || !/^\d{6}$/.test(code)) {
    redirect(`/staff/login?mode=code&challenge=${encodeURIComponent(challengeId)}&error=invalid_code`);
  }
  try {
    const tokens = await verifyPhoneCode(challengeId, code);
    const identity = await getApiSessionWithAccessToken(tokens.accessToken);
    const session = {
      ...tokens,
      userId: identity.id,
      workshopId: identity.workshopId,
      displayName: identity.displayName,
      role: identity.role,
    };
    await persistSession(createSessionToken(session), tokens.refreshTokenExpiresAtEpochMs);
  } catch {
    redirect(`/staff/login?mode=code&challenge=${encodeURIComponent(challengeId)}&error=invalid_code`);
  }
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const session = await getSession();
  try {
    if (session) await logoutStaffSession(session);
  } finally {
    await clearSession();
  }
  redirect("/staff/login");
}
