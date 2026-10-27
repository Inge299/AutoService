import "server-only";

import { customers, reminders, visits } from "@/lib/demo-data";
import { requireSession } from "@/lib/auth/session";
import type { Customer, Reminder, Visit, VisitMedia, VisitReport, VisitStatus, ListPage, WorkshopSummary, CustomerHistory } from "@/lib/domain";
import {
  getApiVisit, getApiCustomerHistory,
  getApiVisitMedia,
  getApiVisitReport,
  listApiReminders,
  listApiCustomers,
  listApiVisits,
  listApiVisitPage, listApiCustomerPage, listApiReminderPage, getApiWorkshopSummary,
  type ApiCustomer,
  type ApiVisit,
} from "@/lib/api/autoservice-api";

export interface VisitFilters {
  query?: string;
  status?: VisitStatus;
  attention?: boolean;
}

export interface WorkshopRepository {
  getCustomerHistory(id: string, page: number, futurePage: number, vehicleId?: string): Promise<CustomerHistory | null>;
  listVisitPage(filters?: VisitFilters, page?: number, limit?: number): Promise<ListPage<Visit>>;
  listCustomerPage(query?: string, page?: number): Promise<ListPage<Customer>>;
  listReminderPage(page?: number): Promise<ListPage<Reminder>>;
  getSummary(): Promise<WorkshopSummary>;
  listVisits(filters?: VisitFilters): Promise<Visit[]>;
  getVisit(id: string): Promise<Visit | null>;
  getVisitMedia(id: string): Promise<VisitMedia[]>;
  getVisitReport(id: string): Promise<VisitReport | null>;
  listCustomers(query?: string): Promise<Customer[]>;
  listReminders(): Promise<Reminder[]>;
}

class DemoWorkshopRepository implements WorkshopRepository {
  async getCustomerHistory(id: string, page: number, futurePage: number): Promise<CustomerHistory | null> {
    await requireSession();
    const customer = customers.find(c => c.id === id);
    if (!customer) return null;
    return { customer, vehicles: [], visits: demoPage(visits.filter(v => v.phone === customer.phone).map(v => ({ ...v, recommendations: null, nextVisitAt: null })), page, 20),
      futureWork: demoPage([], futurePage, 20) };
  }
  async listVisitPage(filters: VisitFilters = {}, page = 1, limit = 50) {
    const rows = (await this.listVisits(filters)).filter(v => !filters.attention || Boolean(v.attention));
    return demoPage(rows, page, limit);
  }
  async listCustomerPage(query?: string, page = 1) { return demoPage(await this.listCustomers(query), page, 50); }
  async listReminderPage(page = 1) { return demoPage(await this.listReminders(), page, 50); }
  async getSummary(): Promise<WorkshopSummary> {
    await requireSession();
    const findings = visits.flatMap(v => v.findings);
    const answered = ["APPROVED", "COMPLETED", "DECLINED", "CALL_REQUESTED", "DEFERRED"];
    const approved = findings.filter(f => ["APPROVED", "COMPLETED"].includes(f.status));
    return { totalVisits: visits.length, activeVisits: visits.filter(v => !["COMPLETED", "CANCELLED"].includes(v.status)).length,
      attentionVisits: visits.filter(v => v.attention && !["COMPLETED", "CANCELLED"].includes(v.status)).length,
      visitCounts: Object.fromEntries(["DRAFT", "IN_REPAIR", "WAITING_APPROVAL", "COMPLETED", "CANCELLED"].map(status => [status, visits.filter(v => v.status === status).length])),
      sent: findings.filter(f => answered.includes(f.status) || f.status === "SENT_TO_CUSTOMER").length,
      decisions: findings.filter(f => answered.includes(f.status)).length,
      approved: approved.length, approvedValue: approved.reduce((sum, f) => sum + (f.priceRub ?? 0), 0),
      upcomingReminders: reminders.filter(r => r.deliveryState === "PENDING").slice(0, 2),
      reminderCounts: Object.fromEntries(["PENDING", "SENT", "DELIVERED", "FAILED", "CANCELLED"].map(state => [state, reminders.filter(r => r.deliveryState === state).length])),
      urgentReminders: reminders.filter(r => r.deliveryState === "PENDING" && r.state !== "UPCOMING").length };
  }
  async getVisitMedia(): Promise<VisitMedia[]> {
    await requireSession();
    return [];
  }
  async listVisits(filters: VisitFilters = {}): Promise<Visit[]> {
    await requireSession();
    const query = filters.query?.trim().toLocaleLowerCase("ru-RU");

    return visits.filter((visit) => {
      const matchesStatus = !filters.status || visit.status === filters.status;
      const haystack = [visit.vehicle, visit.plate, visit.customer, visit.phone]
        .join(" ")
        .toLocaleLowerCase("ru-RU");
      return matchesStatus && (!query || haystack.includes(query));
    });
  }

  async getVisit(id: string): Promise<Visit | null> {
    await requireSession();
    return visits.find((visit) => visit.id === id) ?? null;
  }

