import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { VisitRow } from "@/components/visit-row";
import { requireSession } from "@/lib/auth/session";
import { formatRub, pluralRu, visitStatusMeta, type VisitStatus } from "@/lib/domain";
import { workshopRepository } from "@/lib/repository";

export const metadata: Metadata = { title: "Сегодня" };

const board: Array<{ status: VisitStatus; label: string }> = [
  { status: "DRAFT", label: "На приёмке" },
  { status: "IN_REPAIR", label: "В работе" },
  { status: "WAITING_APPROVAL", label: "Согласование" },
];

export default async function DashboardPage() {
  const [session, visits, reminders] = await Promise.all([
    requireSession(),
    workshopRepository.listVisits(),
    workshopRepository.listReminders(),
  ]);
  const currentDate = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  }).format(new Date());
  const active = visits.filter((visit) => !["COMPLETED", "CANCELLED"].includes(visit.status));
  const attention = active.filter((visit) => visit.attention);
  const approvedFindings = visits.flatMap((visit) => visit.findings).filter((finding) => finding.status === "APPROVED");
  const approvedValue = approvedFindings.reduce((sum, finding) => sum + (finding.priceRub ?? 0), 0);

  return (
    <>
      <PageHeader eyebrow={currentDate} title={`Добрый день, ${session.displayName}`} description="Вот что происходит в мастерской прямо сейчас." actions={<Link href="/visits" className="button button-secondary"><Icon name="search" /> Найти визит</Link>} />

      <section className="metric-grid" aria-label="Сводка за сегодня">
        <article className="metric-card"><span className="metric-icon teal"><Icon name="car" /></span><div><small>Автомобилей в работе</small><strong>{active.length}</strong><p>По данным сервера</p></div></article>
        <article className="metric-card"><span className="metric-icon amber"><Icon name="clock" /></span><div><small>Ждут решения клиента</small><strong>{active.filter((visit) => visit.status === "WAITING_APPROVAL").length}</strong><p>Активные согласования</p></div></article>
        <article className="metric-card"><span className="metric-icon green"><Icon name="check" /></span><div><small>Согласовано</small><strong>{formatRub(approvedValue)}</strong><p><b>{approvedFindings.length}</b> подтверждено</p></div></article>
        <article className="metric-card"><span className="metric-icon coral"><Icon name="alert" /></span><div><small>Нужно внимание</small><strong>{attention.length}</strong><p>{attention.length ? "Требуется действие" : "Нет задерживающих задач"}</p></div></article>
      </section>

      <div className="dashboard-layout">
        <div className="dashboard-main">
          <section className="section-block">
            <div className="section-heading"><div><h2>Нужно внимание</h2><p>Сначала действия, которые задерживают ремонт</p></div><StatusPill label={`${attention.length} ${pluralRu(attention.length, "задача", "задачи", "задач")}`} tone="danger" /></div>
            <div className="attention-list">
              {attention.map((visit) => (
                <Link key={visit.id} href={`/visits/${visit.id}`} className="attention-card">
                  <span className={`attention-icon ${visit.syncHealth === "ATTENTION" ? "coral" : "amber"}`}><Icon name={visit.syncHealth === "ATTENTION" ? "refresh" : "phone"} /></span>
                  <span className="attention-copy"><strong>{visit.attention}</strong><small>{visit.vehicle} · {visit.plate} · {visit.customer}</small></span>
                  <span className="attention-action">{visit.nextAction}<Icon name="arrow-right" /></span>
                </Link>
              ))}
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading"><div><h2>Автомобили сегодня</h2><p>{active.length} {pluralRu(active.length, "активный визит", "активных визита", "активных визитов")}</p></div><Link href="/visits" className="text-link">Все визиты <Icon name="arrow-right" /></Link></div>
            <div className="work-board">
              {board.map((column) => {
                const items = active.filter((visit) => visit.status === column.status);
                return <div className="board-column" key={column.status}>
                  <div className="board-title"><span className={`board-dot ${visitStatusMeta[column.status].tone}`} />{column.label}<em>{items.length}</em></div>
                  <div className="board-items">{items.length ? items.map((visit) => <VisitRow key={visit.id} visit={visit} compact />) : <p className="board-empty">Нет автомобилей</p>}</div>
                </div>;
              })}
            </div>
          </section>
        </div>

        <aside className="dashboard-side">
          <section className="side-card revenue-card"><p className="eyebrow light">Текущий результат</p><h3>Согласованные работы</h3><strong>{formatRub(approvedValue)}</strong><p>по загруженным визитам</p><div className="mini-chart" aria-label="Состояние согласований"><i style={{height:"24%"}}/><i style={{height:"24%"}}/><i style={{height:"24%"}}/><i style={{height: approvedValue ? "78%" : "24%"}}/><i style={{height: approvedValue ? "78%" : "24%"}}/><i style={{height: approvedValue ? "78%" : "24%"}}/><i style={{height: approvedValue ? "78%" : "24%"}}/></div><small><b>{approvedFindings.length}</b> работ подтверждено</small></section>
          <section className="side-card"><div className="side-card-title"><h3>Ближайшие напоминания</h3><Link href="/reminders">Все</Link></div>{reminders.length ? reminders.slice(0, 2).map((reminder) => <div className="reminder-mini" key={reminder.id}><span>{reminder.due}</span><div><strong>{reminder.customer}</strong><small>{reminder.reason} · {reminder.vehicle}</small></div></div>) : <p className="board-empty">Напоминаний пока нет</p>}</section>
        </aside>
      </div>
    </>
  );
}
