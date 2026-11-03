import { createHash } from "node:crypto";
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
const workshopId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const visitId = "33333333-3333-4333-8333-333333333333";
const reportId = "44444444-4444-4444-8444-444444444444";
const reportVersionId = "55555555-5555-4555-8555-555555555555";
const operationId = "66666666-6666-4666-8666-666666666666";
const token = "report_token_abcdefghijklmnopqrstuvwxyz0123456789";
const headers = { "x-workshop-id": workshopId, "x-user-id": userId };

const membership = { findUnique: vi.fn().mockResolvedValue({ role: "EMPLOYEE", isActive: true, user: { isActive: true } }) };

describe("visit reports", () => {
  it("recovers only the matching published operation without creating a report", async () => {
    const lookup = vi.fn().mockResolvedValue({ id: reportVersionId, workshopId, visitId,
      link: { tokenHash: createHash("sha256").update(token).digest("hex"), revokedAt: null, expiresAt: new Date("2099-01-01T00:00:00Z") } });
    const prisma = { membership, reportVersion: { findUnique: lookup } } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });
    try {
      const recover = (value: string) => app.inject({ method: "POST", url: `/v1/visits/${visitId}/report/recover`, headers, payload: { operationId, token: value } });
      expect((await recover("x".repeat(43))).statusCode).toBe(404);
      const response = await recover(token);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ reportVersionId, publicPath: `/r/${token}`, reused: true });
      lookup.mockResolvedValueOnce(null);
      const missing = await recover(token);
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error).toBe("report_operation_not_found");
    } finally { await app.close(); }
  });
  it("saves an editable draft only for a workshop visit", async () => {
    const reportCreate = vi.fn().mockResolvedValue({ id: reportId, visitId, status: "DRAFT", completedWork: "Заменили колодки" });
    const transaction = {
      visit: { findFirst: vi.fn().mockResolvedValue({ id: visitId }) },
      report: { findUnique: vi.fn().mockResolvedValue(null), create: reportCreate },
    };
    const prisma = {
      membership,
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const response = await app.inject({
      method: "PUT", url: `/v1/visits/${visitId}/report`, headers,
      payload: { completedWork: "Заменили колодки", recommendations: "Контроль через 10 000 км", nextVisitAt: null },
    });

    expect(response.statusCode).toBe(200);
    expect(reportCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ workshopId, visitId, completedWork: "Заменили колодки" }) }));
    await app.close();
  });

  it.each([true, false])("publishes future work in the immutable report and schedules only dated recommendations (dated=%s)", async (dated) => {
    const nextVisitAt = dated ? new Date("2099-11-20T10:00:00.000Z") : null;
    const versionCreate = vi.fn().mockResolvedValue({ id: reportVersionId });
    const linkCreate = vi.fn().mockResolvedValue({ expiresAt: new Date("2026-10-01T12:00:00.000Z") });
    const mediaRows = [{ id: "88888888-8888-4888-8888-888888888888", findingId: null, state: "READY" }, { id: "hidden-photo", findingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", state: "READY" }];
    const transaction = {
      reportVersion: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), create: versionCreate },
      report: {
        findFirst: vi.fn().mockResolvedValue({
          id: reportId, completedWork: "Заменили колодки", recommendations: "Контроль через 10 000 км", nextVisitAt,
          visit: { id: visitId, customerName: "Иван", customerPhone: "+79991234567", vehicleLabel: "Toyota", licensePlate: "А123АА", mileageKm: 80_000, complaint: "Скрип" },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      finding: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([
        { id: "77777777-7777-4777-8777-777777777777", title: "Колодки", description: "Износ", priceRub: 12_800, priority: "IMPORTANT", status: "COMPLETED" },
        { id: "deferred", title: "Ремень", description: "Износ", priceRub: 1000, priority: "IMPORTANT", status: "DEFERRED" },
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Неопубликованный черновик", description: "Внутреннее", priceRub: 900, priority: "PLANNED", status: "DRAFT" },
      ]) },
      mediaAsset: { findMany: vi.fn().mockResolvedValue(mediaRows) },
      reportLink: { create: linkCreate },
      reminder: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: "99999999-9999-4999-8999-999999999999" }) },
      backgroundJob: { create: vi.fn().mockResolvedValue({}) },
      visit: { update: vi.fn().mockResolvedValue({}) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      membership,
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient;
    const app = await buildApp(config, { prisma, storage: {} as ObjectStorage });

    const unacknowledged = await app.inject({
      method: "POST", url: `/v1/visits/${visitId}/report/publish`, headers,
      payload: { operationId, token, expiresInDays: 14 },
    });
    expect(unacknowledged.statusCode).toBe(409);
    expect(unacknowledged.json().error).toBe("private_findings_changed");
    expect(versionCreate).not.toHaveBeenCalled();
    const acknowledgedPrivateFindingIds = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"];
    const oldClient = await app.inject({ method: "POST", url: `/v1/visits/${visitId}/report/publish`, headers,
      payload: { operationId, token, acknowledgedPrivateFindingIds } });
    expect(oldClient.json().error).toBe("report_client_update_required");
    const changed = await app.inject({ method: "POST", url: `/v1/visits/${visitId}/report/publish`, headers,
      payload: { operationId, token, acknowledgedPrivateFindingIds, expectedMediaIds: [] } });
    expect(changed.json().error).toBe("report_media_changed");
    mediaRows[0]!.state = "RETRY";
    const pending = await app.inject({ method: "POST", url: `/v1/visits/${visitId}/report/publish`, headers,
      payload: { operationId, token, acknowledgedPrivateFindingIds, expectedMediaIds: ["88888888-8888-4888-8888-888888888888"] } });
    expect(pending.json().error).toBe("report_media_pending");
    mediaRows[0]!.state = "READY";
    const response = await app.inject({
      method: "POST", url: `/v1/visits/${visitId}/report/publish`, headers,
      payload: { operationId, token, expiresInDays: 14, acknowledgedPrivateFindingIds, expectedMediaIds: ["88888888-8888-4888-8888-888888888888"] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ reportVersionId, token, publicPath: `/r/${token}`, reused: false });
    expect(versionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ operationId, reportId, visitId, mediaIds: ["88888888-8888-4888-8888-888888888888", "hidden-photo"] }) }));
    expect(linkCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reportVersionId, tokenHash: createHash("sha256").update(token).digest("hex") }) }));
    expect(transaction.visit.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
    expect(versionCreate.mock.calls[0]![0].data.findings.map((finding: { id: string }) => finding.id)).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(versionCreate.mock.calls[0]![0].data.mediaManifest).toEqual([{ id: "88888888-8888-4888-8888-888888888888", findingId: null }, { id: "hidden-photo", findingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]);
    const recommendations = versionCreate.mock.calls[0]![0].data.recommendations;
    expect(recommendations).not.toContain("Неопубликованный черновик");
    expect(recommendations).toContain("Не выполнено в этот визит: Ремень. Необходимо выполнить в дальнейшем.");
    if (dated) {
      expect(recommendations).toContain("Рекомендуемый срок: до 20.11.2099.");
      expect(transaction.reminder.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reportVersionId, visitId, findingId: "deferred", reason: "Необходимо выполнить: Ремень", dueAt: nextVisitAt }) }));
      expect(transaction.backgroundJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "SEND_REMINDER_SMS", reminderId: "99999999-9999-4999-8999-999999999999" }) }));
    } else {
      expect(recommendations).toContain("Срок необходимо согласовать с мастерской.");
      expect(transaction.reminder.create).not.toHaveBeenCalled();
      expect(transaction.backgroundJob.create).not.toHaveBeenCalled();
    }
    await app.close();
  });
});
