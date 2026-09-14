import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { getBackendConnection } from "@/lib/api/autoservice-api";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Настройки" };

export default async function SettingsPage() {
  const [session, backend] = await Promise.all([requireSession(), getBackendConnection()]);
  return (
    <><PageHeader eyebrow="Управление" title="Настройки мастерской" description="Текущая сессия и состояние серверного подключения." /><div className="settings-grid"><section className="content-card settings-card"><h2>Мастерская</h2><div className="settings-field"><span>Идентификатор</span><strong>{session.workshopId}</strong></div><div className="settings-field"><span>Backend</span><strong>{backend.label}</strong></div><div className="settings-field"><span>Режим данных</span><strong>Серверный</strong></div></section><section className="content-card settings-card"><h2>Доступ</h2><div className="settings-field"><span>Пользователь</span><strong>{session.displayName}</strong></div><div className="settings-field"><span>Ваша роль</span><strong>{session.role === "ADMIN" ? "Администратор" : "Сотрудник"}</strong></div><div className="settings-field"><span>Сессия</span><strong>HttpOnly · 12 часов</strong></div></section></div><p className="demo-data-note">Изменение настроек станет доступно после появления соответствующих endpoint’ов backend.</p></>
  );
}
