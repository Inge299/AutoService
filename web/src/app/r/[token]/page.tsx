/* eslint-disable @next/next/no-img-element -- signed object-storage hosts are runtime-configured. */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandMark, Icon } from "@/components/icons";
import { StatusPill } from "@/components/status-pill";
import { formatRub, priorityMeta } from "@/lib/domain";
import { getPublicReport } from "@/lib/api/autoservice-api";

export const metadata: Metadata = { title: "Отчёт по визиту" };

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await getPublicReport(token);
  if (!report) notFound();
  const expiresAt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }).format(new Date(report.expiresAt));
  const phoneLink = report.workshop.phone?.replace(/[^+\d]/g, "");

  return (
    <main className="customer-page">
      <header className="customer-header"><BrandMark />{report.workshop.phone && <a href={`tel:${phoneLink}`}><Icon name="phone" /> {report.workshop.phone}</a>}</header>
      <div className="customer-shell">
        <section className="customer-intro"><span className="eyebrow">{report.workshop.name}</span><h1>Отчёт по визиту</h1><p>Мы собрали в одном месте результаты диагностики и выполненные работы по вашему автомобилю.</p><div className="customer-car"><span><Icon name="car" /></span><div><strong>{report.visit.vehicleLabel}</strong><small>{report.visit.licensePlate} · {report.visit.customerName}</small></div><StatusPill label="Работы завершены" tone="success" /></div></section>
        <div className="customer-layout">
          <section className="approval-detail report-detail">
            <div className="approval-heading"><StatusPill label="Итог визита" tone="success" /><span>Сохранённая версия отчёта</span></div>
            <h2>Что было сделано</h2><p className="approval-lead">{report.report.completedWork}</p>
            <div className="report-section"><small>Жалоба при приёмке</small><p>{report.visit.complaint || "Не указана"}</p></div>
            <div className="report-section"><small>Находки и решения</small>{report.report.findings.length ? <div className="report-findings">{report.report.findings.map((finding) => { const priority = priorityMeta[finding.priority]; return <article key={finding.id}><div><StatusPill label={priority.label} tone={priority.tone} /><strong>{finding.title}</strong><p>{finding.description}</p></div><b>{finding.priceRub === null ? "Цена не указана" : formatRub(finding.priceRub)}</b></article>; })}</div> : <p>Дополнительных работ не зафиксировано.</p>}</div>
            {report.report.media.length > 0 && <div className="report-section"><small>Материалы визита</small><div className="evidence-media">{report.report.media.map((media) => media.kind === "PHOTO" ? <figure key={media.id}><img src={media.url} alt="Материал визита" /><figcaption><Icon name="camera" /> Фото мастера</figcaption></figure> : media.kind === "VIDEO" ? <figure key={media.id}><video controls preload="metadata" src={media.url} /><figcaption><Icon name="camera" /> Видео мастера</figcaption></figure> : <figure key={media.id}><audio controls preload="metadata" src={media.url} /><figcaption><Icon name="phone" /> Голосовая заметка</figcaption></figure>)}</div></div>}
          </section>
          <aside className="customer-decision"><section className="decision-panel"><h2>Рекомендации</h2><p>{report.report.recommendations || "Дополнительные рекомендации не требуются."}</p>{report.report.nextVisitAt && <div className="report-next-visit"><Icon name="clock" /><div><small>Следующий визит</small><strong>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }).format(new Date(report.report.nextVisitAt))}</strong></div></div>}</section><div className="customer-help"><Icon name="phone" /><p><strong>Есть вопросы по отчёту?</strong><small>{report.workshop.phone ? <>Позвоните в мастерскую: <a href={`tel:${phoneLink}`}>{report.workshop.phone}</a>.</> : "Свяжитесь с вашей мастерской удобным способом."}</small></p></div></aside>
        </div>
      </div>
      <footer className="customer-footer"><span>AutoService</span><p>Защищённая персональная ссылка · действует до {expiresAt}</p></footer>
    </main>
  );
}
