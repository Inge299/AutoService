import { AppShell } from "@/components/app-shell";
import { getBackendConnection } from "@/lib/api/autoservice-api";
import { requireSession } from "@/lib/auth/session";

export default async function WorkshopLayout({ children }: { children: React.ReactNode }) {
  const [session, backend] = await Promise.all([requireSession(), getBackendConnection()]);
  return <AppShell session={session} backend={backend}>{children}</AppShell>;
}
