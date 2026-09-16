import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  ACCESS_REFRESH_MARGIN_MS,
  CUSTOMER_SESSION_COOKIE,
  STAFF_SESSION_COOKIE,
  verifyCustomerSessionToken,
  verifySessionToken,
} from "@/lib/auth/session";

export function proxy(request: NextRequest) {
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
    const refreshUrl = new URL("/api/auth/refresh", request.url);
    refreshUrl.searchParams.set("scope", customer ? "customer" : "staff");
    refreshUrl.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(refreshUrl, request.method === "GET" || request.method === "HEAD" ? 307 : 303);
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
    "/cabinet/:path*",
  ],
};
