import type { PrismaClient } from "@prisma/client";
import type { ReminderDelivery } from "./reminder-delivery.js";

export async function deliverReminder(prisma: PrismaClient, delivery: ReminderDelivery, reminderId: string): Promise<void> {
  const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
  if (!reminder || reminder.state !== "PENDING") return;
  const receipt = await delivery.send({
    phone: reminder.customerPhone,
    text: `Автосервис: ${reminder.reason}. ${reminder.vehicleLabel}. Плановая дата: ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(reminder.dueAt)}.`,
  });
  await prisma.$transaction(async tx => {
    // A provider call may finish after staff cancels/revises the reminder.
    // Never restore CANCELLED to SENT or enqueue delivery polls for it.
    const sent = await tx.reminder.updateMany({
      where: { id: reminder.id, state: "PENDING" },
      data: { state: "SENT", sentAt: new Date(), providerMessageId: receipt.providerMessageId, lastError: null },
    });
    if (sent.count === 1 && receipt.providerMessageId) {
      await tx.backgroundJob.create({
        data: {
          workshopId: reminder.workshopId, reminderId: reminder.id,
          type: "CHECK_REMINDER_DELIVERY", payload: { reminderId: reminder.id },
          idempotencyKey: `reminder:${reminder.id}:delivery-status`, runAfter: new Date(Date.now() + 60_000),
        },
      });
    }
  });
}
