export type ReportFollowUp = {
  status: string;
  priority: string;
  followUpConfigured?: boolean;
  followUpDueAt?: string | null;
  followUpState?: "OPEN" | "DONE" | "CANCELLED";
};

export function reportFollowUp(finding: ReportFollowUp, nextVisitAt: string | null) {
  const future = (finding.followUpState ?? "OPEN") === "OPEN" &&
    finding.status !== "COMPLETED" && finding.status !== "DECLINED" &&
    (finding.status === "DEFERRED" || finding.priority === "PLANNED");
  const dueAt = finding.followUpConfigured ? finding.followUpDueAt ?? null : nextVisitAt;
  return { future, dueAt };
}
