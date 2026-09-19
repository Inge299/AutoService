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
  it("returns a frozen report and signed media URLs without authentication", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      reportLink: {
        findUnique: vi.fn().mockResolvedValue({
          id: "11111111-1111-4111-8111-111111111111", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, openedAt: null,
          reportVersion: {
            workshopId: "22222222-2222-4222-8222-222222222222", visitId: "33333333-3333-4333-8333-333333333333",
            customerName: "Иван", vehicleLabel: "Toyota", licensePlate: "А123АА", mileageKm: 80_000, complaint: "Скрип",
            completedWork: "Заменили колодки", recommendations: "Контроль", nextVisitAt: null,
            findings: [{ title: "Колодки", status: "APPROVED" }], mediaIds: ["44444444-4444-4444-8444-444444444444"],
            workshop: { name: "АвтоСфера", phone: "+79990000000" },
          },
        }),
        update,
      },
      mediaAsset: { update: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444", kind: "PHOTO", mimeType: "image/jpeg", objectKey: "private/report-photo" }]) },
    } as unknown as PrismaClient;
    const createDownloadTarget = vi.fn().mockResolvedValue({ url: "https://media.example/signed", expiresInSeconds: 900 });
    const app = await buildApp(config, { prisma, storage: { seal: vi.fn().mockResolvedValue("private/object-key"), createDownloadTarget } as unknown as ObjectStorage });

    const response = await app.inject({ method: "GET", url: `/public/v1/reports/${token}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ workshop: { name: "АвтоСфера" }, visit: { complaint: "Скрип" }, report: { completedWork: "Заменили колодки", media: [expect.objectContaining({ url: "https://media.example/signed" })] } });
    expect(response.body).not.toContain("private/report-photo");
    expect(update).toHaveBeenCalledOnce();
    await app.close();
  });
});
