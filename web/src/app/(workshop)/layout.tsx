import { AppShell } from "@/components/app-shell";
import { getApiSession, getApiWorkshop, getBackendConnection } from "@/lib/api/autoservice-api";
import { requireSession } from "@/lib/auth/session";
import { workshopRepository } from "@/lib/repository";
import { redirect } from "next/navigation";

export default async function WorkshopLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  let currentUser;
  try {
    currentUser = await getApiSession(session);
  } catch {
    redirect("/staff/login?error=access_revoked");
  }
  const verifiedSession = { ...session, displayName: currentUser.displayName, role: currentUser.role };
  const [backend, workshop, reminders] = await Promise.all([
    getBackendConnection(),
    getApiWorkshop(verifiedSession),
    workshopRepository.listReminders(),
  ]);
  return <AppShell session={{ displayName: verifiedSession.displayName, role: verifiedSession.role }} accessTokenExpiresAtEpochMs={session.accessTokenExpiresAtEpochMs} backend={backend} workshop={workshop} reminderCount={reminders.length}>{children}</AppShell>;
}
