import { Prisma } from "@prisma/client";
import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "invalid_request", issues: error.issues });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return reply.code(409).send({ error: "conflict" });
    }

    request.log.error({ err: error }, "request failed");
    return reply.code(error.statusCode ?? 500).send({
      error: error.statusCode && error.statusCode < 500 ? "request_failed" : "internal_error",
    });
  });
}
