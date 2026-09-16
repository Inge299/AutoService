import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const STAFF_SESSION_COOKIE = "autoservice_session";
export const CUSTOMER_SESSION_COOKIE = "autoservice_customer_session";
export const ACCESS_REFRESH_MARGIN_MS = 60_000;
const DEMO_TTL_MS = 12 * 60 * 60_000;

export interface BackendTokens {
  accessToken: string;
  accessTokenExpiresAtEpochMs: number;
  refreshToken: string;
  refreshTokenExpiresAtEpochMs: number;
}

export interface WebSession extends BackendTokens {
  userId: string;
  workshopId: string;
  displayName: string;
  role: "ADMIN" | "EMPLOYEE";
  isDemo?: true;
}

export interface CustomerWebSession extends BackendTokens {
  customerId: string;
  displayName: string;
}

function encryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function sessionSecret(): string | null {
  const secret = process.env.WEB_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function encryptSession(session: WebSession | CustomerWebSession): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("WEB_SESSION_SECRET must contain at least 32 characters");
  const payload = Buffer.from(JSON.stringify(session), "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return [
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

function decryptSession(token: string): unknown {
  const secret = sessionSecret();
  const [ivValue, encryptedValue, authTagValue, extra] = token.split(".");
  if (!secret || !ivValue || !encryptedValue || !authTagValue || extra) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}

function hasBackendTokens(value: unknown): value is BackendTokens {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BackendTokens>;
  return typeof candidate.accessToken === "string" &&
    typeof candidate.refreshToken === "string" &&
    typeof candidate.accessTokenExpiresAtEpochMs === "number" &&
    typeof candidate.refreshTokenExpiresAtEpochMs === "number" &&
    candidate.refreshTokenExpiresAtEpochMs > Date.now();
}

function demoSession(): WebSession | null {
  const demoEnabled = process.env.NODE_ENV !== "production" && process.env.AUTOSERVICE_DEMO_MODE === "true";
  if (!demoEnabled) return null;
  const expiresAt = Date.now() + DEMO_TTL_MS;
  return {
    userId: "22222222-2222-4222-8222-222222222222",
    workshopId: "11111111-1111-4111-8111-111111111111",
    displayName: "Евгений",
    role: "ADMIN",
    accessToken: "",
    refreshToken: "",
    accessTokenExpiresAtEpochMs: expiresAt,
    refreshTokenExpiresAtEpochMs: expiresAt,
    isDemo: true,
  };
}

export function createSessionToken(session: WebSession): string {
  return encryptSession(session);
}

export function verifySessionToken(token: string): WebSession | null {
  const session = decryptSession(token);
  if (!hasBackendTokens(session)) return null;
  const candidate = session as Partial<WebSession>;
  if (!candidate.userId || !candidate.workshopId || !candidate.displayName) return null;
  if (candidate.role !== "ADMIN" && candidate.role !== "EMPLOYEE") return null;
  return candidate as WebSession;
}

export async function getSession(): Promise<WebSession | null> {
  const demo = demoSession();
  if (demo) return demo;
  const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function requireSession(): Promise<WebSession> {
  const session = await getSession();
  if (!session) redirect("/staff/login");
  return session;
}

function cookieMaxAge(refreshTokenExpiresAtEpochMs: number): number {
  return Math.max(0, Math.floor((refreshTokenExpiresAtEpochMs - Date.now()) / 1_000));
}

export async function persistSession(token: string, refreshExpiresAt: number): Promise<void> {
  (await cookies()).set(STAFF_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: cookieMaxAge(refreshExpiresAt),
    priority: "high",
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(STAFF_SESSION_COOKIE);
}

export function createCustomerSessionToken(session: CustomerWebSession): string {
  return encryptSession(session);
}

export function verifyCustomerSessionToken(token: string): CustomerWebSession | null {
  const session = decryptSession(token);
  if (!hasBackendTokens(session)) return null;
  const candidate = session as Partial<CustomerWebSession>;
  if (!candidate.customerId || !candidate.displayName) return null;
  return candidate as CustomerWebSession;
}

export async function getCustomerSession(): Promise<CustomerWebSession | null> {
  const token = (await cookies()).get(CUSTOMER_SESSION_COOKIE)?.value;
  return token ? verifyCustomerSessionToken(token) : null;
}

export async function requireCustomerSession(): Promise<CustomerWebSession> {
  const session = await getCustomerSession();
  if (!session) redirect("/customer/login");
  return session;
}

export async function persistCustomerSession(token: string, refreshExpiresAt: number): Promise<void> {
  (await cookies()).set(CUSTOMER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: cookieMaxAge(refreshExpiresAt),
    priority: "high",
  });
}

export async function clearCustomerSession(): Promise<void> {
  (await cookies()).delete(CUSTOMER_SESSION_COOKIE);
}
