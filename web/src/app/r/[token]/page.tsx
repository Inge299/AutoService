import { AutoServiceApiError } from "@/lib/api/autoservice-api";
import { PublicMediaRefresh } from "@/components/public-media-refresh";
import { CustomerHeader } from "@/components/customer-header";
/* eslint-disable @next/next/no-img-element -- signed object-storage hosts are runtime-configured. */
import type { Metadata } from "next";
import { PublicUnavailable } from "@/components/public-unavailable";
import { ActionLink } from "@/components/action";
import { Icon } from "@/components/icons";
import { StatusPill } from "@/components/status-pill";
import { formatRub, priorityMeta, findingStatusMeta } from "@/lib/domain";
import { reportFollowUp } from "@/lib/report-follow-up";
import { getPublicReport, type PublicReport } from "@/lib/api/autoservice-api";

export const metadata: Metadata = { title: "Отчёт по визиту" };
type ReportMedia = PublicReport["report"]["media"][number];
type ReportFinding = PublicReport["report"]["findings"][number];
const formatDate = (value: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }).format(new Date(value));

function Materials({ media }: { media: ReportMedia[] }) {
  if (!media.length) return null;
  return <div className="evidence-media">{media.map((item) => item.kind === "PHOTO"
    ? <figure key={item.id}><img src={item.url} alt="Фото мастера" /><figcaption><Icon name="camera" /> Фото мастера</figcaption></figure>
    : item.kind === "VIDEO"
      ? <figure key={item.id}><video controls preload="metadata" src={item.url} /><figcaption><Icon name="camera" /> Видео мастера</figcaption></figure>
      : <figure key={item.id}><audio controls preload="metadata" src={item.url} /><figcaption><Icon name="phone" /> Голосовая заметка</figcaption></figure>)}</div>;
}

