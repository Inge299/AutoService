import { describe, expect, it } from "vitest";
import { futureWork, reportRecommendations } from "../src/domain/report-recommendations.js";

describe("future work in visit reports", () => {
  const findings = [
    { title: "Замена ремня", priority: "IMPORTANT", status: "DEFERRED" },
    { title: "Замена фильтра", priority: "PLANNED", status: "DRAFT" },
    { title: "Уже сделано", priority: "PLANNED", status: "COMPLETED" },
    { title: "Отклонено", priority: "PLANNED", status: "DECLINED" },
    { title: "Согласовано", priority: "IMPORTANT", status: "APPROVED" },
  ];
  it("includes deferred work regardless of priority and only unfinished planned work", () => {
    expect(futureWork(findings).map(item => item.title)).toEqual(["Замена ремня", "Замена фильтра"]);
  });
  it("keeps master notes and adds explicit work and deadline for the report and reminder", () => {
    const text = reportRecommendations("Проверять уровень масла", findings, new Date("2026-11-18T00:00:00+03:00"));
    expect(text).toContain("Проверять уровень масла");
    expect(text).toContain("Не выполнено в этот визит: Замена ремня. Необходимо выполнить в дальнейшем. Рекомендуемый срок: до 18.11.2026.");
    expect(text).not.toContain("Уже сделано");
    expect(reportRecommendations(text, findings, new Date("2026-12-18T00:00:00+03:00"))).not.toContain("18.11.2026");
  });
  it("does not invent a deadline and does not duplicate recommendations on retry", () => {
    const text = reportRecommendations("", findings, null);
    expect(text).toContain("Срок необходимо согласовать с мастерской.");
    expect(reportRecommendations(text, findings, null)).toBe(text);
    expect(reportRecommendations(text, [], null)).toBe("");
  });
});
