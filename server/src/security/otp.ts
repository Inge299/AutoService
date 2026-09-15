import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export function hashOtpKey(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function hashOtpCode(challengeId: string, code: string, secret: string): string {
  return hashOtpKey(`${challengeId}:${code}`, secret);
}

export function createOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function otpHashesEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
