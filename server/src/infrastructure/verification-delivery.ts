import type { FastifyBaseLogger } from "fastify";

export interface VerificationMessage {
  challengeId: string;
  phone: string;
  code: string;
  expiresInSeconds: number;
}

export interface VerificationDelivery {
  readonly available: boolean;
  sendCode(message: VerificationMessage): Promise<void>;
}

export const disabledVerificationDelivery: VerificationDelivery = {
  available: false,
  async sendCode() {
    throw new Error("SMS delivery is disabled");
  },
};

export function debugVerificationDelivery(logger: FastifyBaseLogger): VerificationDelivery {
  return {
    available: true,
    async sendCode(message) {
      logger.warn(
        { challengeId: message.challengeId, phone: message.phone, code: message.code },
        "Development-only OTP code",
      );
    },
  };
}
