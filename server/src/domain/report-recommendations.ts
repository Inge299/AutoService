type ReportFinding = { title: string; priority: string; status: string; followUpState?: string; followUpConfigured?: boolean; followUpDueAt?: Date | null };

export function futureWork<T extends ReportFinding>(findings: T[]): T[] {
  return findings.filter(finding => (finding.followUpState ?? "OPEN") === "OPEN" && finding.status !== "COMPLETED" && finding.status !== "DECLINED" &&
    (finding.status === "DEFERRED" || finding.priority === "PLANNED"));
}

export function reportRecommendations(notes: string, findings: ReportFinding[], dueAt: Date | null): string {
  const format = (value: Date | null) => value ? new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Moscow",
  }).format(value) : null;
  const lines = futureWork(findings).map(finding => {
    const date = format(finding.followUpConfigured ? finding.followUpDueAt ?? null : dueAt);
    return `Не выполнено в этот визит: ${finding.title}. Необходимо выполнить в дальнейшем. ${date ? `Рекомендуемый срок: до ${date}.` : "Срок необходимо согласовать с мастерской."}`;
  });
  // Rebuild our generated lines from the current finding state, including after a report revision.
  const custom = notes.split("\n").filter(line => !isGeneratedRecommendation(line.trim())).join("\n").trim();
  return [custom, ...new Set(lines)].filter(Boolean).join("\n");
}

function isGeneratedRecommendation(line: string): boolean {
  return /^Не выполнено в этот визит: .+\. Необходимо выполнить в дальнейшем\. (Рекомендуемый срок: до \d{2}\.\d{2}\.\d{4}\.|Срок необходимо согласовать с мастерской\.)$/.test(line);
}
