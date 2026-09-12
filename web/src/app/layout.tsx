import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AutoService", template: "%s · AutoService" },
  description: "Рабочее пространство автомастерской",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ru" className="h-full"><body>{children}</body></html>;
}
