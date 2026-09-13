import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { registerDevelopmentActorContext } from "./http/context.js";
import { registerErrorHandler } from "./http/errors.js";
import { customerRoutes } from "./http/routes/customers.js";
import { findingRoutes } from "./http/routes/findings.js";
import { healthRoutes } from "./http/routes/health.js";
import { mediaRoutes } from "./http/routes/media.js";
import { publicApprovalRoutes } from "./http/routes/public-approvals.js";
import { visitRoutes } from "./http/routes/visits.js";
import { workshopRoutes } from "./http/routes/workshops.js";
import type { ObjectStorage } from "./infrastructure/object-storage.js";

export interface AppDependencies {
  prisma: PrismaClient;
  storage: ObjectStorage;
}

export async function buildApp(config: Config, dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  registerErrorHandler(app);
  registerDevelopmentActorContext(app, dependencies.prisma, config.NODE_ENV);
  await app.register(healthRoutes(dependencies.prisma));
  await app.register(publicApprovalRoutes(dependencies.prisma));
  await app.register(workshopRoutes(dependencies.prisma));
  await app.register(customerRoutes(dependencies.prisma));
  await app.register(visitRoutes(dependencies.prisma));
  await app.register(findingRoutes(dependencies.prisma));
  await app.register(mediaRoutes(dependencies.prisma, dependencies.storage));
  return app;
}
