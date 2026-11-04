import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { ObjectStorage } from "../src/infrastructure/object-storage.js";

const config: Config = {
  NODE_ENV: "test", HOST: "127.0.0.1", PORT: 8080, LOG_LEVEL: "silent", SMS_PROVIDER: "disabled",
  DATABASE_URL: "postgresql://unused", S3_REGION: "ru-central1", S3_BUCKET: "test-bucket",
  S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test", S3_FORCE_PATH_STYLE: true, WORKER_POLL_INTERVAL_MS: 100,
};
const token = "report_token_abcdefghijklmnopqrstuvwxyz0123456789";

describe("public report routes", () => {
  it("protects error responses from caching and referrer leakage", async () => {
    const prisma = { reportLink: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ expiresAt: new Date(0), revokedAt: null }) } } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });
    try {
      for (const [url, status] of [[`/public/v1/reports/${token}`, 404], [`/public/v1/reports/${token}`, 410], ["/public/v1/reports/short", 400]] as const) {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(status);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.headers["referrer-policy"]).toBe("no-referrer");
      }
    } finally { await app.close(); }
  });
  it("does not expose private findings, generated text or their media from old snapshots", async () => {
    const visibleId = "visible-finding";
    const prisma = {
      reportLink: {
        findUnique: vi.fn().mockResolvedValue({
          id: "link", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, openedAt: new Date(),
          reportVersion: {
            workshopId: "workshop", visitId: "visit", visit: { createdAt: new Date("2026-10-01T09:00:00Z") }, version: 1, createdAt: new Date("2026-10-02T09:00:00Z"), customerName: "QA", vehicleLabel: "Car", licensePlate: "", mileageKm: null, complaint: "",
            completedWork: "Диагностика", nextVisitAt: null,
            recommendations: "Проверить уровень\nНе выполнено в этот визит: Секретный черновик. Необходимо выполнить в дальнейшем. Срок необходимо согласовать с мастерской.",
            findings: [{ id: "private-finding", title: "Секретный черновик", status: "DRAFT" }, { id: visibleId, title: "Видимая работа", status: "COMPLETED" }],
            mediaIds: ["private-media", "visible-media", "general-media"], workshop: { name: "QA", phone: null },
          },
        }),
      },
      mediaAsset: { findMany: vi.fn().mockResolvedValue([
        { id: "private-media", findingId: "private-finding", kind: "PHOTO", mimeType: "image/jpeg", objectKey: "private/verified" },
        { id: "visible-media", findingId: visibleId, kind: "PHOTO", mimeType: "image/jpeg", objectKey: "visible/verified" },
        { id: "general-media", findingId: null, kind: "PHOTO", mimeType: "image/jpeg", objectKey: "general/verified" },
      ]) },
    } as unknown as PrismaClient;
    const seal = vi.fn(async (asset: { objectKey: string }) => asset.objectKey);
    const createDownloadTarget = vi.fn(async (key: string) => ({ url: `https://media.example/${key}`, expiresInSeconds: 900 }));
    const app = await buildApp(config, { prisma, storage: { seal, createDownloadTarget } as unknown as ObjectStorage });
    try {
      const response = await app.inject({ method: "GET", url: `/public/v1/reports/${token}` });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain("Секретный черновик");
      expect(response.body).not.toContain("private-media");
      expect(response.body).not.toContain("general-media");
      expect(response.json().report.findings).toEqual([{ id: visibleId, title: "Видимая работа", status: "COMPLETED" }]);
      expect(response.json().report.recommendations).toBe("Проверить уровень");
      expect(response.json().report.media).toHaveLength(1);
      expect(seal).not.toHaveBeenCalled();
      expect(createDownloadTarget).toHaveBeenCalledTimes(1);
      expect(createDownloadTarget).toHaveBeenCalledWith("visible/verified");
    } finally { await app.close(); }
  });
  it("returns a frozen report and signed media URLs without authentication", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      reportLink: {
        findUnique: vi.fn().mockResolvedValue({
          id: "11111111-1111-4111-8111-111111111111", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, openedAt: null,
          reportVersion: {
            workshopId: "22222222-2222-4222-8222-222222222222", visitId: "33333333-3333-4333-8333-333333333333",
            visit: { createdAt: new Date("2026-10-01T09:00:00Z") }, version: 2, createdAt: new Date("2026-10-02T09:00:00Z"), customerName: "Иван", vehicleLabel: "Toyota", licensePlate: "А123АА", mileageKm: 80_000, complaint: "Скрип",
            completedWork: "Заменили колодки", recommendations: "Контроль", nextVisitAt: null,
            findings: [{ title: "Колодки", status: "APPROVED" }], mediaIds: ["44444444-4444-4444-8444-444444444444"],
            workshop: { name: "АвтоСфера", phone: "+79990000000" },
          },
        }),
        update,
      },
      mediaAsset: { update: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444", kind: "PHOTO", mimeType: "image/jpeg", objectKey: "private/report-photo/verified" }]) },
    } as unknown as PrismaClient;
    const createDownloadTarget = vi.fn().mockResolvedValue({ url: "https://media.example/signed", expiresInSeconds: 900 });
    const app = await buildApp(config, { prisma, storage: { seal: vi.fn().mockResolvedValue("private/object-key"), createDownloadTarget } as unknown as ObjectStorage });

    const response = await app.inject({ method: "GET", url: `/public/v1/reports/${token}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.json()).toMatchObject({ workshop: { name: "АвтоСфера" }, visit: { complaint: "Скрип", createdAt: "2026-10-01T09:00:00.000Z", mileageKm: 80_000 }, report: { version: 2, publishedAt: "2026-10-02T09:00:00.000Z", completedWork: "Заменили колодки", media: [expect.objectContaining({ url: "https://media.example/signed" })] } });
    expect(response.body).not.toContain("private/report-photo/verified");
    expect(update).toHaveBeenCalledOnce();
    await app.close();
  });
  it("queues old visible report media and never seals it on request", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const seal = vi.fn();
    const createDownloadTarget = vi.fn();
    const prisma = { reportLink: { findUnique: vi.fn().mockResolvedValue({
      id: "link", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, openedAt: new Date(),
      reportVersion: { workshopId: "workshop", visitId: "visit", mediaIds: ["media"], findings: [], mediaManifest: [{id: "media", findingId: null}] },
    }) }, mediaAsset: { findMany: vi.fn().mockResolvedValue([{ id: "media", findingId: null, objectKey: "old/original" }]) }, backgroundJob: { createMany, findFirst: vi.fn().mockResolvedValue(null) } } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: { seal, createDownloadTarget } as unknown as ObjectStorage });
    try {
      const response = await app.inject({ method: "GET", url: `/public/v1/reports/${token}` });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "media_preparing" });
      expect(createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
      expect(seal).not.toHaveBeenCalled();
      expect(createDownloadTarget).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

});
