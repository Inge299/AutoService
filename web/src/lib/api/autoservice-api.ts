import "server-only";

import type { FindingPriority, FindingStatus, VisitStatus } from "@/lib/domain";
import type { WebSession } from "@/lib/auth/session";

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

export interface ApiSessionIdentity {
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
  decision: { value: ApprovalDecisionValue; createdAt: string } | null;
}

export class AutoServiceApiError extends Error {
  constructor(public readonly status: number, body: string) {
    super(`AutoService API ${status}: ${body.slice(0, 300)}`);
  }
}

function apiBaseUrl(): string | null {
  const value = process.env.AUTOSERVICE_API_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

function internalApiKey(): string {
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
      "x-internal-api-key": internalApiKey(),
      "x-workshop-id": session.workshopId,
      "x-user-id": session.userId,
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AutoServiceApiError(response.status, body);
  }

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

export function listApiCustomers(session: WebSession, search?: string) {
  const query = new URLSearchParams();
  if (search?.trim()) query.set("q", search.trim());
  const suffix = query.size ? `?${query.toString()}` : "";
  return request<ApiCustomer[]>(`/v1/customers${suffix}`, session);
}

export function getApiWorkshop(session: WebSession) {
  return request<ApiWorkshop>("/v1/workshop", session);
}

export async function authenticateApiUser(login: string, password: string): Promise<ApiSessionIdentity | null> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error("AUTOSERVICE_API_URL is not configured");
  const response = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-api-key": internalApiKey() },
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
