import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Настройки" };

export default async function SettingsPage() {
  const session = await requireSession();
  return (
    <><PageHeader title="Настройки" description="Ваш профиль и доступ в мастерскую." /><div className="settings-grid"><section className="content-card settings-card"><h2>Профиль</h2><div className="settings-field"><span>Имя</span><strong>{session.displayName}</strong></div><div className="settings-field"><span>Роль</span><strong>{session.role === "ADMIN" ? "Администратор" : "Сотрудник"}</strong></div></section></div></>
  );
}
