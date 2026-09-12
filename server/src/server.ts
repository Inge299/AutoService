import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { ObjectStorage } from "./infrastructure/object-storage.js";
import { createPrisma } from "./infrastructure/prisma.js";

const config = loadConfig();
const prisma = createPrisma();
const app = await buildApp(config, { prisma, storage: new ObjectStorage(config) });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await prisma.$disconnect();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, "server failed to start");
  await prisma.$disconnect();
  process.exitCode = 1;
}
