export function parsePage(value?: string): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 && n <= 1_000_000 ? n : 1;
}

export function paginationHref(path: string, page: number, query?: string, status?: string, parameters: Record<string, string> = {}, pageKey = "page"): string {
  const params = new URLSearchParams(parameters);
  params.set(pageKey, String(page));
  if (query) params.set("q", query);
  if (status) params.set("status", status);
  return `${path}?${params}`;
}
