import { AppShell } from "@/components/app-shell";
import { getApiWorkshop, getBackendConnection } from "@/lib/api/autoservice-api";
import { requireSession } from "@/lib/auth/session";
import { workshopRepository } from "@/lib/repository";

export default async function WorkshopLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [backend, workshop, reminders] = await Promise.all([
    getBackendConnection(),
    getApiWorkshop(session),
    workshopRepository.listReminders(),
  ]);
  return <AppShell session={session} backend={backend} workshop={workshop} reminderCount={reminders.length}>{children}</AppShell>;
}
