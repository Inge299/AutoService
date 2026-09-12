"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/login/actions";
import { BrandMark, Icon, type IconName } from "@/components/icons";
import type { BackendConnection } from "@/lib/api/autoservice-api";
import type { WebSession } from "@/lib/auth/session";

const navigation: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/dashboard", label: "Сегодня", icon: "dashboard" },
  { href: "/visits", label: "Визиты", icon: "visits" },
  { href: "/customers", label: "Клиенты", icon: "customers" },
  { href: "/reminders", label: "Напоминания", icon: "reminders" },
  { href: "/analytics", label: "Результаты", icon: "analytics" },
];

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

export function AppShell({ session, backend, children }: { session: WebSession; backend: BackendConnection; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link href="/dashboard" className="sidebar-brand"><BrandMark /></Link>
        <div className="workshop-card">
          <span className="workshop-avatar">АС</span>
          <span><strong>АвтоСфера</strong><small>Оренбург · 1 локация</small></span>
          <Icon name="more" />
        </div>
        <nav className="sidebar-nav" aria-label="Основная навигация">
          <p className="nav-caption">Рабочее пространство</p>
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "active" : undefined}>
              <Icon name={item.icon} /><span>{item.label}</span>{item.href === "/reminders" && <em>2</em>}
            </Link>
          ))}
          <p className="nav-caption nav-caption-settings">Управление</p>
          <Link href="/settings" className={isActive(pathname, "/settings") ? "active" : undefined}>
            <Icon name="settings" /><span>Настройки</span>
          </Link>
        </nav>
        <div className="sidebar-footer">
          <div className={`backend-state backend-${backend.state.toLowerCase()}`}>
            <span /><div><strong>{backend.label}</strong><small>Backend AutoService</small></div>
          </div>
          <div className="profile-row">
            <span className="profile-avatar">{session.displayName.slice(0, 1).toUpperCase()}</span>
            <div><strong>{session.displayName}</strong><small>{session.role === "ADMIN" ? "Администратор" : "Сотрудник"}</small></div>
            <form action={logoutAction}><button type="submit" aria-label="Выйти"><Icon name="logout" /></button></form>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="mobile-header"><BrandMark /><span className={`backend-dot backend-${backend.state.toLowerCase()}`} /></header>
        <main className="page-content">{children}</main>
        <nav className="mobile-nav" aria-label="Мобильная навигация">
          {navigation.slice(0, 4).map((item) => (
            <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "active" : undefined}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
