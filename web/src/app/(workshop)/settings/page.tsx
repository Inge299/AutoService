import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Настройки" };

export default function SettingsPage() {
  return (
    <><PageHeader eyebrow="Управление" title="Настройки мастерской" description="Основные сведения и параметры доступа." /><div className="settings-grid"><section className="content-card settings-card"><h2>Мастерская</h2><div className="settings-field"><span>Название</span><strong>АвтоСфера</strong></div><div className="settings-field"><span>Телефон</span><strong>+7 3532 55-20-20</strong></div><div className="settings-field"><span>Локация</span><strong>Оренбург</strong></div></section><section className="content-card settings-card"><h2>Доступ</h2><div className="settings-field"><span>Ваша роль</span><strong>Администратор</strong></div><div className="settings-field"><span>Сотрудники</span><strong>2 активных</strong></div><div className="settings-field"><span>Сессия</span><strong>HttpOnly · 12 часов</strong></div></section></div><p className="demo-data-note">Изменение настроек будет доступно после появления соответствующих backend endpoint’ов.</p></>
  );
}
