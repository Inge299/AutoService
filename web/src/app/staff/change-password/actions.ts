"use server";

import { changeApiPassword, AutoServiceApiError } from "@/lib/api/autoservice-api";
import { createSessionToken, persistSession, requireSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export async function changePasswordAction(formData: FormData): Promise<void> {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (newPassword.length < 5 || newPassword.length > 256 || newPassword !== confirmation) {
    redirect("/staff/change-password?error=invalid_password");
  }

  const session = await requireSession();
  try {
    await changeApiPassword(session, currentPassword, newPassword);
  } catch (error) {
    if (error instanceof AutoServiceApiError && error.status === 401) {
      redirect("/staff/change-password?error=invalid_current_password");
    }
    redirect("/staff/change-password?error=server_unavailable");
  }
  const updatedSession = { ...session, mustChangePassword: false };
  await persistSession(createSessionToken(updatedSession), updatedSession.refreshTokenExpiresAtEpochMs);
  redirect("/dashboard");
}
