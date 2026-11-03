import { ActionLink } from "@/components/action";
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
  const [session, summary, draft, repair, waiting, urgent] = await Promise.all([
    requireSession(),
    workshopRepository.getSummary(),
    workshopRepository.listVisitPage({ status: "DRAFT" }, 1, 10),
    workshopRepository.listVisitPage({ status: "IN_REPAIR" }, 1, 10),
    workshopRepository.listVisitPage({ status: "WAITING_APPROVAL" }, 1, 10),
    workshopRepository.listVisitPage({ attention: true }, 1, 5),
  ]);
  const currentDate = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  }).format(new Date());
  const active = [...draft.items, ...repair.items, ...waiting.items];
  const attention = urgent.items;
  const reminders = summary.upcomingReminders;

  return (
    <>
      <PageHeader title="Сегодня в мастерской" description={`${currentDate}. ${session.displayName}, здесь собраны текущие визиты и решения клиентов.`} actions={<ActionLink variant="secondary" href="/visits"><Icon name="search" /> Найти визит</ActionLink>} />

      <section className="operations-summary" aria-label="Сводка за сегодня">
        <div><span>В работе</span><strong>{summary.activeVisits}</strong></div>
        <div><span>Ждут решения</span><strong>{summary.visitCounts.WAITING_APPROVAL ?? 0}</strong></div>
        <div><span>Согласовано</span><strong>{formatRub(summary.approvedValue)}</strong><small>{summary.approved} {pluralRu(summary.approved, "работа", "работы", "работ")}</small></div>
      </section>

      <div className="dashboard-layout">
        <div className="dashboard-main">
          <section className="section-block">
            <div className="section-heading"><div><h2>Нужно внимание</h2><p>Сначала действия, которые задерживают ремонт</p></div><StatusPill label={`${summary.attentionVisits} ${pluralRu(summary.attentionVisits, "задача", "задачи", "задач")}`} tone="danger" /></div>
            <div className="attention-list">
              {attention.length ? attention.map((visit) => (
                <Link key={visit.id} href={`/visits/${visit.id}`} className="attention-card">
                  <span className={`attention-icon ${visit.syncHealth === "ATTENTION" ? "coral" : "amber"}`}><Icon name={visit.syncHealth === "ATTENTION" ? "refresh" : "phone"} /></span>
                  <span className="attention-copy"><strong>{visit.attention}</strong><small>{visit.vehicle} · {visit.plate} · {visit.customer}</small></span>
                  <span className="attention-action">{visit.nextAction}<Icon name="arrow-right" /></span>
                </Link>
              )) : <p className="attention-empty"><Icon name="check" /> Нет действий, задерживающих ремонт</p>}
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading"><div><h2>Текущие автомобили</h2><p>{summary.activeVisits} {pluralRu(summary.activeVisits, "активный визит", "активных визита", "активных визитов")}</p></div><ActionLink variant="secondary" href="/visits" >Все визиты <Icon name="arrow-right" /></ActionLink></div>
            <div className="work-board">
              {board.map((column) => {
                const items = active.filter((visit) => visit.status === column.status);
                return <div className="board-column" key={column.status}>
                  <div className="board-title"><span className={`board-dot ${visitStatusMeta[column.status].tone}`} />{column.label}<em>{summary.visitCounts[column.status] ?? 0}</em></div>
                  <div className="board-items">{items.length ? items.map((visit) => <VisitRow key={visit.id} visit={visit} compact />) : <p className="board-empty">Нет автомобилей</p>}</div>
                  {(summary.visitCounts[column.status] ?? 0) > items.length && <Link href={`/visits?status=${column.status}`}>Показать все →</Link>}
                </div>;
              })}
            </div>
          </section>
        </div>

        <aside className="dashboard-side">
          <section className="side-card"><div className="side-card-title"><h3>Ближайшие напоминания</h3><ActionLink href="/reminders">Все напоминания</ActionLink></div>{reminders.length ? reminders.slice(0, 2).map((reminder) => <div className="reminder-mini" key={reminder.id}><span>{reminder.due}</span><div><strong>{reminder.customer}</strong><small>{reminder.reason} · {reminder.vehicle}</small></div></div>) : <p className="board-empty">Напоминаний пока нет</p>}</section>
        </aside>
      </div>
    </>
  );
}
