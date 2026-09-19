"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createApprovalLink, getApiVisit } from "@/lib/api/autoservice-api";
import { requireSession } from "@/lib/auth/session";

export async function createApprovalLinkAction(formData: FormData): Promise<void> {
  const visitId = String(formData.get("visitId") ?? "");
  const findingId = String(formData.get("findingId") ?? "");
  const session = await requireSession();
  const visit = await getApiVisit(visitId, session);
  const finding = visit?.findings.find((item) => item.id === findingId);
  if (!visit || !finding || finding.status !== "READY_FOR_APPROVAL" || finding.priceRub === null || finding.media.length === 0 || finding.media.length !== finding._count.media) {
    redirect(`/visits/${encodeURIComponent(visitId)}?error=approval_unavailable`);
  }
  const token = randomBytes(32).toString("base64url");
  const result = await createApprovalLink(findingId, { operationId: randomUUID(), token, mediaIds: finding.media.map((media) => media.id), expiresInDays: 7 }, session);
  revalidatePath(`/visits/${visitId}`);
  redirect(`/visits/${encodeURIComponent(visitId)}?approval=${encodeURIComponent(result.publicPath)}`);
}
