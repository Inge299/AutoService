import { z } from "zod";

const e164 = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, "");
  const digits = compact.replace(/^\+/, "");
  const normalized = digits.length === 10
    ? `+7${digits}`
    : digits.length === 11 && digits.startsWith("8")
      ? `+7${digits.slice(1)}`
      : `+${digits}`;
  return z.string().regex(e164, "invalid_phone").parse(normalized);
}
