"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AutoServiceApiError, cancelApiReminder } from "@/lib/api/autoservice-api";
import { requireSession } from "@/lib/auth/session";

export async function cancelReminderAction(formData: FormData): Promise<void> {
  const reminderId = String(formData.get("reminderId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(reminderId)) redirect("/reminders?error=invalid_reminder");
  try {
    await cancelApiReminder(await requireSession(), reminderId);
  } catch (error) {
    if (error instanceof AutoServiceApiError && error.message.includes("reminder_not_pending")) {
      redirect("/reminders?error=reminder_not_pending");
    }
    redirect("/reminders?error=operation_failed");
  }
  revalidatePath("/reminders");
  redirect("/reminders?success=reminder_cancelled");
}
