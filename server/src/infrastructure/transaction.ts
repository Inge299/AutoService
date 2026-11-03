import { Prisma, type PrismaClient } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";

// Every read/modify/write participant uses the same isolation level. Retry the
// entire decision after a serialization conflict, never just the last write.
export async function serializable<T>(prisma: PrismaClient, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt >= 5) throw error;
      // Immediate retries can keep colliding with the same publishing burst.
      // Back off outside the rolled-back transaction, with a bounded jitter.
      await delay(15 * 2 ** attempt + Math.floor(Math.random() * 15));
    }
  }
}
