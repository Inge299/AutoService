import { AppShell } from "@/components/app-shell";
import { AutoServiceApiError, getApiSession, getApiWorkshop, getBackendConnection } from "@/lib/api/autoservice-api";
import { requireSession } from "@/lib/auth/session";
import { workshopRepository } from "@/lib/repository";
import { redirect } from "next/navigation";

export default async function WorkshopLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  let currentUser;
  try {
    currentUser = await getApiSession(session);
  } catch (error) {
    if (error instanceof AutoServiceApiError && error.status === 401) redirect("/staff/login?error=session_expired");
    if (error instanceof AutoServiceApiError && error.status === 403) {
      return <main className="content-card"><h1>Нет доступа</h1><p>У вашей учётной записи нет доступа к мастерской. Обратитесь к администратору.</p></main>;
    }
    return <main className="content-card"><h1>Сервер временно недоступен</h1><p>Не удалось проверить доступ. Обновите страницу, когда соединение восстановится.</p><a href="/dashboard">Повторить</a></main>;
  }
  if (currentUser.mustChangePassword) redirect("/staff/change-password");
  const verifiedSession = { ...session, displayName: currentUser.displayName, role: currentUser.role };
  const [backend, workshop, summary] = await Promise.all([
    getBackendConnection(),
    getApiWorkshop(verifiedSession),
    workshopRepository.getSummary(),
  ]);
  return <AppShell session={{ displayName: verifiedSession.displayName, role: verifiedSession.role }} accessTokenExpiresAtEpochMs={session.accessTokenExpiresAtEpochMs} backend={backend} workshop={workshop} reminderCount={summary.reminderCounts.PENDING ?? 0}>{children}</AppShell>;
}
