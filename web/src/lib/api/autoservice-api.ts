import "server-only";

import type { FindingPriority, FindingStatus, VisitStatus } from "@/lib/domain";
import type { BackendTokens, WebSession } from "@/lib/auth/session";
import type { CustomerWebSession } from "@/lib/auth/session";

export type BackendConnection =
  | { state: "CONNECTED"; label: string }
  | { state: "NOT_CONFIGURED"; label: string }
  | { state: "UNAVAILABLE"; label: string };

interface VersionedPayload {
  createdAtEpochMs: number;
  updatedAtEpochMs: number;
  baseServerVersion: number | null;
}

export interface VisitUpsertPayload extends VersionedPayload {
  customerName: string;
  customerPhone: string;
  vehicleLabel: string;
  licensePlate: string;
  mileageKm: number | null;
  complaint: string;
  status: VisitStatus;
}

export interface FindingUpsertPayload extends VersionedPayload {
  visitId: string;
  title: string;
  description: string;
  priceRub: number | null;
  priority: FindingPriority;
  status: FindingStatus;
}

export interface MediaUploadPayload {
  operationId: string;
  visitId: string;
  findingId: string | null;
  kind: "PHOTO" | "VIDEO" | "VOICE";
  mimeType: "image/jpeg" | "video/mp4" | "audio/mp4";
  byteCount: number;
  sha256: string;
}

export interface ApiFinding {
  id: string;
  title: string;
  description: string;
  priceRub: number | null;
  priority: FindingPriority;
  status: FindingStatus;
  createdAt: string;
  updatedAt: string;
  _count: { media: number };
}

export interface ApiVisit {
  id: string;
  customerName: string;
  customerPhone: string;
  vehicleLabel: string;
  licensePlate: string;
  mileageKm: number | null;
  complaint: string;
  status: VisitStatus;
  createdAt: string;
  updatedAt: string;
  findings: ApiFinding[];
  _count: { media: number };
}

export interface ApiCustomer {
  id: string;
  name: string;
  phone: string;
  vehicles: Array<{ id: string; label: string; licensePlate: string }>;
  visits: Array<{ createdAt: string }>;
  _count: { visits: number };
}

export interface ApiWorkshop {
  id: string;
  name: string;
  phone: string | null;
}

export interface ApiSessionIdentity extends BackendTokens {
  userId: string;
  workshopId: string;
  displayName: string;
  role: "ADMIN" | "EMPLOYEE";
}

export interface ApiAdminUser {
  id: string;
  login: string | null;
  displayName: string;
  phone: string | null;
  role: "ADMIN" | "EMPLOYEE";
  isActive: boolean;
  createdAt: string;
  isCurrent: boolean;
}

export type ApprovalDecisionValue = "APPROVED" | "DECLINED" | "DEFERRED" | "CALL_REQUESTED";

export interface PublicApproval {
  expiresAt: string;
  openedAt: string;
  workshop: { name: string; phone: string | null };
  visit: {
    id: string;
    customerName: string;
    vehicleLabel: string;
    licensePlate: string;
    status: VisitStatus;
  };
  finding: {
    id: string;
    title: string;
    description: string;
    priceRub: number;
    priority: FindingPriority;
    mediaCount: number;
  };
  media: Array<{
    id: string;
    kind: "PHOTO" | "VIDEO" | "VOICE";
    mimeType: string;
    url: string;
    expiresInSeconds: number;
  }>;
  decision: { value: ApprovalDecisionValue; createdAt: string } | null;
}

export interface ApiVisitReport {
  id: string;
  visitId: string;
  completedWork: string;
  recommendations: string;
  nextVisitAt: string | null;
  status: "DRAFT" | "PUBLISHED";
  publishedAt: string | null;
  versions: Array<{
    version: number;
    createdAt: string;
    link: { expiresAt: string; revokedAt: string | null; openedAt: string | null } | null;
  }>;
}

export type ReminderDeliveryState = "PENDING" | "SENT" | "DELIVERED" | "FAILED" | "CANCELLED";

