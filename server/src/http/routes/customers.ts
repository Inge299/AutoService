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
