import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import { config } from "./config";
import { registerRoutes } from "./routes";
import { registerSocket } from "./socket";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cookie);
  await app.register(cors, {
    origin: config.webOrigin,
    credentials: true,
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: error.issues[0]?.message ?? "参数不合法",
      });
      return;
    }
    app.log.error(error);
    const message = error instanceof Error ? error.message : "服务器错误";
    reply.code(500).send({
      code: "INTERNAL_ERROR",
      message,
    });
  });
  await registerRoutes(app);
  registerSocket(app);
  return app;
}
