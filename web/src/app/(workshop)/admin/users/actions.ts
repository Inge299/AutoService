"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AutoServiceApiError,
  createApiAdminUser,
  getApiSession,
  resetApiAdminUserPassword,
  setApiAdminUserRole,
  setApiAdminUserState,
} from "@/lib/api/autoservice-api";
import { requireSession, type WebSession } from "@/lib/auth/session";

async function requireAdmin(): Promise<WebSession> {
  const session = await requireSession();
  const current = await getApiSession(session);
  if (current.role !== "ADMIN") redirect("/dashboard");
  return { ...session, displayName: current.displayName, role: current.role };
}

function fail(error: unknown): never {
  const message = error instanceof AutoServiceApiError ? error.message : "";
  if (message.includes("login_taken")) redirect("/admin/users?error=login_taken");
  if (message.includes("phone_taken")) redirect("/admin/users?error=phone_taken");
  if (message.includes("cannot_disable_self")) redirect("/admin/users?error=cannot_disable_self");
  if (message.includes("cannot_demote_self")) redirect("/admin/users?error=cannot_demote_self");
  if (message.includes("last_admin")) redirect("/admin/users?error=last_admin");
  redirect("/admin/users?error=operation_failed");
}

export async function createUserAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const login = String(formData.get("login") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = formData.get("role") === "ADMIN" ? "ADMIN" : "EMPLOYEE";
  if (login.length < 3 || login.length > 64 || displayName.length < 2 || displayName.length > 120 || password.length < 8 || password.length > 256) {
    redirect("/admin/users?error=invalid_input");
  }
  try {
    await createApiAdminUser(session, { login, displayName, ...(phone ? { phone } : {}), password, role });
  } catch (error) {
    fail(error);
  }
  revalidatePath("/admin/users");
  redirect("/admin/users?success=user_created");
}

export async function setUserStateAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const isActive = formData.get("isActive") === "true";
  try {
    await setApiAdminUserState(session, userId, isActive);
  } catch (error) {
    fail(error);
  }
  revalidatePath("/admin/users");
  redirect(`/admin/users?success=${isActive ? "user_enabled" : "user_disabled"}`);
}

export async function setUserRoleAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const role = formData.get("role") === "ADMIN" ? "ADMIN" : "EMPLOYEE";
  try {
    await setApiAdminUserRole(session, userId, role);
  } catch (error) {
    fail(error);
  }
  revalidatePath("/admin/users");
  redirect("/admin/users?success=role_updated");
}

export async function resetUserPasswordAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8 || password.length > 256) redirect("/admin/users?error=password_length");
  try {
    await resetApiAdminUserPassword(session, userId, password);
  } catch (error) {
    fail(error);
  }
  redirect("/admin/users?success=password_updated");
}
