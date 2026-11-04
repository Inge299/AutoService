import type { Prisma, PrismaClient } from "@prisma/client";

type JobWriter = Pick<PrismaClient | Prisma.TransactionClient, "backgroundJob">;
type LegacyAsset = { id: string; objectKey: string };

/** Queue each old object once. A failed job stays DEAD for operator investigation. */
export async function queueLegacyMedia(db: JobWriter, workshopId: string, assets: LegacyAsset[]): Promise<"ready" | "preparing" | "failed"> {
  const legacy = assets.filter(asset => !asset.objectKey.endsWith("/verified"));
  if (!legacy.length) return "ready";
  await db.backgroundJob.createMany({
    data: legacy.map(asset => ({ workshopId, type: "VERIFY_MEDIA", payload: { mediaId: asset.id }, idempotencyKey: `legacy-seal:${asset.id}` })),
    skipDuplicates: true,
  });
  const failed = await db.backgroundJob.findFirst({ where: {
    idempotencyKey: { in: legacy.map(asset => `legacy-seal:${asset.id}`) }, state: "DEAD",
  }, select: { id: true } });
  return failed ? "failed" : "preparing";
}