export interface ApiReminder {
  id: string;
  customerName: string;
  customerPhone: string;
  vehicleLabel: string;
  reason: string;
  dueAt: string;
  sendAt: string;
  state: ReminderDeliveryState;
  providerMessageId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  attempts: number;
  lastError: string | null;
  returnVisit: { id: string; status: VisitStatus; updatedAt: string } | null;
  reportVersion: { version: number; createdAt: string };
}

export interface PublicReport {
  expiresAt: string;
  openedAt: string;
  workshop: { name: string; phone: string | null };
  visit: {
    customerName: string;
    vehicleLabel: string;
    licensePlate: string;
    mileageKm: number | null;
    complaint: string;
  };
  report: {
    completedWork: string;
    recommendations: string;
    nextVisitAt: string | null;
    findings: Array<{
      id: string;
      title: string;
      description: string;
      priceRub: number | null;
      priority: FindingPriority;
      status: FindingStatus;
    }>;
    media: Array<{
      id: string;
      kind: "PHOTO" | "VIDEO" | "VOICE";
      mimeType: string;
      url: string;
      expiresInSeconds: number;
    }>;
  };
}

export interface CustomerAccountIdentity extends BackendTokens {
  expiresAtEpochMs: number;
  customer: { id: string; name: string; phone: string; email: string | null };
}

export interface CustomerPortal {
  customer: { id: string; name: string; phone: string; email: string | null };
  workshop: { name: string; phone: string | null };
  vehicles: Array<{ id: string; label: string; licensePlate: string; updatedAt: string }>;
  visits: ApiVisit[];
}

export class AutoServiceApiError extends Error {
  constructor(public readonly status: number, body: string) {
    super(`AutoService API ${status}: ${body.slice(0, 300)}`);
  }
}

function forwardedForHeader(value?: string): Record<string, string> {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 512 || /[\r\n]/.test(normalized)) return {};
  return { "x-forwarded-for": normalized };
}

function apiBaseUrl(): string | null {
  const value = process.env.AUTOSERVICE_API_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

function developmentInternalApiKey(): string {
  const value = process.env.AUTOSERVICE_INTERNAL_API_KEY?.trim();
  if (!value) throw new Error("AUTOSERVICE_INTERNAL_API_KEY is not configured");
  return value;
}

async function request<T>(
  path: string,
  session: WebSession,
  init: RequestInit = {},
): Promise<T> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error("AUTOSERVICE_API_URL is not configured");

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(session.isDemo ? {
        "x-internal-api-key": developmentInternalApiKey(),
        "x-workshop-id": session.workshopId,
        "x-user-id": session.userId,
      } : { authorization: `Bearer ${session.accessToken}` }),
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AutoServiceApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getBackendConnection(): Promise<BackendConnection> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) return { state: "NOT_CONFIGURED", label: "API не настроен" };

  try {
    const response = await fetch(`${baseUrl}/health/ready`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    return response.ok
      ? { state: "CONNECTED", label: "Сервер подключён" }
      : { state: "UNAVAILABLE", label: "Сервер отвечает с ошибкой" };
  } catch {
    return { state: "UNAVAILABLE", label: "Сервер недоступен" };
  }
}

