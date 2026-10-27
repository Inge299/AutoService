import { z } from "zod";

export const paginationFields = {
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  pagination: z.literal("cursor").optional(),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
};
const cursorValue = z.object({ id: z.string().uuid(), createdAt: z.string().datetime() });
export function parseCursor(value: string | undefined) {
  if (!value) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { parsed = null; }
  const cursor = cursorValue.parse(parsed);
  return { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } },
    { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] };
}
export function pageEnvelope<T extends { id: string; createdAt: Date }>(
  rows: T[], total: number, query: { page?: number | undefined; limit: number; pagination?: string | undefined },
) {
  const items = rows.slice(0, query.limit), last = items.at(-1);
  const hasNext = rows.length > query.limit;
  return { items, total, page: query.page ?? 1, pageSize: query.limit, hasNext,
    nextCursor: hasNext && last ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString() })).toString("base64url") : null };
}
