"use server";

import {
  clearSession,
  createSessionToken,
  persistSession,
} from "@/lib/auth/session";
import { authenticateApiUser } from "@/lib/api/autoservice-api";
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
  await persistSession(token);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}
