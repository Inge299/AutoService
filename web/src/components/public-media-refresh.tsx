"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Signed media URLs expire; refresh the same public page to get fresh URLs. */
export function PublicMediaRefresh({ expiresInSeconds, children }: { expiresInSeconds: number; children: React.ReactNode }) {
  const router = useRouter();
  const lastRefresh = useRef(0);
  useEffect(() => {
    const interval = Math.max(60_000, (expiresInSeconds - 60) * 1_000);
    let due = Date.now() + interval;
    const refresh = () => {
      const now = Date.now();
      if (now - lastRefresh.current < 30_000) return;
      lastRefresh.current = now;
      due = now + interval;
      router.refresh();
    };
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() >= due) refresh(); };
    const onError = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement || target instanceof HTMLVideoElement || target instanceof HTMLAudioElement) refresh();
    };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && Date.now() >= due) refresh(); }, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("error", onError, true);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); document.removeEventListener("error", onError, true); };
  }, [expiresInSeconds, router]);
  return <>{children}</>;
}
