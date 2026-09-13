import type { PrismaClient } from "@prisma/client";
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

      return prisma.customer.findMany({
        where: {
          workshopId,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { phone: { contains: search, mode: "insensitive" } },
                  { vehicles: { some: { OR: [
                    { label: { contains: search, mode: "insensitive" } },
                    { licensePlate: { contains: search, mode: "insensitive" } },
                  ] } } },
                ],
              }
            : {}),
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