function WorkCard({ finding, nextVisitAt, media }: { finding: ReportFinding; nextVisitAt: string | null; media: ReportMedia[] }) {
  const priority = priorityMeta[finding.priority];
  const status = finding.status === "RECOMMENDED" ? { label: "Рекомендация", tone: "neutral" }
    : finding.status === "SENT_TO_CUSTOMER" ? { label: "Ожидает решения", tone: "warning" } : findingStatusMeta[finding.status];
  const { future, dueAt } = reportFollowUp(finding, nextVisitAt);
  return <article className="report-work-card">
    <div className="report-work-heading"><div><div className="report-finding-labels"><StatusPill label={status.label} tone={status.tone} /><StatusPill label={priority.label} tone={priority.tone} /></div><h4>{finding.title}</h4></div><div className="report-work-price"><small>{finding.status === "COMPLETED" ? "Стоимость работы" : "Оценка стоимости"}</small><strong>{finding.priceRub == null ? "Не указана" : formatRub(finding.priceRub)}</strong></div></div>
    {finding.status === "RECOMMENDED" && <p>Мастер рекомендует эту работу. Согласие на её выполнение не получено.</p>}
    {finding.description && <p>{finding.description}</p>}
    {future && <p className="report-work-plan">Не выполнено в этот визит. {dueAt ? `Рекомендуемый срок: до ${formatDate(dueAt)}.` : "Срок необходимо согласовать с мастерской."}</p>}
    {media.length > 0 && <div className="report-work-media"><span>Материалы к работе</span><Materials media={media} /></div>}
  </article>;
}

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let report;
  try { report = await getPublicReport(token); }
  catch (error) { return <PublicUnavailable technical preparing={error instanceof AutoServiceApiError && error.status === 503 && error.body.includes("media_preparing")} preparationFailed={error instanceof AutoServiceApiError && error.status === 503 && error.body.includes("media_preparation_failed")} title="Отчёт по визиту" />; }
  if (!report) return <PublicUnavailable title="Отчёт по визиту" />;
  const phoneLink = report.workshop.phone?.replace(/[^+\d]/g, "");
  const completed = report.report.findings.filter(finding => finding.status === "COMPLETED");
  const remaining = report.report.findings.filter(finding => finding.status !== "COMPLETED");
  const completedLines = report.report.completedWork.split("\n").map(line => line.trim()).filter(Boolean);
  const duplicatesCompletedCards = completed.length > 0 && completedLines.length === completed.length && completedLines.every((line, index) => line === completed[index]?.title.trim());
  const findingIds = new Set(report.report.findings.map(finding => finding.id));
  const generalMedia = report.report.media.filter(media => !media.findingId || !findingIds.has(media.findingId));
  const mediaFor = (id: string) => report.report.media.filter(media => media.findingId === id);

  const mediaExpiry = Math.min(900, ...report.report.media.map(media => media.expiresInSeconds || 900));
  return <PublicMediaRefresh expiresInSeconds={mediaExpiry}><main className="customer-page report-page">
    <CustomerHeader phone={report.workshop.phone} />
    <div className="customer-shell">
      <section className="customer-intro"><p className="customer-context">{report.workshop.name}</p><h1>Отчёт по визиту</h1><p>Результат визита, выполненные работы и рекомендации мастерской.</p><div className="customer-car"><span><Icon name="car" /></span><div><strong>{report.visit.vehicleLabel}</strong><small>{report.visit.licensePlate} · {report.visit.customerName}</small></div><StatusPill label="Визит завершён" tone="success" /></div></section>
      <div className="customer-layout report-layout">
        <section className="approval-detail report-detail">
          <div className="approval-heading"><StatusPill label="Итог визита" tone="success" /></div>
          <div className="report-facts"><div><span>Дата визита</span><strong>{report.visit.createdAt ? formatDate(report.visit.createdAt) : "Не указана"}</strong></div><div><span>Пробег</span><strong>{report.visit.mileageKm == null ? "Не указан" : `${new Intl.NumberFormat("ru-RU").format(report.visit.mileageKm)} км`}</strong></div></div>
          {(report.report.version || report.report.publishedAt) && <p className="report-document-meta">Отчёт{report.report.version ? ` №${report.report.version}` : ""}{report.report.publishedAt ? ` от ${formatDate(report.report.publishedAt)}` : ""}</p>}
          <section className="report-section"><h2>Что сделали</h2>{!duplicatesCompletedCards && <p className="approval-lead">{report.report.completedWork}</p>}{completed.length > 0 && <div className="report-work-list">{completed.map(finding => <WorkCard key={finding.id} finding={finding} nextVisitAt={report.report.nextVisitAt} media={mediaFor(finding.id)} />)}</div>}</section>
          {report.visit.complaint && <section className="report-section"><h3>С чем обратились</h3><p>{report.visit.complaint}</p></section>}
          {remaining.length > 0 && <section className="report-section"><h2>Остальные работы и решения</h2><p className="report-section-description">Статус каждой работы показывает, что было решено во время визита.</p><div className="report-work-list">{remaining.map(finding => <WorkCard key={finding.id} finding={finding} nextVisitAt={report.report.nextVisitAt} media={mediaFor(finding.id)} />)}</div></section>}
          <section className="report-section report-recommendations"><h2>Рекомендации</h2><p>{report.report.recommendations || "Рекомендации не указаны."}</p>{report.report.nextVisitAt && <div className="report-next-visit"><Icon name="clock" /><div><small>Следующий визит</small><strong>{formatDate(report.report.nextVisitAt)}</strong></div></div>}</section>
          {generalMedia.length > 0 && <section className="report-section"><h2>Общие материалы визита</h2><Materials media={generalMedia} /></section>}
        </section>
        <aside className="customer-decision report-contact"><section className="decision-panel"><h2>Есть вопросы?</h2><p>Обсудите результаты и дальнейшие работы с мастерской.</p>{report.workshop.phone ? <ActionLink href={`tel:${phoneLink}`}>Позвонить в мастерскую</ActionLink> : <p>Свяжитесь с мастерской удобным способом.</p>}</section><ActionLink href="/cabinet" variant="secondary">Личный кабинет</ActionLink></aside>
      </div>
    </div>
    <footer className="customer-footer"><span>AutoService</span></footer>
  </main></PublicMediaRefresh>;
}
