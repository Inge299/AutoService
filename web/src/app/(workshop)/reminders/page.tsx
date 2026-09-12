import type { Metadata } from "next";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { workshopRepository } from "@/lib/repository";

export const metadata: Metadata = { title: "Напоминания" };

const stateMeta = {
  OVERDUE: { label: "Просрочено", tone: "danger" },
  TODAY: { label: "Сегодня", tone: "warning" },
  UPCOMING: { label: "Запланировано", tone: "neutral" },
};

export default async function RemindersPage() {
  const reminders = await workshopRepository.listReminders();
  return (
    <>
      <PageHeader eyebrow="Возврат клиентов" title="Напоминания" description="Контакты, которые помогут превратить рекомендацию в следующий визит." />
      <section className="summary-banner"><span className="summary-icon"><Icon name="reminders" /></span><div><strong>2 клиента требуют внимания</strong><p>Одно напоминание просрочено, ещё одно запланировано на сегодня.</p></div><button className="button button-primary" disabled title="Станет доступно после подключения SMS endpoint">Подготовить отправку</button></section>
      <section className="content-card reminders-list">
        {reminders.map((reminder) => { const meta = stateMeta[reminder.state]; return <article key={reminder.id} className="reminder-row"><span className={`reminder-date reminder-${reminder.state.toLowerCase()}`}><Icon name="clock" /></span><span className="reminder-person"><strong>{reminder.customer}</strong><small>{reminder.vehicle}</small></span><span className="reminder-reason"><strong>{reminder.reason}</strong><small>{reminder.due}</small></span><StatusPill label={meta.label} tone={meta.tone} /><button className="icon-button" aria-label="Дополнительные действия"><Icon name="more" /></button></article>; })}
      </section>
    </>
  );
}
