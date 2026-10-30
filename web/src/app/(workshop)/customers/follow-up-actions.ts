"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { AutoServiceApiError, updateFollowUp } from "@/lib/api/autoservice-api";

export async function saveFollowUp(_previous: { error?: string; success?: string }, form: FormData): Promise<{error?:string;success?:string}> {
  const session = await requireSession();
  const id = String(form.get("findingId") ?? ""), customerId = String(form.get("customerId") ?? ""), visitId = String(form.get("visitId") ?? "");
  const uuid = /^[a-f0-9-]{36}$/i;
  const date = String(form.get("dueAt") ?? ""), version = Number(form.get("version"));
  const state = String(form.get("intent") ?? "OPEN");
  if (!uuid.test(id) || !uuid.test(visitId) || (customerId && !uuid.test(customerId)) || !Number.isInteger(version) || version<1 ||
    !["OPEN", "DONE", "CANCELLED"].includes(state) || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return { error: "Проверьте срок и повторите действие." };
  try {
    await updateFollowUp(session, id, { baseServerVersion: version, dueAt: date ? `${date}T12:00:00+03:00` : null, state: state as "OPEN" | "DONE" | "CANCELLED" });
    if (customerId) revalidatePath(`/customers/${customerId}`);
    revalidatePath(`/visits/${visitId}`); revalidatePath("/reminders"); revalidatePath("/dashboard");
    return { success: state === "DONE" ? "Выполнение отмечено, ожидающее напоминание отменено." : state === "CANCELLED" ? "Работа снята с плана, ожидающее напоминание отменено." : "План сохранён. Напоминание обновлено, если отчёт опубликован." };
  } catch (error) {
    return { error: error instanceof AutoServiceApiError && error.status === 409 ? "План уже изменился. Обновите страницу и повторите действие." :
      error instanceof AutoServiceApiError && error.status === 400 ? "Выберите сегодняшний или будущий день." : "Не удалось сохранить план. Проверьте связь и повторите." };
  }
}
