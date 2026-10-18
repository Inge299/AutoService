import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

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
        }
        const plateParts = search.toUpperCase().split(/[\s-]+/).filter(Boolean);
        alternatives.push({ vehicles: { some: { OR: [
          { label: { contains: search, mode: "insensitive" } },
          { licensePlate: { contains: search, mode: "insensitive" } },
          ...(plateParts.length ? [{ licensePlate: { contains: plateParts.join(""), mode: "insensitive" as const } }] : []),
          ...(plateParts.length > 1 ? [{ AND: plateParts.map(part => ({ licensePlate: { contains: part, mode: "insensitive" as const } })) }] : []),
        ] } } });
      }

      return prisma.customer.findMany({
        where: {
          workshopId,
          ...(search ? { OR: alternatives } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: query.limit,
        include: {
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
        },
      });
    });
  };
}
