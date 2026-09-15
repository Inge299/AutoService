import { redirect } from "next/navigation";
import {
  clearCustomerSession,
  clearSession,
  createCustomerSessionToken,
  createSessionToken,
  getCustomerSession,
  getSession,
  persistCustomerSession,
  persistSession,
} from "@/lib/auth/session";
import { refreshAuthTokensSingleFlight } from "@/lib/auth/refresh";

function safeReturnTo(value: string | null, fallback: string): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.startsWith("/api/auth/refresh")) return fallback;
  const parsed = new URL(value, "http://autoservice.local");
  return parsed.origin === "http://autoservice.local" ? `${parsed.pathname}${parsed.search}` : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const customer = scope === "customer";
  const background = url.searchParams.get("background") === "1";
  const destination = safeReturnTo(url.searchParams.get("returnTo"), customer ? "/cabinet" : "/dashboard");
  let refreshedExpiresAt = 0;

  try {
    if (customer) {
      const session = await getCustomerSession();
      if (!session) throw new Error("customer_session_missing");
      const tokens = await refreshAuthTokensSingleFlight(session.refreshToken);
      refreshedExpiresAt = tokens.accessTokenExpiresAtEpochMs;
      await persistCustomerSession(
        createCustomerSessionToken({ ...session, ...tokens }),
        tokens.refreshTokenExpiresAtEpochMs,
      );
    } else {
      const session = await getSession();
      if (!session) throw new Error("staff_session_missing");
      if (session.isDemo) return background
        ? Response.json({ accessTokenExpiresAtEpochMs: session.accessTokenExpiresAtEpochMs })
        : Response.redirect(new URL(destination, url), 307);
      const tokens = await refreshAuthTokensSingleFlight(session.refreshToken);
      refreshedExpiresAt = tokens.accessTokenExpiresAtEpochMs;
      await persistSession(createSessionToken({ ...session, ...tokens }), tokens.refreshTokenExpiresAtEpochMs);
    }
  } catch {
    if (customer) await clearCustomerSession();
    else await clearSession();
    if (background) return Response.json({ error: "session_expired" }, { status: 401 });
    redirect(customer ? "/customer/login?error=session_expired" : "/login?error=session_expired");
  }
  if (background) return Response.json({ accessTokenExpiresAtEpochMs: refreshedExpiresAt });
  redirect(destination);
}
