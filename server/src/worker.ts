import { JobState, type Prisma } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { ObjectStorage } from "./infrastructure/object-storage.js";
import { createPrisma } from "./infrastructure/prisma.js";

interface ClaimedJob {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

const config = loadConfig();
const prisma = createPrisma();
const storage = new ObjectStorage(config);
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
  const actualSha256 = await storage.sha256(asset.objectKey);
  if (actualSha256 !== asset.sha256) {
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { state: "BLOCKED", lastError: "SHA-256 mismatch" },
    });
    throw new PermanentJobError("Media SHA-256 mismatch");
  }
  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { state: "VERIFIED", lastError: null } });
}

async function processJob(job: ClaimedJob): Promise<void> {
  if (job.type === "VERIFY_MEDIA") return verifyMedia(job.payload);
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
