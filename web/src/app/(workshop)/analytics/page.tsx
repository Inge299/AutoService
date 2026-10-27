import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { formatRub, visitStatusMeta, type VisitStatus } from "@/lib/domain";
import { workshopRepository } from "@/lib/repository";

export const metadata: Metadata = { title: "Результаты" };

const statusOrder: VisitStatus[] = ["DRAFT", "IN_REPAIR", "WAITING_APPROVAL", "COMPLETED", "CANCELLED"];

export default async function AnalyticsPage() {
  const summary = await workshopRepository.getSummary();
  const conversion = summary.sent ? Math.round((summary.decisions / summary.sent) * 100) : 0;
  const statusCounts = statusOrder.map((status) => ({
    status,
    count: summary.visitCounts[status] ?? 0,
  }));
  const maxStatusCount = Math.max(1, ...statusCounts.map((item) => item.count));

  return (
    <>
      <PageHeader title="Результаты мастерской" description="Показатели по визитам и решениям клиентов." />
      <section className="metric-grid analytics-metrics"><article className="metric-card"><div><small>Отправлено согласований</small><strong>{summary.sent}</strong><p>Включая выполненные работы</p></div></article><article className="metric-card"><div><small>Конверсия в решение</small><strong>{conversion}%</strong><p><b>{summary.decisions} из {summary.sent}</b> дали результат</p></div></article><article className="metric-card"><div><small>Согласованная стоимость</small><strong>{formatRub(summary.approvedValue)}</strong><p><b>{summary.approved}</b> работ подтверждено</p></div></article><article className="metric-card"><div><small>Завершено визитов</small><strong>{summary.visitCounts.COMPLETED ?? 0}</strong><p>Из {summary.totalVisits} визитов</p></div></article></section>
      <div className="analytics-grid"><section className="content-card chart-card"><div className="section-heading"><div><h2>Визиты по статусам</h2><p>Текущее распределение по всей базе</p></div><strong>{summary.totalVisits}</strong></div><div className="bar-chart">{statusCounts.map(({ status, count }) => <div key={status}><span style={{height:`${Math.max(count ? 12 : 3, Math.round((count / maxStatusCount) * 100))}%`}} title={`${visitStatusMeta[status].label}: ${count}`} /><small>{visitStatusMeta[status].label}</small></div>)}</div></section><section className="content-card funnel-card"><h2>Воронка согласования</h2>{[["Отправлено",summary.sent,summary.sent ? "100%" : "0%"],["Получено решение",summary.decisions,`${conversion}%`],["Согласовано",summary.approved,summary.sent ? `${Math.round((summary.approved / summary.sent) * 100)}%` : "0%"]].map(([label,value,percent]) => <div className="funnel-row" key={label}><span><strong>{label}</strong><small>{percent}</small></span><b>{value}</b></div>)}</section></div>
      {!summary.totalVisits && <p className="demo-data-note">Показатели появятся после первого визита.</p>}
    </>
  );
}
