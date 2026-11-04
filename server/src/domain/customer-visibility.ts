/** Statuses a customer may see, including an approval awaiting their decision. */
export const customerVisibleStatuses = ["SENT_TO_CUSTOMER", "APPROVED", "COMPLETED", "DECLINED", "DEFERRED", "CALL_REQUESTED"] as const;
const customerStatuses = new Set<string>(customerVisibleStatuses);

export function customerVisibleStatus(status: unknown): boolean {
  return typeof status === "string" && customerStatuses.has(status);
}

/** Remove only machine-generated recommendation lines for private findings. */
export function withoutPrivateGeneratedRecommendations(notes: string, hiddenTitles: readonly string[]): string {
  const generated = /^Не выполнено в этот визит: (.+)\. Необходимо выполнить в дальнейшем\. (?:Рекомендуемый срок: до \d{2}\.\d{2}\.\d{4}\.|Срок необходимо согласовать с мастерской\.)$/;
  const hidden = new Set(hiddenTitles);
  return notes.split("\n").filter(line => {
    const match = generated.exec(line.trim());
    return !match || !hidden.has(match[1]!);
  }).join("\n").trim();
}

export function projectReportFindings(findings: unknown) {
  if (!Array.isArray(findings)) return { visible: [], visibleIds: new Set<string>(), mediaVisibleIds: new Set<string>(), hiddenTitles: [], hasHidden: true, canSanitize: false };
  const visible: unknown[] = [];
  const visibleIds = new Set<string>();
  const mediaVisibleIds = new Set<string>();
  const hiddenTitles: string[] = [];
  let hasHidden = false;
  let canSanitize = true;
  for (const item of findings) {
    if (!item || typeof item !== "object" || Array.isArray(item)) { hasHidden = true; canSanitize = false; continue; }
    const finding = item as Record<string, unknown>;
    const explicitRecommendation = finding.reportRecommendation === true && ["DRAFT", "READY_FOR_APPROVAL"].includes(String(finding.status));
    if (customerVisibleStatus(finding.status) || explicitRecommendation) {
      const publicFinding: Record<string, unknown> = {};
      for (const key of ["id", "title", "description", "priceRub", "priority", "status", "followUpDueAt", "followUpConfigured", "followUpState"]) {
        if (Object.hasOwn(finding, key)) publicFinding[key] = finding[key];
      }
      if (explicitRecommendation) publicFinding.status = "RECOMMENDED";
      visible.push(publicFinding);
      if (typeof finding.id === "string") {
        visibleIds.add(finding.id);
        if (!explicitRecommendation) mediaVisibleIds.add(finding.id);
      }
      if (explicitRecommendation) hasHidden = true;
    } else {
      hasHidden = true;
      if (typeof finding.title === "string" && finding.title.length > 0 && !/[\r\n\u2028\u2029]/.test(finding.title)) hiddenTitles.push(finding.title);
      else canSanitize = false;
    }
  }
  return { visible, visibleIds, mediaVisibleIds, hiddenTitles, hasHidden, canSanitize };
}

/** Use immutable publication-time associations when available; old snapshots
 * conservatively hide unlinked files if any private finding was captured. */
export function customerVisibleMediaIds(
  ids: readonly string[], manifest: unknown, visibleFindingIds: ReadonlySet<string>, hasHidden: boolean,
  currentAssets: ReadonlyArray<{ id: string; findingId: string | null }>,
): string[] {
  if (!hasHidden) return [...ids];
  if (Array.isArray(manifest) && manifest.length === ids.length) {
    const associations = new Map<string, string | null>();
    for (const item of manifest) {
      if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" ||
          (item.findingId !== null && typeof item.findingId !== "string") || associations.has(item.id)) {
        associations.clear(); break;
      }
      associations.set(item.id, item.findingId);
    }
    if (associations.size === ids.length && ids.every(id => associations.has(id))) {
      return ids.filter(id => associations.get(id) === null || visibleFindingIds.has(associations.get(id)!));
    }
  }
  const known = new Map(currentAssets.map(asset => [asset.id, asset.findingId]));
  return ids.filter(id => { const findingId = known.get(id); return !!findingId && visibleFindingIds.has(findingId); });
}

/** Only an intact publication manifest can link an image to a work item. */
export function reportMediaAssociations(ids: readonly string[], manifest: unknown, visibleFindingIds: ReadonlySet<string>): Map<string, string | null> {
  const general = new Map(ids.map(id => [id, null]));
  if (!Array.isArray(manifest) || manifest.length !== ids.length) return general;
  const result = new Map<string, string | null>();
  for (const item of manifest) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" ||
        (item.findingId !== null && typeof item.findingId !== "string") || result.has(item.id)) return general;
    result.set(item.id, item.findingId !== null && visibleFindingIds.has(item.findingId) ? item.findingId : null);
  }
  return result.size === ids.length && ids.every(id => result.has(id)) ? result : general;
}
