import { Button } from "@/components/action";
import type { Metadata } from "next";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { workshopRepository } from "@/lib/repository";
import Link from "next/link";
import { cancelReminderAction } from "./actions";

export const metadata: Metadata = { title: "Напоминания" };

const stateMeta = {
  OVERDUE: { label: "Просрочено", tone: "danger" },
  TODAY: { label: "Сегодня", tone: "warning" },
  UPCOMING: { label: "Запланировано", tone: "neutral" },
};

const deliveryMeta = {
  PENDING: { label: "Запланировано", tone: "neutral" },
  SENT: { label: "Отправлено", tone: "info" },
  DELIVERED: { label: "Доставлено", tone: "success" },
  FAILED: { label: "Не доставлено", tone: "danger" },
  CANCELLED: { label: "Отменено", tone: "neutral" },
};

const messages: Record<string, string> = { reminder_cancelled: "Напоминание отменено до отправки." };
const errors: Record<string, string> = { invalid_reminder: "Некорректное напоминание.", reminder_not_pending: "Это напоминание уже отправлено или отменено.", operation_failed: "Не удалось выполнить действие. Повторите позже." };

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const reminders = await workshopRepository.listReminders();
  const query = await searchParams;
  const urgentCount = reminders.filter((reminder) => reminder.state !== "UPCOMING").length;
  return (
    <>
      <PageHeader eyebrow="Возврат клиентов" title="Напоминания" description="Контакты, которые помогут превратить рекомендацию в следующий визит." />
      {query.success && messages[query.success] && <div className="admin-notice admin-notice-success">{messages[query.success]}</div>}
      {query.error && <div className="admin-notice admin-notice-error">{errors[query.error] ?? errors.operation_failed}</div>}
      <section className="summary-banner"><span className="summary-icon"><Icon name="reminders" /></span><div><strong>{urgentCount ? `${urgentCount} требуют внимания` : "Срочных напоминаний нет"}</strong><p>{reminders.length ? `Всего в журнале: ${reminders.length}.` : "Опубликуйте отчёт со сроком следующего визита, чтобы создать напоминание."}</p></div><StatusPill label={`${reminders.filter((reminder) => reminder.deliveryState === "DELIVERED").length} доставлено`} tone="success" /></section>
      <section className="content-card reminders-list">
        {reminders.map((reminder) => { const meta = stateMeta[reminder.state]; const delivery = reminder.deliveryState ? deliveryMeta[reminder.deliveryState] : null; return <article key={reminder.id} className="reminder-row"><span className={`reminder-date reminder-${reminder.state.toLowerCase()}`}><Icon name="clock" /></span><span className="reminder-person"><strong>{reminder.customer}</strong><small>{reminder.vehicle}</small></span><span className="reminder-reason"><strong>{reminder.reason}</strong><small>Плановый визит: {reminder.due}{reminder.returnedVisitId ? <> · <Link href={`/visits/${reminder.returnedVisitId}`}>клиент вернулся</Link></> : ""}</small></span><span className="reminder-states"><StatusPill label={delivery?.label ?? meta.label} tone={delivery?.tone ?? meta.tone} />{reminder.deliveryState === "PENDING" && <small>{reminder.attempts ? `Попыток: ${reminder.attempts}` : "Ожидает отправки"}</small>}</span>{reminder.deliveryState === "PENDING" ? <form action={cancelReminderAction}><input type="hidden" name="reminderId" value={reminder.id} /><Button variant="secondary" className=" button-small" type="submit">Отменить</Button></form> : <span className="reminder-action-placeholder" />}</article>; })}
        {!reminders.length && <div className="empty-state"><Icon name="check" /><h3>Список пуст</h3><p>Здесь появятся напоминания, когда сервер начнёт их формировать.</p></div>}
      </section>
    </>
  );
}
