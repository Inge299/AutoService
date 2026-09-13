import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { formatRub, visitStatusMeta, type VisitStatus } from "@/lib/domain";
import { workshopRepository } from "@/lib/repository";

export const metadata: Metadata = { title: "Результаты" };

const statusOrder: VisitStatus[] = ["DRAFT", "IN_REPAIR", "WAITING_APPROVAL", "COMPLETED", "CANCELLED"];

export default async function AnalyticsPage() {
  const visits = await workshopRepository.listVisits();
  const findings = visits.flatMap((visit) => visit.findings);
  const sentStatuses = ["SENT_TO_CUSTOMER", "APPROVED", "DECLINED", "CALL_REQUESTED", "DEFERRED"];
  const decisionStatuses = ["APPROVED", "DECLINED", "CALL_REQUESTED", "DEFERRED"];
  const sent = findings.filter((finding) => sentStatuses.includes(finding.status));
  const decisions = sent.filter((finding) => decisionStatuses.includes(finding.status));
  const approved = findings.filter((finding) => finding.status === "APPROVED");
  const approvedValue = approved.reduce((sum, finding) => sum + (finding.priceRub ?? 0), 0);
  const conversion = sent.length ? Math.round((decisions.length / sent.length) * 100) : 0;
  const statusCounts = statusOrder.map((status) => ({
    status,
    count: visits.filter((visit) => visit.status === status).length,
  }));
  const maxStatusCount = Math.max(1, ...statusCounts.map((item) => item.count));

  return (
    <>
      <PageHeader eyebrow="Актуальные данные" title="Результаты мастерской" description="Показатели рассчитаны по визитам, загруженным на сервер." />
      <section className="metric-grid analytics-metrics"><article className="metric-card"><div><small>Отправлено согласований</small><strong>{sent.length}</strong><p>По статусам находок</p></div></article><article className="metric-card"><div><small>Конверсия в решение</small><strong>{conversion}%</strong><p><b>{decisions.length} из {sent.length}</b> дали результат</p></div></article><article className="metric-card"><div><small>Согласованная выручка</small><strong>{formatRub(approvedValue)}</strong><p><b>{approved.length}</b> работ подтверждено</p></div></article><article className="metric-card"><div><small>Завершено визитов</small><strong>{statusCounts.find((item) => item.status === "COMPLETED")?.count ?? 0}</strong><p>Из {visits.length} загруженных</p></div></article></section>
      <div className="analytics-grid"><section className="content-card chart-card"><div className="section-heading"><div><h2>Визиты по статусам</h2><p>Текущее распределение</p></div><strong>{visits.length}</strong></div><div className="bar-chart">{statusCounts.map(({ status, count }) => <div key={status}><span style={{height:`${Math.max(count ? 12 : 3, Math.round((count / maxStatusCount) * 100))}%`}} title={`${visitStatusMeta[status].label}: ${count}`} /><small>{visitStatusMeta[status].label}</small></div>)}</div></section><section className="content-card funnel-card"><h2>Воронка согласования</h2>{[["Отправлено",sent.length,"100%"],["Получено решение",decisions.length,`${conversion}%`],["Согласовано",approved.length,sent.length ? `${Math.round((approved.length / sent.length) * 100)}%` : "0%"]].map(([label,value,percent]) => <div className="funnel-row" key={label}><span><strong>{label}</strong><small>{percent}</small></span><b>{value}</b></div>)}</section></div>
      {!visits.length && <p className="demo-data-note">На сервере пока нет визитов. Показатели обновятся автоматически после первой синхронизации.</p>}
    </>
  );
}
