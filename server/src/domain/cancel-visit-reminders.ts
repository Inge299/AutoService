import type { Prisma } from "@prisma/client";

export async function cancelVisitReminders(
  tx: Prisma.TransactionClient, workshopId: string, visitId: string, reason: string,
): Promise<void> {
  const pending = await tx.reminder.findMany({
    where: { workshopId, visitId, state: "PENDING" }, select: { id: true },
  });
  if (pending.length === 0) return;
  const ids = pending.map(reminder => reminder.id);
  await tx.reminder.updateMany({
    where: { workshopId, id: { in: ids }, state: "PENDING" },
    data: { state: "CANCELLED", cancelledAt: new Date(), lastError: null },
  });
  await tx.backgroundJob.updateMany({
    where: { workshopId, reminderId: { in: ids }, state: { in: ["PENDING", "RETRY", "RUNNING"] } },
    data: { state: "DEAD", lockedUntil: null, lastError: reason },
  });
}
