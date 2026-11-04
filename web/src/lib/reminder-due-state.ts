// A planned visit is shown by calendar date in the workshop timezone.
// The message sending date is independent and must not mark the visit overdue.
export function reminderDueState(dueAt: string, now = new Date()): "OVERDUE" | "TODAY" | "UPCOMING" {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" });
  const key = (date: Date) => {
    const parts = formatter.formatToParts(date);
    return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
  };
  const due = key(new Date(dueAt)), today = key(now);
  return due < today ? "OVERDUE" : due === today ? "TODAY" : "UPCOMING";
}
