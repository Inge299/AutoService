import "server-only";

import { customers, reminders, visits } from "@/lib/demo-data";
import { requireSession } from "@/lib/auth/session";
import type { Customer, Reminder, Visit, VisitReport, VisitStatus } from "@/lib/domain";
import {
  getApiVisit,
  getApiVisitReport,
  listApiCustomers,
  listApiVisits,
  type ApiCustomer,
  type ApiVisit,
} from "@/lib/api/autoservice-api";

export interface VisitFilters {
  query?: string;
  status?: VisitStatus;
}

export interface WorkshopRepository {
  listVisits(filters?: VisitFilters): Promise<Visit[]>;
  getVisit(id: string): Promise<Visit | null>;
  getVisitReport(id: string): Promise<VisitReport | null>;
  listCustomers(query?: string): Promise<Customer[]>;
  listReminders(): Promise<Reminder[]>;
}

class DemoWorkshopRepository implements WorkshopRepository {
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
      recommendations: report.recommendations,
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
    await requireSession();
    return [];
  }
}

const useDemoRepository = process.env.NODE_ENV !== "production" && process.env.AUTOSERVICE_DEMO_MODE === "true";
export const workshopRepository: WorkshopRepository = useDemoRepository
  ? new DemoWorkshopRepository()
  : new ApiWorkshopRepository();
