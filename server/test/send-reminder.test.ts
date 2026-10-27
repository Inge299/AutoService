import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { deliverReminder } from "../src/infrastructure/send-reminder.js";

const reminder = { id: "synthetic-reminder", workshopId: "synthetic-workshop", state: "PENDING",
  customerPhone: "+79990000000", reason: "Synthetic service", vehicleLabel: "Synthetic car", dueAt: new Date("2099-01-01") };

describe("reminder delivery cancellation", () => {
  it.each(["CANCELLED", "SENT", "DELIVERED", "FAILED"])("does not send a %s reminder", async state => {
    const send = vi.fn();
    await deliverReminder({ reminder: { findUnique: async () => ({ ...reminder, state }) } } as unknown as PrismaClient,
      { send, status: vi.fn() }, reminder.id);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([true, false])("queues a delivery poll only when the pending state is still owned (pending=%s)", async pending => {
    const updateMany = vi.fn().mockResolvedValue({ count: pending ? 1 : 0 });
    const create = vi.fn(); const send = vi.fn().mockResolvedValue({ providerMessageId: "synthetic-receipt" });
    const prisma = { reminder: { findUnique: async () => reminder },
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ reminder: { updateMany }, backgroundJob: { create } }) };
    await deliverReminder(prisma as unknown as PrismaClient, { send, status: vi.fn() }, reminder.id);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: reminder.id, state: "PENDING" } }));
    expect(create).toHaveBeenCalledTimes(pending ? 1 : 0);
  });
});
