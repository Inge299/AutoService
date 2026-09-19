import type { PrismaClient } from "@prisma/client";
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from "fastify";
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
import { FixedWindowRateLimiter } from "./infrastructure/rate-limit.js";

export interface AppDependencies {
  prisma: PrismaClient;
  storage: ObjectStorage;
  verificationDelivery?: VerificationDelivery;
}

const trustSingleProxyHop = (_address: string, hop: number): boolean => hop === 0;

const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function operationIdFrom(request: FastifyRequest): string | undefined {
  const body = request.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const value = (body as Record<string, unknown>).operationId;
  return typeof value === "string" && operationIdPattern.test(value) ? value : undefined;
}

export async function buildApp(config: Config, dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.x-internal-api-key",
          "req.body.password",
          "req.body.token",
          "req.body.code",
          "req.body.phone",
          "err.config.headers.authorization",
        ],
        censor: "[REDACTED]",
      },
    },
    // Default Fastify logs contain the raw URL, which may include a public token.
    // The hooks below log the route template, status, request ID, and operation ID instead.
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    // Production publishes the API only through one local reverse-proxy hop.
    // Trusting exactly that hop keeps per-client authentication limits effective.
    trustProxy: config.NODE_ENV === "production" ? trustSingleProxyHop : false,
  });
  const requestStartedAt = new WeakMap<FastifyRequest, number>();
  const publicRateLimiter = new FixedWindowRateLimiter();
  app.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, Date.now());
    reply.header("x-request-id", request.id);
    if (request.url.startsWith("/public/v1/")) {
      const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      const limit = isMutation ? 20 : 120;
      const scope = isMutation ? "public-mutation" : "public-read";
      const result = publicRateLimiter.take(`${scope}:${request.ip}`, limit, 60_000);
      if (!result.allowed) {
        reply.header("retry-after", String(result.retryAfterSeconds));
        return reply.code(429).send({ error: "rate_limited" });
      }
    }
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info({
      event: "http_request_completed",
      requestId: request.id,
      route: request.routeOptions.url ?? "unmatched",
      method: request.method,
      statusCode: reply.statusCode,
      durationMs: Date.now() - (requestStartedAt.get(request) ?? Date.now()),
      operationId: operationIdFrom(request),
    }, "request completed");
  });
  // Android uses this only as a reliable fallback when a direct presigned S3
  // upload is interrupted by a mobile network or proxy.
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
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
  await app.register(healthRoutes(dependencies.prisma, dependencies.storage));
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
