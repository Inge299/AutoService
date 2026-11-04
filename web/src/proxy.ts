import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  ACCESS_REFRESH_MARGIN_MS,
  CUSTOMER_SESSION_COOKIE,
  STAFF_SESSION_COOKIE,
  verifyCustomerSessionToken,
  verifySessionToken,
  createCustomerSessionToken,
  createSessionToken,
  type CustomerWebSession,
  type WebSession,
} from "@/lib/auth/session";
import { refreshAuthTokensSingleFlight } from "@/lib/auth/refresh";
import { AutoServiceApiError } from "@/lib/api/autoservice-api";

export async function proxy(request: NextRequest) {
  const customer = request.nextUrl.pathname.startsWith("/cabinet");
  const raw = request.cookies.get(customer ? CUSTOMER_SESSION_COOKIE : STAFF_SESSION_COOKIE)?.value;
  const session = raw
    ? customer ? verifyCustomerSessionToken(raw) : verifySessionToken(raw)
    : null;
  if (!session) {
    return NextResponse.redirect(new URL(customer ? "/customer/login" : "/staff/login", request.url));
  }
  if (!("isDemo" in session && session.isDemo) &&
    session.accessTokenExpiresAtEpochMs <= Date.now() + ACCESS_REFRESH_MARGIN_MS) {
    if (request.method === "GET" || request.method === "HEAD") {
      const refreshUrl = new URL("/api/auth/refresh", request.url);
      refreshUrl.searchParams.set("scope", customer ? "customer" : "staff");
      refreshUrl.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(refreshUrl, 307);
    }
    // Refresh before the mutation, keeping the original method and body.
    // Never replay a mutation after the application has started processing it.
    try {
      const tokens = await refreshAuthTokensSingleFlight(session.refreshToken);
      const token = customer
        ? createCustomerSessionToken({ ...(session as CustomerWebSession), ...tokens })
        : createSessionToken({ ...(session as WebSession), ...tokens });
      const name = customer ? CUSTOMER_SESSION_COOKIE : STAFF_SESSION_COOKIE;
      const headers = new Headers(request.headers);
      request.cookies.set(name, token);
      headers.set("cookie", request.cookies.toString());
      const response = NextResponse.next({ request: { headers } });
      response.cookies.set(name, token, { httpOnly: true, secure: process.env.NODE_ENV === "production",
        sameSite: "lax", path: "/", priority: "high", maxAge: Math.max(0, Math.floor((tokens.refreshTokenExpiresAtEpochMs - Date.now()) / 1000)) });
      return response;
    } catch (error) {
      if (error instanceof AutoServiceApiError && error.status === 401) {
        return NextResponse.json({ error: "session_expired" }, { status: 401, headers: { "Cache-Control": "no-store" } });
      }
      return NextResponse.json({ error: "session_refresh_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/visits/:path*",
    "/customers/:path*",
    "/analytics/:path*",
    "/reminders/:path*",
    "/settings/:path*",
    "/admin/:path*",
    "/staff/change-password/:path*",
    "/cabinet/:path*",
  ],
};
