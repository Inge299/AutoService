const workshopDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
});

// The Android calendar submits midnight, so today's date remains valid even
// after midnight has passed. Compare calendar days in the workshop timezone.
export function isPastVisitDate(date: Date | null, now = new Date()): boolean {
  return date !== null && workshopDate.format(date) < workshopDate.format(now);
}
