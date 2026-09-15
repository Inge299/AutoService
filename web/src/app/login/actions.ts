"use server";

import {
  clearSession,
  createSessionToken,
  getSession,
  persistSession,
} from "@/lib/auth/session";
import {
  authenticateApiUser,
  getApiSessionWithAccessToken,
  logoutStaffSession,
  requestPhoneCode,
  verifyPhoneCode,
} from "@/lib/api/autoservice-api";
import { redirect } from "next/navigation";

export async function loginAction(formData: FormData): Promise<void> {
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (login.length > 128 || password.length > 256) {
    redirect("/login?error=invalid_credentials");
  }

  let identity;
  try {
    identity = await authenticateApiUser(login, password);
  } catch {
    redirect("/login?error=server_unavailable");
  }
  if (!identity) redirect("/login?error=invalid_credentials");

  const token = createSessionToken(identity);
  await persistSession(token, identity.refreshTokenExpiresAtEpochMs);
  redirect("/dashboard");
}

export async function requestStaffCodeAction(formData: FormData): Promise<void> {
  const phone = String(formData.get("phone") ?? "").trim();
  if (phone.length < 8 || phone.length > 32) redirect("/login?mode=sms&error=invalid_phone");
  let challenge;
  try {
    challenge = await requestPhoneCode({ audience: "STAFF", phone });
  } catch {
    redirect("/login?mode=sms&error=sms_unavailable");
  }
  redirect(`/login?mode=code&challenge=${encodeURIComponent(challenge.challengeId)}`);
}

export async function verifyStaffCodeAction(formData: FormData): Promise<void> {
  const challengeId = String(formData.get("challenge") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  if (!challengeId || !/^\d{6}$/.test(code)) {
    redirect(`/login?mode=code&challenge=${encodeURIComponent(challengeId)}&error=invalid_code`);
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
    redirect(`/login?mode=code&challenge=${encodeURIComponent(challengeId)}&error=invalid_code`);
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
  redirect("/login");
}
