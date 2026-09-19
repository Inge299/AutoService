import { JobState, type Prisma } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { ObjectStorage, MediaIntegrityError } from "./infrastructure/object-storage.js";
import { createPrisma } from "./infrastructure/prisma.js";
import { createReminderDelivery } from "./infrastructure/reminder-delivery.js";

interface ClaimedJob {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

const config = loadConfig();
const prisma = createPrisma();
const storage = new ObjectStorage(config);
const reminderDelivery = createReminderDelivery(config);
let stopping = false;

class PermanentJobError extends Error {}

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

async function claimJob(): Promise<ClaimedJob | undefined> {
  const jobs = await prisma.$queryRaw<ClaimedJob[]>`
    UPDATE background_jobs
    SET state = 'RUNNING', attempts = attempts + 1,
        locked_until = NOW() + INTERVAL '5 minutes', updated_at = NOW()
    WHERE id = (
      SELECT id FROM background_jobs
      WHERE (state IN ('PENDING', 'RETRY') AND run_after <= NOW())
         OR (state = 'RUNNING' AND locked_until < NOW())
      ORDER BY run_after, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload, attempts
  `;
  return jobs[0];
}

async function verifyMedia(payload: Prisma.JsonValue): Promise<void> {
  const mediaId = typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? payload.mediaId
    : undefined;
  if (typeof mediaId !== "string") throw new PermanentJobError("VERIFY_MEDIA payload is invalid");

  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!asset) throw new PermanentJobError("Media asset does not exist");
  if (["VERIFIED", "READY"].includes(asset.state) && asset.objectKey.endsWith("/verified")) return;
  try {
    const objectKey = await storage.seal(asset);
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { objectKey, state: "VERIFIED", lastError: null } });
  } catch (error) {
    if (error instanceof MediaIntegrityError) {
      await prisma.mediaAsset.update({ where: { id: asset.id }, data: { state: "BLOCKED", lastError: "Media integrity mismatch" } });
      throw new PermanentJobError("Media integrity mismatch");
    }
    throw error;
  }
}

function reminderIdFrom(payload: Prisma.JsonValue): string | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  return typeof payload.reminderId === "string" ? payload.reminderId : undefined;
}

async function sendReminder(payload: Prisma.JsonValue): Promise<void> {
  const reminderId = reminderIdFrom(payload);
  if (!reminderId) throw new PermanentJobError("SEND_REMINDER_SMS payload is invalid");
  const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
  if (!reminder) throw new PermanentJobError("Reminder does not exist");
  if (reminder.state !== "PENDING") return;
  const receipt = await reminderDelivery.send({
    phone: reminder.customerPhone,
    text: `Автосервис: ${reminder.reason}. ${reminder.vehicleLabel}. Плановая дата: ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(reminder.dueAt)}.`,
  });
  await prisma.reminder.update({
    where: { id: reminder.id },
    data: { state: "SENT", sentAt: new Date(), providerMessageId: receipt.providerMessageId, lastError: null },
  });
  if (receipt.providerMessageId) {
    await prisma.backgroundJob.create({
      data: {
        workshopId: reminder.workshopId,
        reminderId: reminder.id,
        type: "CHECK_REMINDER_DELIVERY",
        payload: { reminderId: reminder.id },
        idempotencyKey: `reminder:${reminder.id}:delivery-status`,
        runAfter: new Date(Date.now() + 60_000),
      },
    });
  }
}

async function checkReminderDelivery(payload: Prisma.JsonValue): Promise<void> {
  const reminderId = reminderIdFrom(payload);
  if (!reminderId) throw new PermanentJobError("CHECK_REMINDER_DELIVERY payload is invalid");
  const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
  if (!reminder) throw new PermanentJobError("Reminder does not exist");
  if (reminder.state !== "SENT" || !reminder.providerMessageId) return;
  const status = await reminderDelivery.status(reminder.providerMessageId);
  if (status === "DELIVERED") {
    await prisma.reminder.update({ where: { id: reminder.id }, data: { state: "DELIVERED", deliveredAt: new Date(), lastError: null } });
    return;
  }
  if (status === "FAILED") {
    await prisma.reminder.update({ where: { id: reminder.id }, data: { state: "FAILED", lastError: "Provider reported undeliverable message" } });
    return;
  }
  throw new Error("Reminder delivery is pending");
}

async function processJob(job: ClaimedJob): Promise<void> {
  if (job.type === "VERIFY_MEDIA") return verifyMedia(job.payload);
  if (job.type === "SEND_REMINDER_SMS") return sendReminder(job.payload);
  if (job.type === "CHECK_REMINDER_DELIVERY") return checkReminderDelivery(job.payload);
  throw new PermanentJobError(`Unsupported job type: ${job.type}`);
}

while (!stopping) {
  const job = await claimJob();
  if (!job) {
    await delay(config.WORKER_POLL_INTERVAL_MS);
    continue;
  }

  try {
    await processJob(job);
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { state: JobState.SUCCEEDED, lockedUntil: null, lastError: null },
    });
  } catch (error) {
    const terminal = error instanceof PermanentJobError || job.attempts >= 5;
    if (terminal && job.type === "VERIFY_MEDIA" && typeof job.payload === "object" && job.payload !== null && !Array.isArray(job.payload) && typeof job.payload.mediaId === "string") {
      await prisma.mediaAsset.updateMany({ where: { id: job.payload.mediaId, state: "VERIFYING" }, data: { state: "RETRY", lastError: "Verification failed; retry upload" } });
    }
    const reminderId = job.type === "SEND_REMINDER_SMS" ? reminderIdFrom(job.payload) : undefined;
    if (reminderId) {
      await prisma.reminder.updateMany({
        where: { id: reminderId, state: "PENDING" },
        data: {
          ...(terminal ? { state: "FAILED" } : {}),
          attempts: { increment: 1 },
          lastError: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown error",
        },
      });
    }
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        state: terminal ? JobState.DEAD : JobState.RETRY,
        lockedUntil: null,
        runAfter: new Date(Date.now() + Math.min(60_000, 2 ** job.attempts * 1_000)),
        lastError: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown error",
      },
    });
  }
}

await prisma.$disconnect();
