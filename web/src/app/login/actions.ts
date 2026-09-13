"use server";

import {
  authenticateCredentials,
  clearSession,
  createSessionToken,
  persistSession,
} from "@/lib/auth/session";
import { redirect } from "next/navigation";

export async function loginAction(formData: FormData): Promise<void> {
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (login.length > 128 || password.length > 256) {
    redirect("/login?error=invalid_credentials");
  }

  const identity = authenticateCredentials(login, password);
  if (!identity) redirect("/login?error=invalid_credentials");

  const token = createSessionToken(identity);
  await persistSession(token);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}