  async getVisitReport(id: string): Promise<VisitReport | null> {
    void id;
    await requireSession();
    return null;
  }

  async listCustomers(query?: string): Promise<Customer[]> {
    await requireSession();
    const normalized = query?.trim().toLocaleLowerCase("ru-RU");
    if (!normalized) return customers;

    return customers.filter((customer) =>
      [customer.name, customer.phone, ...customer.vehicles]
        .join(" ")
        .toLocaleLowerCase("ru-RU")
        .includes(normalized),
    );
  }

  async listReminders(): Promise<Reminder[]> {
    await requireSession();
    return reminders;
  }
}

function demoPage<T>(items: T[], page: number, pageSize: number): ListPage<T> {
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize,
    hasNext: page * pageSize < items.length, nextCursor: null };
}

const statusActions: Record<VisitStatus, string> = {
  DRAFT: "Начать диагностику",
  IN_REPAIR: "Продолжить ремонт",
  WAITING_APPROVAL: "Проверить решение клиента",
  COMPLETED: "Нет действий",
  CANCELLED: "Нет действий",
};

const statusEvents: Record<VisitStatus, string> = {
  DRAFT: "Визит сохранён",
  IN_REPAIR: "Автомобиль в работе",
  WAITING_APPROVAL: "Ожидается решение клиента",
  COMPLETED: "Визит завершён",
  CANCELLED: "Визит отменён",
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function relativeTime(value: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (elapsedMinutes < 1) return "только что";
  if (elapsedMinutes < 60) return `${elapsedMinutes} мин назад`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "вчера" : `${days} дн назад`;
}

function mapVisit(visit: ApiVisit): Visit {
  const callRequested = visit.findings.find((finding) => finding.status === "CALL_REQUESTED");
  return {
    id: visit.id,
    customerId: visit.customerId,
    vehicle: visit.vehicleLabel,
    plate: visit.licensePlate,
    customer: visit.customerName,
    phone: visit.customerPhone,
    mileageKm: visit.mileageKm,
    complaint: visit.complaint,
    status: visit.status,
    syncHealth: "SYNCED",
    updatedAt: relativeTime(visit.updatedAt),
    arrivedAt: formatDateTime(visit.createdAt),
    mechanic: "Не назначен",
    nextAction: callRequested ? "Позвонить клиенту" : statusActions[visit.status],
    ...(callRequested ? { attention: `Клиент запросил звонок: ${callRequested.title}` } : {}),
    findings: visit.findings.map((finding) => ({
      id: finding.id,
      title: finding.title,
      description: finding.description,
      priceRub: finding.priceRub,
      priority: finding.priority,
      status: finding.status,
      mediaCount: finding._count.media,
      mediaIds: finding.media.map((media) => media.id),
    })),
    mediaCount: visit._count.media,
    events: [
      {
        id: `${visit.id}-updated`,
        title: statusEvents[visit.status],
        detail: visit.complaint || "Статус визита обновлён",
        time: formatDateTime(visit.updatedAt),
        tone: visit.status === "COMPLETED" ? "positive" : visit.status === "CANCELLED" ? "warning" : "neutral",
      },
      {
        id: `${visit.id}-created`,
        title: "Автомобиль принят",
        detail: visit.mileageKm == null ? visit.vehicleLabel : `Пробег ${visit.mileageKm.toLocaleString("ru-RU")} км`,
        time: formatDateTime(visit.createdAt),
        tone: "neutral",
      },
    ],
  };
}

function mapCustomer(customer: ApiCustomer): Customer {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    vehicles: customer.vehicles.length
      ? customer.vehicles.map((vehicle) => `${vehicle.label} · ${vehicle.licensePlate || "Без номера"}`)
      : ["Автомобиль не указан"],
    visitsCount: customer._count.visits,
    lastVisit: customer.visits[0] ? relativeTime(customer.visits[0].createdAt) : "нет визитов",
  };
}

function mapReminder(reminder: Awaited<ReturnType<typeof listApiReminders>>[number]): Reminder {
  const sendAt = new Date(reminder.sendAt).getTime();
  const now = Date.now();
  const state = sendAt < now - 24 * 60 * 60_000 ? "OVERDUE" : sendAt < now + 24 * 60 * 60_000 ? "TODAY" : "UPCOMING";
  return {
    id: reminder.id,
    customer: reminder.customerName,
    vehicle: reminder.vehicleLabel,
    reason: reminder.reason,
    due: new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }).format(new Date(reminder.dueAt)),
    state,
    deliveryState: reminder.state,
    ...(reminder.returnVisit ? { returnedVisitId: reminder.returnVisit.id } : {}),
    attempts: reminder.attempts,
  };
}