export function upsertVisit(id: string, payload: VisitUpsertPayload, session: WebSession) {
  return request<Record<string, unknown>>(`/v1/visits/${id}`, session, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function upsertFinding(id: string, payload: FindingUpsertPayload, session: WebSession) {
  return request<Record<string, unknown>>(`/v1/findings/${id}`, session, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function createMediaUploadSession(id: string, payload: MediaUploadPayload, session: WebSession) {
  return request<Record<string, unknown>>(`/v1/media/${id}/upload-session`, session, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function completeMediaUpload(id: string, session: WebSession) {
  return request<Record<string, unknown>>(`/v1/media/${id}/complete`, session, { method: "POST" });
}

export function getMediaStatus(id: string, session: WebSession) {
  return request<Record<string, unknown>>(`/v1/media/${id}`, session);
}

export function listApiVisits(
  session: WebSession,
  filters: { query?: string; status?: VisitStatus } = {},
) {
  const query = new URLSearchParams();
  if (filters.query?.trim()) query.set("q", filters.query.trim());
  if (filters.status) query.set("status", filters.status);
  const suffix = query.size ? `?${query.toString()}` : "";
  return request<ApiVisit[]>(`/v1/visits${suffix}`, session);
}

export async function getApiVisit(id: string, session: WebSession): Promise<ApiVisit | null> {
  try {
    return await request<ApiVisit>(`/v1/visits/${encodeURIComponent(id)}`, session);
  } catch (error) {
    if (error instanceof AutoServiceApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getApiVisitReport(id: string, session: WebSession): Promise<ApiVisitReport | null> {
  try {
    return await request<ApiVisitReport>(`/v1/visits/${encodeURIComponent(id)}/report`, session);
  } catch (error) {
    if (error instanceof AutoServiceApiError && error.status === 404) return null;
    throw error;
  }
}

export function listApiCustomers(session: WebSession, search?: string) {
  const query = new URLSearchParams();
  if (search?.trim()) query.set("q", search.trim());
  const suffix = query.size ? `?${query.toString()}` : "";
  return request<ApiCustomer[]>(`/v1/customers${suffix}`, session);
}

export function listApiReminders(session: WebSession) {
  return request<ApiReminder[]>("/v1/reminders", session);
}

export function cancelApiReminder(session: WebSession, reminderId: string) {
  return request<never>(`/v1/reminders/${encodeURIComponent(reminderId)}/cancel`, session, { method: "POST" });
}

export function getApiWorkshop(session: WebSession) {
  return request<ApiWorkshop>("/v1/workshop", session);
}

export async function authenticateApiUser(
  login: string,
  password: string,
  forwardedFor?: string,
): Promise<ApiSessionIdentity | null> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error("AUTOSERVICE_API_URL is not configured");
  const response = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...forwardedForHeader(forwardedFor) },
    body: JSON.stringify({ login, password }),
    cache: "no-store",
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new AutoServiceApiError(response.status, await response.text());
  return response.json() as Promise<ApiSessionIdentity>;
}

export function getApiSession(session: WebSession) {
  return request<{ id: string; login: string | null; displayName: string; workshopId: string; role: "ADMIN" | "EMPLOYEE" }>("/v1/session", session);
}

export async function getApiSessionWithAccessToken(accessToken: string) {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error("AUTOSERVICE_API_URL is not configured");
  const response = await fetch(`${baseUrl}/v1/session`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw new AutoServiceApiError(response.status, await response.text());
  return response.json() as Promise<{
    id: string;
    login: string | null;
    displayName: string;
    workshopId: string;
    role: "ADMIN" | "EMPLOYEE";
  }>;
}

export function listApiAdminUsers(session: WebSession) {
  return request<ApiAdminUser[]>("/v1/admin/users", session);
}

export function createApiAdminUser(session: WebSession, payload: { login: string; displayName: string; phone?: string; password: string; role: "ADMIN" | "EMPLOYEE" }) {
  return request<{ id: string }>("/v1/admin/users", session, { method: "POST", body: JSON.stringify(payload) });
}

export function setApiAdminUserState(session: WebSession, userId: string, isActive: boolean) {
  return request<{ id: string; isActive: boolean }>(`/v1/admin/users/${encodeURIComponent(userId)}/state`, session, {
    method: "PATCH",
    body: JSON.stringify({ isActive }),
  });
}

export function setApiAdminUserRole(session: WebSession, userId: string, role: "ADMIN" | "EMPLOYEE") {
  return request<{ id: string; role: "ADMIN" | "EMPLOYEE" }>(`/v1/admin/users/${encodeURIComponent(userId)}/role`, session, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function resetApiAdminUserPassword(session: WebSession, userId: string, password: string) {
  return request<{ id: string }>(`/v1/admin/users/${encodeURIComponent(userId)}/password`, session, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function getPublicApproval(token: string): Promise<PublicApproval | null> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error("AUTOSERVICE_API_URL is not configured");
  const response = await fetch(`${baseUrl}/public/v1/approvals/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new AutoServiceApiError(response.status, await response.text());
  return response.json() as Promise<PublicApproval>;
}

export async function getPublicReport(token: string): Promise<PublicReport | null> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error("AUTOSERVICE_API_URL is not configured");
  const response = await fetch(`${baseUrl}/public/v1/reports/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new AutoServiceApiError(response.status, await response.text());
  return response.json() as Promise<PublicReport>;
}

export async function submitPublicApprovalDecision(token: string, value: ApprovalDecisionValue) {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error("AUTOSERVICE_API_URL is not configured");
  const response = await fetch(`${baseUrl}/public/v1/approvals/${encodeURIComponent(token)}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
    cache: "no-store",
  });
  if (!response.ok) throw new AutoServiceApiError(response.status, await response.text());
  return response.json() as Promise<{ value: ApprovalDecisionValue; createdAt: string }>;
}

async function customerRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error("AUTOSERVICE_API_URL is not configured");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
    cache: "no-store",
  });
  if (!response.ok) throw new AutoServiceApiError(response.status, await response.text());
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface PhoneCodeChallenge {
  challengeId: string;
  expiresInSeconds: number;
  resendAfterEpochMs: number;
  verification: { method: "SMS" } | {
    method: "CALLCHECK";
    callPhone: string;
    callPhonePretty: string;
  };
}

export type PhoneCallVerification =
  | (BackendTokens & { expiresAtEpochMs: number })
  | { status: "pending" }
  | { status: "confirmed"; registrationPending: true };

export function requestPhoneCode(payload:
  | { audience: "STAFF" | "CUSTOMER"; phone: string }
  | { audience: "CUSTOMER_REGISTRATION"; approvalToken: string },
  forwardedFor?: string,
) {
  return customerRequest<PhoneCodeChallenge>("/public/v1/auth/phone/request-code", {
    method: "POST",
    headers: forwardedForHeader(forwardedFor),
    body: JSON.stringify(payload),
  });
}

export function verifyPhoneCode(challengeId: string, code: string) {
  return customerRequest<BackendTokens & { expiresAtEpochMs: number }>("/public/v1/auth/phone/verify-code", {
    method: "POST",
    body: JSON.stringify({ challengeId, code }),
  });
}

export function verifyPhoneCall(challengeId: string) {
  return customerRequest<PhoneCallVerification>("/public/v1/auth/phone/verify-call", {
    method: "POST",
    body: JSON.stringify({ challengeId }),
  });
}

export function refreshAuthTokens(refreshToken: string) {
  return customerRequest<BackendTokens & { expiresAtEpochMs: number }>("/public/v1/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export function registerCustomerAccount(
  approvalToken: string,
  challengeId: string,
  code: string | undefined,
  email: string,
  password: string,
) {
  return customerRequest<CustomerAccountIdentity>("/public/v1/customer-accounts/register", {
    method: "POST",
    body: JSON.stringify({ approvalToken, challengeId, code, email, password }),
  });
}

export function loginCustomerAccount(identity: string, password: string) {
  return customerRequest<CustomerAccountIdentity>("/public/v1/customer-accounts/login", {
    method: "POST",
    body: JSON.stringify({ identity, password }),
  });
}

export async function getCustomerPortal(session: CustomerWebSession): Promise<CustomerPortal | null> {
  return getCustomerPortalWithAccessToken(session.accessToken);
}

export async function getCustomerPortalWithAccessToken(accessToken: string): Promise<CustomerPortal | null> {
  try {
    return await customerRequest<CustomerPortal>("/public/v1/customer-accounts/me", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    if (error instanceof AutoServiceApiError && error.status === 401) return null;
    throw error;
  }
}

export async function logoutStaffSession(session: WebSession): Promise<void> {
  if (session.isDemo) return;
  await request<never>("/v1/auth/logout", session, { method: "POST" });
}

export async function logoutCustomerSession(session: CustomerWebSession): Promise<void> {
  await customerRequest<never>("/public/v1/customer-accounts/logout", {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
}
