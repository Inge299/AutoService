import type { Prisma } from "@prisma/client";

export async function cancelWorkReminders(tx: Prisma.TransactionClient, workshopId: string, findingId: string) {
  const rows = await tx.reminder.findMany({ where: { workshopId, findingId, state: { in: ["PENDING", "FAILED"] } }, select: { id: true } });
  const ids = rows.map(row => row.id);
  if (!ids.length) return;
  await tx.reminder.updateMany({ where: { workshopId, id: { in: ids } }, data: { state: "CANCELLED", cancelledAt: new Date() } });
  await tx.backgroundJob.updateMany({ where: { workshopId, reminderId: { in: ids }, state: { in: ["PENDING", "RETRY", "RUNNING"] } },
    data: { state: "DEAD", lockedUntil: null, lastError: "Work plan changed" } });
}

export async function scheduleWorkReminder(tx: Prisma.TransactionClient,
  visit: { id: string; workshopId: string; customerName: string; customerPhone: string; vehicleLabel: string },
  reportVersionId: string, findingId: string | null, reason: string, dueAt: Date) {
  const sendAt = new Date(Math.max(Date.now(), dueAt.getTime() - 7 * 24 * 60 * 60_000));
  const reminder = await tx.reminder.create({ data: { workshopId: visit.workshopId, visitId: visit.id, reportVersionId,
    findingId, customerName: visit.customerName, customerPhone: visit.customerPhone, vehicleLabel: visit.vehicleLabel, reason, dueAt, sendAt } });
  await tx.backgroundJob.create({ data: { workshopId: visit.workshopId, reminderId: reminder.id, type: "SEND_REMINDER_SMS",
    payload: { reminderId: reminder.id }, idempotencyKey: `reminder:${reminder.id}:sms`, runAfter: sendAt } });
}