function customersFromVisits(apiVisits: ApiVisit[]): Customer[] {
  const grouped = new Map<string, Customer & { lastVisitEpoch: number }>();
  for (const visit of apiVisits) {
    const key = visit.customerPhone.trim().toLocaleLowerCase("ru-RU") || visit.customerName.trim().toLocaleLowerCase("ru-RU");
    const vehicle = `${visit.vehicleLabel} · ${visit.licensePlate || "Без номера"}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.visitsCount += 1;
      if (!existing.vehicles.includes(vehicle)) existing.vehicles.push(vehicle);
      const timestamp = new Date(visit.createdAt).getTime();
      if (timestamp > existing.lastVisitEpoch) {
        existing.lastVisitEpoch = timestamp;
        existing.lastVisit = relativeTime(visit.createdAt);
      }
      continue;
    }
    grouped.set(key, {
      id: `visit-customer-${encodeURIComponent(key)}`,
      name: visit.customerName,
      phone: visit.customerPhone,
      vehicles: [vehicle],
      visitsCount: 1,
      lastVisit: relativeTime(visit.createdAt),
      lastVisitEpoch: new Date(visit.createdAt).getTime(),
    });
  }
  return [...grouped.values()].map((customer) => ({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    vehicles: customer.vehicles,
    visitsCount: customer.visitsCount,
    lastVisit: customer.lastVisit,
  }));
}

class ApiWorkshopRepository implements WorkshopRepository {
  async getCustomerHistory(id: string, page: number, futurePage: number, vehicleId?: string): Promise<CustomerHistory | null> {
    const result = await getApiCustomerHistory(await requireSession(), id, page, futurePage, vehicleId);
    return result ? { ...result, visits: { ...result.visits, items: result.visits.items.map(v => ({ ...mapVisit(v),
      recommendations: v.report?.status === "PUBLISHED" ? v.report.recommendations : null,
      nextVisitAt: v.report?.status === "PUBLISHED" ? v.report.nextVisitAt : null })) } } : null;
  }
  async listVisitPage(filters: VisitFilters = {}, page = 1, limit = 50): Promise<ListPage<Visit>> {
    const result = await listApiVisitPage(await requireSession(), filters, page, limit);
    return { ...result, items: result.items.map(mapVisit) };
  }
  async listCustomerPage(query?: string, page = 1): Promise<ListPage<Customer>> {
    const result = await listApiCustomerPage(await requireSession(), query, page);
    return { ...result, items: result.items.map(mapCustomer) };
  }
  async listReminderPage(page = 1): Promise<ListPage<Reminder>> {
    const result = await listApiReminderPage(await requireSession(), page);
    return { ...result, items: result.items.map(mapReminder) };
  }
  async getSummary(): Promise<WorkshopSummary> {
    const result = await getApiWorkshopSummary(await requireSession());
    return { ...result, upcomingReminders: result.upcomingReminders.map(mapReminder) };
  }
  async getVisitMedia(id: string): Promise<VisitMedia[]> {
    return getApiVisitMedia(id, await requireSession());
  }
  async listVisits(filters: VisitFilters = {}): Promise<Visit[]> {
    const session = await requireSession();
    return (await listApiVisits(session, filters)).map(mapVisit);
  }

  async getVisit(id: string): Promise<Visit | null> {
    const session = await requireSession();
    const visit = await getApiVisit(id, session);
    return visit ? mapVisit(visit) : null;
  }

  async getVisitReport(id: string): Promise<VisitReport | null> {
    const session = await requireSession();
    const report = await getApiVisitReport(id, session);
    if (!report) return null;
    const latestVersion = report.versions[0];
    return {
      status: report.status,
      completedWork: report.completedWork,
      recommendations: report.status === "PUBLISHED" ? (latestVersion?.recommendations ?? report.recommendations) : report.recommendations,
      nextVisitAt: report.nextVisitAt,
      publishedAt: report.publishedAt,
      latestVersion: latestVersion ? {
        version: latestVersion.version,
        createdAt: latestVersion.createdAt,
        linkOpenedAt: latestVersion.link?.openedAt ?? null,
        linkRevokedAt: latestVersion.link?.revokedAt ?? null,
      } : null,
    };
  }

  async listCustomers(query?: string): Promise<Customer[]> {
    const session = await requireSession();
    const [normalized, apiVisits] = await Promise.all([
      listApiCustomers(session, query),
      listApiVisits(session, query?.trim() ? { query } : {}),
    ]);
    const merged = new Map(normalized.map((customer) => [customer.phone, mapCustomer(customer)]));
    for (const customer of customersFromVisits(apiVisits)) {
      if (!merged.has(customer.phone)) merged.set(customer.phone, customer);
    }
    return [...merged.values()];
  }

  async listReminders(): Promise<Reminder[]> {
    const session = await requireSession();
    return (await listApiReminders(session)).map(mapReminder);
  }
}

const useDemoRepository = process.env.NODE_ENV !== "production" && process.env.AUTOSERVICE_DEMO_MODE === "true";
export const workshopRepository: WorkshopRepository = useDemoRepository
  ? new DemoWorkshopRepository()
  : new ApiWorkshopRepository();
