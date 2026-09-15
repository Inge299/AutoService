"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const ACCESS_REFRESH_MARGIN_MS = 60_000;

export function SessionRefresher({
  scope,
  accessTokenExpiresAtEpochMs,
}: {
  scope: "staff" | "customer";
  accessTokenExpiresAtEpochMs: number;
}) {
  const pathname = usePathname();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = (expiresAt: number) => {
      const delay = Math.max(1_000, expiresAt - Date.now() - ACCESS_REFRESH_MARGIN_MS);
      timer = setTimeout(refresh, delay);
    };
    const refresh = async () => {
      try {
        const params = new URLSearchParams({ scope, background: "1", returnTo: pathname });
        const response = await fetch(`/api/auth/refresh?${params}`, { cache: "no-store" });
        if (response.status === 401) {
          window.location.assign(scope === "customer" ? "/customer/login?error=session_expired" : "/login?error=session_expired");
          return;
        }
        const body = await response.json() as { accessTokenExpiresAtEpochMs?: number };
        if (!cancelled && body.accessTokenExpiresAtEpochMs) schedule(body.accessTokenExpiresAtEpochMs);
      } catch {
        if (!cancelled) schedule(Date.now() + 60_000 + ACCESS_REFRESH_MARGIN_MS);
      }
    };

    schedule(accessTokenExpiresAtEpochMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accessTokenExpiresAtEpochMs, pathname, scope]);

  return null;
}
