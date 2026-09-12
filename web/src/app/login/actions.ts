"use server";

import {
  clearSession,
  createSessionToken,
  credentialsMatch,
  persistSession,
} from "@/lib/auth/session";
import { redirect } from "next/navigation";

export async function loginAction(formData: FormData): Promise<void> {
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (login.length > 128 || password.length > 256 || !credentialsMatch(login, password)) {
    redirect("/login?error=invalid_credentials");
  }

  const userId = process.env.AUTOSERVICE_USER_ID;
  const workshopId = process.env.AUTOSERVICE_WORKSHOP_ID;
  if (!userId || !workshopId) redirect("/login?error=not_configured");

  const token = createSessionToken({
    userId,
    workshopId,
    displayName: process.env.WEB_ADMIN_NAME || "Администратор",
    role: "ADMIN",
  });
  await persistSession(token);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}
