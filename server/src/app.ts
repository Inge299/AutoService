import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { registerActorContext } from "./http/context.js";
import { adminUserRoutes } from "./http/routes/admin-users.js";
import { authRoutes } from "./http/routes/auth.js";
import { registerErrorHandler } from "./http/errors.js";
import { customerRoutes } from "./http/routes/customers.js";
import { customerAccountRoutes } from "./http/routes/customer-accounts.js";
import { findingRoutes } from "./http/routes/findings.js";
import { healthRoutes } from "./http/routes/health.js";
import { mediaRoutes } from "./http/routes/media.js";
import { publicApprovalRoutes } from "./http/routes/public-approvals.js";
import { publicReportRoutes } from "./http/routes/public-reports.js";
import { reportRoutes } from "./http/routes/reports.js";
import { reminderRoutes } from "./http/routes/reminders.js";
import { visitRoutes } from "./http/routes/visits.js";
import { workshopRoutes } from "./http/routes/workshops.js";
import type { ObjectStorage } from "./infrastructure/object-storage.js";
import {
  createVerificationDelivery,
  type VerificationDelivery,
} from "./infrastructure/verification-delivery.js";
import { phoneAuthRoutes } from "./http/routes/phone-auth.js";

export interface AppDependencies {
  prisma: PrismaClient;
  storage: ObjectStorage;
  verificationDelivery?: VerificationDelivery;
}

const trustSingleProxyHop = (_address: string, hop: number): boolean => hop === 0;

export async function buildApp(config: Config, dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    // Production publishes the API only through one local reverse-proxy hop.
    // Trusting exactly that hop keeps per-client authentication limits effective.
    trustProxy: config.NODE_ENV === "production" ? trustSingleProxyHop : false,
  });
  registerErrorHandler(app);
  const verificationDelivery = dependencies.verificationDelivery ?? createVerificationDelivery(config, app.log);
  registerActorContext(
    app,
    dependencies.prisma,
    config.NODE_ENV,
    config.INTERNAL_API_KEY,
    config.ACCESS_TOKEN_SECRET,
  );
  await app.register(healthRoutes(dependencies.prisma));
  await app.register(publicApprovalRoutes(dependencies.prisma, dependencies.storage));
  await app.register(publicReportRoutes(dependencies.prisma, dependencies.storage));
  await app.register(customerAccountRoutes(
    dependencies.prisma,
    config.ACCESS_TOKEN_SECRET,
    config.OTP_HASH_SECRET,
  ));
  await app.register(authRoutes(dependencies.prisma, config.ACCESS_TOKEN_SECRET));
  await app.register(phoneAuthRoutes(
    dependencies.prisma,
    config.ACCESS_TOKEN_SECRET,
    config.OTP_HASH_SECRET,
    verificationDelivery,
  ));
  await app.register(adminUserRoutes(dependencies.prisma));
  await app.register(workshopRoutes(dependencies.prisma));
  await app.register(customerRoutes(dependencies.prisma));
  await app.register(visitRoutes(dependencies.prisma));
  await app.register(reportRoutes(dependencies.prisma));
  await app.register(reminderRoutes(dependencies.prisma));
  await app.register(findingRoutes(dependencies.prisma));
  await app.register(mediaRoutes(dependencies.prisma, dependencies.storage));
  return app;
}
