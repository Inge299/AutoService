/** Accept only the server-generated relative approval URL, never an arbitrary redirect. */
export function safeApprovalPath(value: unknown): string | null {
  return typeof value === "string" && /^\/a\/[A-Za-z0-9_-]{32,200}(?![\s\S])/.test(value) ? value : null;
}
