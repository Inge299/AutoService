import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { paginationFields, parseCursor, pageEnvelope } from "../../domain/list-page.js";
import { plateVariants } from "../../domain/license-plate.js";

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  ...paginationFields,
}).refine(q => !(q.page && q.pagination) && (!q.cursor || q.pagination === "cursor"), "invalid_pagination");

export function customerRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get("/v1/customers/:id/history", async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const query = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        futurePage: z.coerce.number().int().min(1).max(1_000_000).default(1), vehicleId: z.string().uuid().optional() }).parse(request.query);
      const workshopId = request.actor.workshopId, pageSize = 20;
      const result = await prisma.$transaction(async tx => {
        const customer = await tx.customer.findFirst({ where: { id, workshopId }, select: { id: true, name: true, phone: true } });
        if (!customer) return null;
        const vehicles = await tx.vehicle.findMany({ where: { workshopId, customerId: id }, orderBy: [{ label: "asc" }, { id: "asc" }],
          select: { id: true, label: true, licensePlate: true, _count: { select: { visits: true } } } });
        if (query.vehicleId && !vehicles.some(v => v.id === query.vehicleId)) return null;
        const where = { workshopId, customerId: id, ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}) };
        const futureWhere: Prisma.FindingWhereInput = { workshopId, followUpState: "OPEN", visit: where, OR: [
          { status: "DEFERRED" }, { priority: "PLANNED", status: { notIn: ["COMPLETED", "DECLINED"] } },
        ] };
        const [visits, total, futureWork, futureTotal] = await Promise.all([
          tx.visit.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * pageSize, take: pageSize + 1,
            include: { findings: { orderBy: { createdAt: "asc" }, include: { _count: { select: { media: true } }, media: { where: { state: { in: ["VERIFIED", "READY"] } }, select: { id: true } } } },
              _count: { select: { media: true } }, report: { select: { status: true, completedWork: true, recommendations: true, nextVisitAt: true, publishedAt: true } } } }),
          tx.visit.count({ where }),
          tx.finding.findMany({ where: futureWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.futurePage - 1) * pageSize, take: pageSize + 1,
            select: { id: true, title: true, description: true, priceRub: true, priority: true, visitId: true, createdAt: true,
              serverVersion: true, followUpDueAt: true, followUpConfigured: true, followUpState: true, followUpCompletedAt: true,
              visit: { select: { vehicleLabel: true, licensePlate: true, report: { select: { status: true, nextVisitAt: true } } } } } }),
          tx.finding.count({ where: futureWhere }),
        ]);
        return { customer, vehicles, visits: pageEnvelope(visits, total, { page: query.page, limit: pageSize }),
          futureWork: pageEnvelope(futureWork, futureTotal, { page: query.futurePage, limit: pageSize }) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      if (!result) return reply.code(404).send({ error: "not_found" });
      return result;
    });

    app.get("/v1/customers", async (request) => {
      const query = querySchema.parse(request.query);
      const search = query.q || undefined;
      const { workshopId } = request.actor;
      const alternatives: Prisma.CustomerWhereInput[] = [];
      if (search) {
        alternatives.push({ name: { contains: search, mode: "insensitive" } });
        alternatives.push({ phone: { contains: search, mode: "insensitive" } });
        const digits = search.replace(/\D/g, "");
        if (/^[+\d\s()\-]+$/.test(search) && digits.length >= 3) {
          const phone = digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
          alternatives.push({ phone: { contains: phone } });
          const legacy = await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM customers WHERE workshop_id = ${workshopId}::uuid AND
            position(${phone.length === 11 ? phone.slice(1) : phone} in regexp_replace(phone, '[^0-9]', '', 'g')) > 0`;
          alternatives.push({ id: { in: legacy.map(row => row.id) } });
        }
        const plateParts = search.toUpperCase().split(/[\s-]+/).filter(Boolean);
        alternatives.push({ vehicles: { some: { OR: [
          { label: { contains: search, mode: "insensitive" } },
          ...plateVariants(search).map(plate => ({ licensePlate: { contains: plate, mode: "insensitive" as const } })),
          ...(plateParts.length ? [{ licensePlate: { contains: plateParts.join(""), mode: "insensitive" as const } }] : []),
          ...(plateParts.length > 1 ? [{ AND: plateParts.map(part => ({ licensePlate: { contains: part, mode: "insensitive" as const } })) }] : []),
        ] } } });
      }

      const where: Prisma.CustomerWhereInput = {
          workshopId,
          ...(search ? { OR: alternatives } : {}),
        };
      const include = {
          vehicles: {
            orderBy: { updatedAt: "desc" },
            select: { id: true, label: true, licensePlate: true },
          },
          visits: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
          _count: { select: { visits: true } },
        } satisfies Prisma.CustomerInclude;
      if (!query.page && !query.pagination) return prisma.customer.findMany({ where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: query.limit, include });
      const cursorWhere = parseCursor(query.cursor);
      return prisma.$transaction(async tx => {
        const [rows, total] = await Promise.all([
          tx.customer.findMany({ where: cursorWhere ? { AND: [where, cursorWhere] } : where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: ((query.page ?? 1) - 1) * query.limit,
            take: query.limit + 1, include }), tx.customer.count({ where }),
        ]);
        return pageEnvelope(rows, total, query);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    });
  };
}
