import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { StatusPill } from "@/components/status-pill";
import { findingStatusMeta, formatRub, priorityMeta, visitStatusMeta } from "@/lib/domain";
import { workshopRepository } from "@/lib/repository";

export const metadata: Metadata = { title: "Карточка визита" };

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const visit = await workshopRepository.getVisit(id);
  if (!visit) notFound();
  const status = visitStatusMeta[visit.status];
  const approvedTotal = visit.findings.filter((finding) => finding.status === "APPROVED").reduce((sum, finding) => sum + (finding.priceRub ?? 0), 0);

  return (
    <>
      <Link href="/visits" className="back-link"><Icon name="arrow-left" /> Все визиты</Link>
      <header className="visit-header">
        <div className="visit-identity"><span className="vehicle-large"><Icon name="car" /></span><div><div className="title-line"><h1>{visit.vehicle}</h1><StatusPill label={status.label} tone={status.tone} /></div><p>{visit.plate} · {visit.customer} · {visit.phone}</p></div></div>
        <div className="visit-header-actions"><span className={`sync-label sync-${visit.syncHealth.toLowerCase()}`}><Icon name={visit.syncHealth === "ATTENTION" ? "alert" : "refresh"} />{visit.syncHealth === "SYNCED" ? "Синхронизировано" : visit.syncHealth === "SYNCING" ? "Идёт синхронизация" : "Нужна проверка"}</span><button className="icon-button" aria-label="Дополнительные действия"><Icon name="more" /></button></div>
      </header>

      <nav className="visit-tabs"><a href="#overview" className="active">Обзор</a><a href="#findings">Находки <em>{visit.findings.length}</em></a><a href="#media">Материалы <em>{visit.mediaCount}</em></a><a href="#history">История</a></nav>

      <div className="visit-layout" id="overview">
        <div className="visit-content">
          {visit.attention && <section className="visit-attention"><span><Icon name={visit.syncHealth === "ATTENTION" ? "refresh" : "phone"} /></span><div><strong>{visit.attention}</strong><p>Это действие задерживает следующий этап визита.</p></div><button className="button button-primary">{visit.nextAction}</button></section>}

          <section className="content-card visit-overview-card">
            <div className="section-heading"><div><h2>Приёмка</h2><p>{visit.arrivedAt}</p></div><StatusPill label="Данные сохранены" tone="success" /></div>
            <div className="intake-grid"><div><small>Жалоба клиента</small><strong>{visit.complaint}</strong></div><div><small>Пробег</small><strong>{visit.mileageKm?.toLocaleString("ru-RU") ?? "—"} км</strong></div><div><small>Ответственный</small><strong>{visit.mechanic}</strong></div><div><small>Материалы приёмки</small><strong>{visit.mediaCount} фото и видео</strong></div></div>
          </section>

          <section className="section-block" id="findings">
            <div className="section-heading"><div><h2>Находки и рекомендации</h2><p>То, что обнаружено во время диагностики</p></div><span className="subtle-action">Добавляются мастером в Android</span></div>
            <div className="findings-list">
              {visit.findings.length ? visit.findings.map((finding) => { const findingState = findingStatusMeta[finding.status]; const priority = priorityMeta[finding.priority]; return <article className="finding-card" key={finding.id}>
                <div className={`finding-stripe stripe-${priority.tone}`} />
                <div className="finding-body"><div className="finding-top"><div><StatusPill label={priority.label} tone={priority.tone} /><h3>{finding.title}</h3></div><strong className="finding-price">{finding.priceRub == null ? "Цена уточняется" : formatRub(finding.priceRub)}</strong></div><p>{finding.description}</p><div className="finding-footer"><span><Icon name="camera" /> {finding.mediaCount} материала</span><StatusPill label={findingState.label} tone={findingState.tone} /></div></div>
              </article>; }) : <div className="empty-inline"><Icon name="check" /><p><strong>Находок пока нет</strong><small>Мастер добавит их из Android во время диагностики.</small></p></div>}
            </div>
          </section>

          <section className="section-block" id="media"><div className="section-heading"><div><h2>Материалы</h2><p>Фото и видео, подтверждённые сервером</p></div><StatusPill label={`${visit.mediaCount} файлов`} tone="neutral" /></div>{visit.mediaCount ? <div className="media-grid">{Array.from({ length: Math.min(visit.mediaCount, 3) }, (_, index) => <div className="media-placeholder intake" key={index}><Icon name="camera" /><span>Материал {index + 1}</span></div>)}</div> : <div className="empty-inline"><Icon name="camera" /><p><strong>Материалов пока нет</strong><small>Они появятся после загрузки из Android-приложения.</small></p></div>}</section>
        </div>

        <aside className="visit-sidebar">
          <section className="next-step-card"><p className="eyebrow light">Следующее действие</p><h2>{visit.nextAction}</h2><p>{visit.status === "WAITING_APPROVAL" ? "Клиенту нужно пояснение перед окончательным решением." : "Продолжите процесс, когда мастер закончит текущий этап."}</p><button className="button button-light">{visit.nextAction}</button></section>
          <section className="content-card money-card"><div><small>Согласовано</small><strong>{formatRub(approvedTotal)}</strong></div><div><small>На рассмотрении</small><strong>{formatRub(visit.findings.filter((f) => ["READY_FOR_APPROVAL","SENT_TO_CUSTOMER","CALL_REQUESTED"].includes(f.status)).reduce((sum, f) => sum + (f.priceRub ?? 0), 0))}</strong></div></section>
          <section className="content-card activity-card" id="history"><h2>История визита</h2><div className="timeline">{visit.events.map((event) => <div className={`timeline-item ${event.tone}`} key={event.id}><i /><div><strong>{event.title}</strong><p>{event.detail}</p><small>{event.time}</small></div></div>)}</div></section>
        </aside>
      </div>
    </>
  );
}
