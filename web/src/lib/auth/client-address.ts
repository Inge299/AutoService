import "server-only";

import { headers } from "next/headers";

const MAX_FORWARDED_FOR_LENGTH = 512;

/**
 * Preserves the proxy-provided client address for server-to-server API calls.
 * The API trusts one proxy hop in production; malformed values are discarded.
 */
export async function clientForwardedFor(): Promise<string | undefined> {
  const value = (await headers()).get("x-forwarded-for")?.trim();
  if (!value || value.length > MAX_FORWARDED_FOR_LENGTH || /[\r\n]/.test(value)) return undefined;
  return value;
}
