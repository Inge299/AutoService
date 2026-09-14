import type { ReactNode, SVGProps } from "react";

export type IconName = "dashboard" | "visits" | "customers" | "reminders" | "analytics" | "settings" | "search" | "arrow-right" | "arrow-left" | "car" | "phone" | "camera" | "check" | "clock" | "alert" | "refresh" | "more" | "logout";

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const content: Record<IconName, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    visits: <><path d="M4 7h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"/><path d="M8 4v6M16 4v6M4 11h16"/></>,
    customers: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    reminders: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></>,
    analytics: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.4 19.3a1.7 1.7 0 0 0-1.9.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.6h.1A1.7 1.7 0 0 0 3.7 8.4a1.7 1.7 0 0 0-.34-1.9l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8 4a1.7 1.7 0 0 0 1-.6A1.7 1.7 0 0 0 9.4 2.3V2h4v.1A1.7 1.7 0 0 0 14.6 3.7a1.7 1.7 0 0 0 1.9-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19 8a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.3v4h-.1a1.7 1.7 0 0 0-1.5 1.6Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    "arrow-right": <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    "arrow-left": <><path d="M19 12H5M11 18l-6-6 6-6"/></>,
    car: <><path d="m5 11 1.5-4.2A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.8L19 11"/><path d="M3 12a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5H3v-5ZM5 17v2M19 17v2M7 14h.01M17 14h.01"/></>,
    phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.12.9.34 1.8.65 2.65a2 2 0 0 1-.45 2.1L8 9.7a16 16 0 0 0 6 6l1.25-1.25a2 2 0 0 1 2.1-.45c.85.31 1.74.53 2.65.65a2 2 0 0 1 2 2.25Z"/>,
    camera: <><path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3h5Z"/><circle cx="12" cy="13" r="3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    alert: <><path d="M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.5-2.6L20 9M4 15l2.4 2.6A7 7 0 0 0 18 15"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{content[name]}</svg>;
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <div className="brand-mark" aria-label="AutoService"><span className="brand-symbol"><Icon name="car" /></span>{!compact && <span>Auto<span>Service</span></span>}</div>;
}
