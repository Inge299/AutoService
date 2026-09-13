import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "autoservice_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface WebSession {
  userId: string;
  workshopId: string;
  displayName: string;
  role: "ADMIN" | "EMPLOYEE";
  expiresAt: number;
}

type SessionIdentity = Omit<WebSession, "expiresAt">;

interface ConfiguredUser extends SessionIdentity {
  login: string;
  passwordHash: string;
}

function encryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionSecret(): string | null {
  const secret = process.env.WEB_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function demoSession(): WebSession | null {
  const demoEnabled =
    process.env.NODE_ENV !== "production" &&
    process.env.AUTOSERVICE_DEMO_MODE === "true";
  if (!demoEnabled) return null;

  return {
    userId: "22222222-2222-4222-8222-222222222222",
    workshopId: "11111111-1111-4111-8111-111111111111",
    displayName: "Евгений",
    role: "ADMIN",
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
}

export function createSessionToken(session: Omit<WebSession, "expiresAt">): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("WEB_SESSION_SECRET must contain at least 32 characters");

  const payload = Buffer.from(JSON.stringify({
    ...session,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }), "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);

  return [
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function verifySessionToken(token: string): WebSession | null {
  const secret = sessionSecret();
  const [ivValue, encryptedValue, authTagValue] = token.split(".");
  if (!secret || !ivValue || !encryptedValue || !authTagValue) return null;

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]);
    const session = JSON.parse(decrypted.toString("utf8")) as WebSession;
    if (session.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    if (!session.userId || !session.workshopId || !session.displayName) return null;
    if (session.role !== "ADMIN" && session.role !== "EMPLOYEE") return null;
    return session;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<WebSession | null> {
  const demo = demoSession();
  if (demo) return demo;

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function requireSession(): Promise<WebSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function persistSession(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export function credentialsMatch(login: string, password: string): boolean {
  const expectedLogin = process.env.WEB_ADMIN_LOGIN;
  if (!expectedLogin || !safeEqual(login, expectedLogin)) return false;

  const passwordHash = process.env.WEB_ADMIN_PASSWORD_HASH;
  if (passwordHash) {
    return passwordMatchesHash(password, passwordHash);
  }

  // Plaintext is accepted only for local development bootstrap.
  const developmentPassword = process.env.WEB_ADMIN_PASSWORD;
  return process.env.NODE_ENV !== "production" && Boolean(developmentPassword) &&
    safeEqual(password, developmentPassword as string);
}

function passwordMatchesHash(password: string, passwordHash: string): boolean {
  const [saltHex, expectedHashHex] = passwordHash.split(":");
  if (!saltHex || !expectedHashHex) return false;
  try {
    const actualHash = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
    return safeEqual(actualHash.toString("hex"), expectedHashHex);
  } catch {
    return false;
  }
}

function configuredUsers(): ConfiguredUser[] {
  const value = process.env.WEB_USERS_JSON;
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((user): user is ConfiguredUser => {
      if (!user || typeof user !== "object") return false;
      const candidate = user as Partial<ConfiguredUser>;
      return typeof candidate.login === "string" &&
        typeof candidate.passwordHash === "string" &&
        typeof candidate.userId === "string" &&
        typeof candidate.workshopId === "string" &&
        typeof candidate.displayName === "string" &&
        (candidate.role === "ADMIN" || candidate.role === "EMPLOYEE");
    });
  } catch {
    return [];
  }
}

export function authenticateCredentials(login: string, password: string): SessionIdentity | null {
  const configured = configuredUsers().find((user) => safeEqual(login, user.login));
  if (configured && passwordMatchesHash(password, configured.passwordHash)) {
    return {
      userId: configured.userId,
      workshopId: configured.workshopId,
      displayName: configured.displayName,
      role: configured.role,
    };
  }

  if (!credentialsMatch(login, password)) return null;
  const userId = process.env.AUTOSERVICE_USER_ID;
  const workshopId = process.env.AUTOSERVICE_WORKSHOP_ID;
  if (!userId || !workshopId) return null;
  return {
    userId,
    workshopId,
    displayName: process.env.WEB_ADMIN_NAME || "Администратор",
    role: "ADMIN",
  };
}
