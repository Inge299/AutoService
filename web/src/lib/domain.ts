export type VisitStatus =
  | "DRAFT"
  | "IN_REPAIR"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "CANCELLED";

export type FindingPriority = "CRITICAL" | "IMPORTANT" | "PLANNED";

export type FindingStatus =
  | "DRAFT"
  | "READY_FOR_APPROVAL"
  | "SENT_TO_CUSTOMER"
  | "APPROVED"
  | "COMPLETED"
  | "DECLINED"
  | "CALL_REQUESTED"
  | "DEFERRED";

export type SyncHealth = "SYNCED" | "SYNCING" | "ATTENTION";

export interface Finding {
  id: string;
  title: string;
  description: string;
  priceRub: number | null;
  priority: FindingPriority;
  status: FindingStatus;
  mediaCount: number;
  mediaIds?: string[];
}

export interface VisitEvent {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone: "neutral" | "positive" | "warning";
}

export interface Visit {
  id: string;
  vehicle: string;
  plate: string;
  customer: string;
  phone: string;
  mileageKm: number | null;
  complaint: string;
  status: VisitStatus;
  syncHealth: SyncHealth;
  updatedAt: string;
  arrivedAt: string;
  mechanic: string;
  nextAction: string;
  attention?: string;
  findings: Finding[];
  mediaCount: number;
  events: VisitEvent[];
}

export interface VisitReport {
  status: "DRAFT" | "PUBLISHED";
  completedWork: string;
  recommendations: string;
  nextVisitAt: string | null;
  publishedAt: string | null;
  latestVersion: { version: number; createdAt: string; linkOpenedAt: string | null; linkRevokedAt: string | null } | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  vehicles: string[];
  visitsCount: number;
  lastVisit: string;
  nextContact?: string;
}

export interface Reminder {
  id: string;
  customer: string;
  vehicle: string;
  reason: string;
  due: string;
  state: "OVERDUE" | "TODAY" | "UPCOMING";
  deliveryState?: "PENDING" | "SENT" | "DELIVERED" | "FAILED" | "CANCELLED";
  returnedVisitId?: string;
  attempts?: number;
}

export const visitStatusMeta: Record<VisitStatus, { label: string; tone: string }> = {
  DRAFT: { label: "Черновик", tone: "neutral" },
  IN_REPAIR: { label: "В ремонте", tone: "info" },
  WAITING_APPROVAL: { label: "Ждёт решения", tone: "warning" },
  COMPLETED: { label: "Завершён", tone: "success" },
  CANCELLED: { label: "Отменён", tone: "danger" },
};

export const findingStatusMeta: Record<FindingStatus, { label: string; tone: string }> = {
  DRAFT: { label: "Черновик", tone: "neutral" },
  READY_FOR_APPROVAL: { label: "Готово к отправке", tone: "info" },
  SENT_TO_CUSTOMER: { label: "Отправлено", tone: "warning" },
  APPROVED: { label: "Согласовано", tone: "success" },
  COMPLETED: { label: "Выполнено", tone: "info" },
  DECLINED: { label: "Отклонено", tone: "danger" },
  CALL_REQUESTED: { label: "Нужен звонок", tone: "warning" },
  DEFERRED: { label: "Отложено", tone: "neutral" },
};

export const priorityMeta: Record<FindingPriority, { label: string; tone: string }> = {
  CRITICAL: { label: "Критично", tone: "danger" },
  IMPORTANT: { label: "Важно", tone: "warning" },
  PLANNED: { label: "Планово", tone: "neutral" },
};

export function formatRub(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const modulo100 = Math.abs(count) % 100;
  const modulo10 = modulo100 % 10;
  if (modulo100 > 10 && modulo100 < 20) return many;
  if (modulo10 === 1) return one;
  if (modulo10 >= 2 && modulo10 <= 4) return few;
  return many;
}
