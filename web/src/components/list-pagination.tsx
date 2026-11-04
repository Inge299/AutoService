import Link from "next/link";
import { paginationHref } from "@/lib/list-pagination";
export { parsePage } from "@/lib/list-pagination";

export function ListPagination({ path, page, total, pageSize, hasNext, query, status, parameters, pageKey }: {
  path: string; page: number; total: number; pageSize: number; hasNext: boolean; query?: string; status?: string;
  parameters?: Record<string, string>; pageKey?: string;
}) {
  if (total <= pageSize && page === 1) return null;
  const href = (number: number) => paginationHref(path, number, query, status, parameters, pageKey);
  return <nav className="list-pagination" aria-label="Страницы списка">
    {page > 1 ? <Link href={href(page - 1)} prefetch={false}>← Назад</Link> : <span />}
    <span>Страница {page} из {Math.max(1, Math.ceil(total / pageSize))} · всего {total}</span>
    {hasNext ? <Link href={href(page + 1)} prefetch={false}>Далее →</Link> : <span />}
  </nav>;
}
