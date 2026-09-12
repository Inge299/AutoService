import "server-only";

import { customers, reminders, visits } from "@/lib/demo-data";
import { requireSession } from "@/lib/auth/session";
import type { Customer, Reminder, Visit, VisitStatus } from "@/lib/domain";

export interface VisitFilters {
  query?: string;
  status?: VisitStatus;
}

export interface WorkshopRepository {
  listVisits(filters?: VisitFilters): Promise<Visit[]>;
  getVisit(id: string): Promise<Visit | null>;
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

// The UI depends on this interface rather than mock objects. A Fastify-backed
// implementation can replace it when list/read and production-auth endpoints exist.
export const workshopRepository: WorkshopRepository = new DemoWorkshopRepository();
